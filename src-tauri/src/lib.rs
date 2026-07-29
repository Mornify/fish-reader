use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};
use tauri::Manager;

struct AppState {
    api_key: String,
    http: reqwest::Client,
    cache_dir: PathBuf,
}

fn configured_api_key() -> String {
    std::env::var("FISH_API_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty())
        .or_else(|| option_env!("FISH_API_KEY").map(str::to_owned))
        .unwrap_or_default()
}

impl AppState {
    fn key(&self) -> Result<&str, String> {
        if self.api_key.is_empty() {
            Err("FISH_API_KEY is not set — add it to the .env file in the project root".into())
        } else {
            Ok(&self.api_key)
        }
    }
}

/// Search/browse the Fish Audio voice catalog (or your own cloned voices).
#[tauri::command]
async fn list_voices(
    state: tauri::State<'_, AppState>,
    title: Option<String>,
    tags: Option<Vec<String>>,
    language: Option<String>,
    sort_by: Option<String>,
    page_number: Option<u32>,
    page_size: Option<u32>,
    self_only: Option<bool>,
) -> Result<serde_json::Value, String> {
    let key = state.key()?;
    let mut req = state
        .http
        .get("https://api.fish.audio/model")
        .bearer_auth(key)
        .query(&[
            ("page_size", page_size.unwrap_or(24).to_string()),
            ("page_number", page_number.unwrap_or(1).to_string()),
        ]);
    if let Some(t) = title.filter(|t| !t.is_empty()) {
        req = req.query(&[("title", t)]);
    }
    // repeated tag params AND together server-side ("deep" + "male")
    for tag in tags.unwrap_or_default() {
        if !tag.is_empty() {
            req = req.query(&[("tag", tag)]);
        }
    }
    if let Some(l) = language.filter(|l| !l.is_empty()) {
        req = req.query(&[("language", l)]);
    }
    // valid: score (hot) | task_count (most used) | created_at (newest)
    if let Some(s) = sort_by.filter(|s| !s.is_empty()) {
        req = req.query(&[("sort_by", s)]);
    }
    if self_only.unwrap_or(false) {
        req = req.query(&[("self", "true")]);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Fish API error: HTTP {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

#[derive(Serialize, serde::Deserialize, Clone)]
struct TtsSegment {
    text: String,
    start: f64,
    end: f64,
}

#[derive(Serialize)]
struct TtsResult {
    /// Absolute path of the cached mp3 — play via convertFileSrc() in the frontend.
    path: String,
    /// True when served from the local cache (no API call, no cost).
    cached: bool,
    /// Word-level timing from Fish's alignment (empty = caller should estimate).
    segments: Vec<TtsSegment>,
}

fn tts_body(text: &str, voice_id: &str) -> serde_json::Value {
    serde_json::json!({
        "text": text,
        "reference_id": voice_id,
        "format": "mp3",
        "mp3_bitrate": 128,
        "normalize": true,
        "latency": "normal",
        "chunk_length": 200,
    })
}

/// Parse the SSE stream from /v1/tts/stream/with-timestamp: concatenated
/// base64 audio chunks + the newest alignment snapshot per chunk_seq.
fn parse_timestamp_sse(raw: &str) -> (Vec<u8>, Vec<TtsSegment>) {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let mut audio: Vec<u8> = Vec::new();
    let mut aligns: std::collections::BTreeMap<i64, (f64, serde_json::Value)> =
        std::collections::BTreeMap::new();

    for line in raw.lines() {
        let Some(rest) = line.strip_prefix("data:") else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(rest.trim()) else {
            continue;
        };
        if let Some(b64) = v.get("audio_base64").and_then(|x| x.as_str()) {
            if let Ok(bytes) = B64.decode(b64) {
                audio.extend_from_slice(&bytes);
            }
        }
        let seq = v.get("chunk_seq").and_then(|x| x.as_i64()).unwrap_or(0);
        let off = v
            .get("chunk_audio_offset_sec")
            .and_then(|x| x.as_f64())
            .unwrap_or(0.0);
        if let Some(al) = v.get("alignment") {
            if !al.is_null() {
                aligns.insert(seq, (off, al.clone()));
            }
        }
    }

    let mut segments = Vec::new();
    for (_seq, (off, al)) in aligns {
        if let Some(arr) = al.get("segments").and_then(|s| s.as_array()) {
            for s in arr {
                let (Some(t), Some(st), Some(en)) = (
                    s.get("text").and_then(|x| x.as_str()),
                    s.get("start").and_then(|x| x.as_f64()),
                    s.get("end").and_then(|x| x.as_f64()),
                ) else {
                    continue;
                };
                segments.push(TtsSegment {
                    text: t.to_string(),
                    start: st + off,
                    end: en + off,
                });
            }
        }
    }
    (audio, segments)
}

/// Synthesize one text chunk (typically a sentence) to mp3 with word timing,
/// content-addressed on disk. Falls back to the plain TTS endpoint if the
/// timestamp endpoint fails.
#[tauri::command]
async fn tts(
    state: tauri::State<'_, AppState>,
    text: String,
    voice_id: String,
    model: Option<String>,
) -> Result<TtsResult, String> {
    let model = model.unwrap_or_else(|| "s2.1-pro-free".to_string());

    let mut hasher = Sha256::new();
    for part in [model.as_str(), voice_id.as_str(), text.as_str()] {
        hasher.update(part.as_bytes());
        hasher.update(b"\x1f");
    }
    let hash = hex::encode(hasher.finalize());
    let cache_path = state.cache_dir.join(format!("{hash}.mp3"));
    let align_path = state.cache_dir.join(format!("{hash}.align.json"));

    if cache_path.exists() {
        let segments = fs::read_to_string(&align_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        return Ok(TtsResult {
            path: cache_path.to_string_lossy().into_owned(),
            cached: true,
            segments,
        });
    }

    let key = state.key()?.to_string();
    let body = tts_body(&text, &voice_id);

    // primary: timestamped SSE endpoint
    let mut audio: Vec<u8> = Vec::new();
    let mut segments: Vec<TtsSegment> = Vec::new();
    let resp = state
        .http
        .post("https://api.fish.audio/v1/tts/stream/with-timestamp")
        .bearer_auth(&key)
        .header("model", &model)
        .json(&body)
        .send()
        .await;
    if let Ok(resp) = resp {
        if resp.status().is_success() {
            if let Ok(raw) = resp.text().await {
                (audio, segments) = parse_timestamp_sse(&raw);
            }
        }
    }

    // fallback: plain endpoint, no timing
    if audio.is_empty() {
        segments.clear();
        let resp = state
            .http
            .post("https://api.fish.audio/v1/tts")
            .bearer_auth(&key)
            .header("model", &model)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            let status = resp.status();
            let detail = resp.text().await.unwrap_or_default();
            return Err(format!("Fish TTS error: HTTP {status} {detail}"));
        }
        audio = resp.bytes().await.map_err(|e| e.to_string())?.to_vec();
    }

    if audio.is_empty() {
        return Err("Fish TTS returned no audio".into());
    }

    let tmp = cache_path.with_extension("part");
    fs::write(&tmp, &audio).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &cache_path).map_err(|e| e.to_string())?;
    if !segments.is_empty() {
        let _ = fs::write(
            &align_path,
            serde_json::to_string(&segments).unwrap_or_default(),
        );
    }

    Ok(TtsResult {
        path: cache_path.to_string_lossy().into_owned(),
        cached: false,
        segments,
    })
}

/// Read app-data/favorites-seed.json (written by external import helpers) so
/// the frontend can merge pre-seeded favorite voices.
#[tauri::command]
fn read_favorites_seed(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("favorites-seed.json");
    if path.exists() {
        Ok(Some(fs::read_to_string(path).map_err(|e| e.to_string())?))
    } else {
        Ok(None)
    }
}

fn books_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("books");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Persist one book (JSON blob owned by the frontend).
#[tauri::command]
fn save_book(app: tauri::AppHandle, id: String, data: String) -> Result<(), String> {
    let safe: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    let path = books_dir(&app)?.join(format!("{safe}.json"));
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_books(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(books_dir(&app)?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(text) = fs::read_to_string(entry.path()) {
            if let Ok(v) = serde_json::from_str(&text) {
                out.push(v);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn delete_book(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let safe: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    let path = books_dir(&app)?.join(format!("{safe}.json"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Dev: cwd is src-tauri, so the project-root .env is one level up.
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_path("../.env");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            // production: the key lives in app-data/.env (dev loads ../.env above)
            let _ = dotenvy::from_path(data_dir.join(".env"));
            let cache_dir = data_dir.join("audio-cache");
            fs::create_dir_all(&cache_dir)?;
            app.manage(AppState {
                api_key: configured_api_key(),
                http: reqwest::Client::new(),
                cache_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_voices,
            tts,
            save_book,
            list_books,
            delete_book,
            read_favorites_seed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
