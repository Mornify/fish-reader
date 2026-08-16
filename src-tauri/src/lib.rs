use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::Manager;

/// Sentinel the frontend checks for to open the "connect your account" screen
/// instead of showing a raw error.
const NO_KEY: &str = "NO_API_KEY";

struct AppState {
    /// Runtime-settable so a user can connect/change their account without
    /// touching files. Persisted to config.json (owner-only permissions).
    api_key: Mutex<String>,
    http: reqwest::Client,
    cache_dir: PathBuf,
    config_path: PathBuf,
}

/// Dev convenience only: a .env key seeds first launch. Real users set theirs
/// in the app, which then takes precedence.
fn env_api_key() -> String {
    std::env::var("FISH_API_KEY")
        .ok()
        .map(|k| k.trim().to_owned())
        .filter(|key| !key.is_empty())
        .unwrap_or_default()
}

fn read_stored_key(config_path: &PathBuf) -> String {
    fs::read_to_string(config_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| {
            v.get("fish_api_key")
                .and_then(|k| k.as_str())
                .map(|s| s.trim().to_owned())
        })
        .filter(|k| !k.is_empty())
        .unwrap_or_default()
}

/// Write the key with owner-only permissions from the moment of creation —
/// never briefly world-readable.
fn write_key_file(path: &std::path::Path, key: &str) -> Result<(), String> {
    let body = serde_json::json!({ "fish_api_key": key });
    let contents = serde_json::to_string_pretty(&body).unwrap_or_default();

    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| format!("Couldn't save your key: {e}"))?;
        file.write_all(contents.as_bytes())
            .map_err(|e| format!("Couldn't save your key: {e}"))?;
    }
    #[cfg(not(unix))]
    fs::write(path, contents).map_err(|e| format!("Couldn't save your key: {e}"))?;
    Ok(())
}

impl AppState {
    fn key(&self) -> Result<String, String> {
        let key = self.api_key.lock().map_err(|_| NO_KEY.to_string())?.clone();
        if key.is_empty() {
            Err(NO_KEY.into())
        } else {
            Ok(key)
        }
    }

    fn persist_key(&self, key: &str) -> Result<(), String> {
        write_key_file(&self.config_path, key)
    }
}

/// Has the user connected a Fish Audio account yet?
#[tauri::command]
fn api_key_status(state: tauri::State<'_, AppState>) -> bool {
    state.key().is_ok()
}

/// Validate a key against the live API, then store it. Returns a friendly
/// error the onboarding screen shows inline.
#[tauri::command]
async fn set_api_key(state: tauri::State<'_, AppState>, key: String) -> Result<(), String> {
    let key = key.trim().to_owned();
    if key.is_empty() {
        return Err("Paste your Fish Audio API key to continue.".into());
    }

    let resp = state
        .http
        .get("https://api.fish.audio/model")
        .bearer_auth(&key)
        .query(&[("page_size", "1")])
        .send()
        .await
        .map_err(|_| "Couldn't reach Fish Audio. Check your internet connection.".to_string())?;

    match resp.status().as_u16() {
        200 => {}
        401 | 403 => {
            return Err("That key wasn't accepted. Make sure you copied the whole key.".into())
        }
        429 => return Err("Fish Audio is rate limiting this key. Try again in a moment.".into()),
        other => return Err(format!("Fish Audio returned an unexpected error ({other}).")),
    }

    state.persist_key(&key)?;
    *state.api_key.lock().map_err(|_| "Internal state error")? = key;
    Ok(())
}

/// Disconnect the account (Settings → Disconnect).
#[tauri::command]
fn clear_api_key(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let _ = fs::remove_file(&state.config_path);
    *state.api_key.lock().map_err(|_| "Internal state error")? = String::new();
    Ok(())
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
    let resp = req
        .send()
        .await
        .map_err(|_| "Couldn't reach Fish Audio. Check your connection.".to_string())?;
    // a rejected key must route to the reconnect screen, not a raw HTTP string
    if matches!(resp.status().as_u16(), 401 | 403) {
        return Err(NO_KEY.into());
    }
    if !resp.status().is_success() {
        return Err(format!("Fish Audio couldn't load voices (error {}).", resp.status()));
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

    let key = state.key()?;
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
        // a rejected key must reach the reconnect screen, not a raw HTTP string
        if matches!(resp.status().as_u16(), 401 | 403) {
            return Err(NO_KEY.into());
        }
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
            .map_err(|_| "Couldn't reach Fish Audio. Check your connection.".to_string())?;
        if matches!(resp.status().as_u16(), 401 | 403) {
            return Err(NO_KEY.into());
        }
        if !resp.status().is_success() {
            let status = resp.status();
            return Err(match status.as_u16() {
                429 => "Fish Audio is rate limiting your account. Try again shortly.".to_string(),
                402 => "Your Fish Audio account is out of credit.".to_string(),
                _ => format!("Narration failed (error {status}). Try again."),
            });
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

#[derive(Serialize)]
struct CacheInfo {
    bytes: u64,
    files: u64,
}

/// Size of the generated-audio cache, for the Settings screen.
#[tauri::command]
fn cache_info(state: tauri::State<'_, AppState>) -> CacheInfo {
    scan_cache(&state.cache_dir)
}

fn scan_cache(dir: &std::path::Path) -> CacheInfo {
    let mut bytes = 0u64;
    let mut files = 0u64;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    bytes += meta.len();
                    // count audio clips, not the sidecar alignment files
                    if entry.path().extension().and_then(|e| e.to_str()) == Some("mp3") {
                        files += 1;
                    }
                }
            }
        }
    }
    CacheInfo { bytes, files }
}

/// Delete all cached narration. Books, progress and bookmarks are untouched;
/// audio is simply regenerated (and re-cached) next time it's played.
#[tauri::command]
fn clear_cache(state: tauri::State<'_, AppState>) -> Result<(), String> {
    purge_files(&state.cache_dir)
}

/// Delete files directly inside `dir` only — never recurses, so it cannot
/// touch books or config even if the path were somehow wrong.
fn purge_files(dir: &std::path::Path) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if entry.path().is_file() {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
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

/// Strip anything that could escape the books directory or collide.
fn sanitize_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect()
}

/// write-then-rename: a crash or full disk mid-save can never truncate an
/// existing book into an unreadable file (progress autosaves are frequent).
fn write_book_atomic(dir: &std::path::Path, safe: &str, data: &str) -> Result<(), String> {
    let path = dir.join(format!("{safe}.json"));
    let tmp = dir.join(format!("{safe}.json.part"));
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Every readable book in the directory. Unreadable or partial files are
/// skipped rather than failing the whole library load.
fn read_books_from(dir: &std::path::Path) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        // note: a leftover ".json.part" has extension "part" and is skipped
        if entry.path().extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(text) = fs::read_to_string(entry.path()) {
            if let Ok(value) = serde_json::from_str(&text) {
                out.push(value);
            }
        }
    }
    out
}

fn remove_book_from(dir: &std::path::Path, safe: &str) -> Result<(), String> {
    let path = dir.join(format!("{safe}.json"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    // clean up an interrupted save so it can't linger forever
    let tmp = dir.join(format!("{safe}.json.part"));
    let _ = fs::remove_file(tmp);
    Ok(())
}

/// Persist one book (JSON blob owned by the frontend).
#[tauri::command]
fn save_book(app: tauri::AppHandle, id: String, data: String) -> Result<(), String> {
    let safe = sanitize_id(&id);
    if safe.is_empty() {
        return Err("Invalid book id".into());
    }
    write_book_atomic(&books_dir(&app)?, &safe, &data)
}

#[tauri::command]
fn list_books(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    Ok(read_books_from(&books_dir(&app)?))
}

#[tauri::command]
fn delete_book(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let safe = sanitize_id(&id);
    if safe.is_empty() {
        return Err("Invalid book id".into());
    }
    remove_book_from(&books_dir(&app)?, &safe)
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
            fs::create_dir_all(&data_dir)?;
            let cache_dir = data_dir.join("audio-cache");
            fs::create_dir_all(&cache_dir)?;
            let config_path = data_dir.join("config.json");

            // stored key wins; otherwise migrate a pre-0.2.1 app-data/.env (or
            // a dev .env) once, so upgrading never logs anyone out
            let mut api_key = read_stored_key(&config_path);
            if api_key.is_empty() {
                let _ = dotenvy::from_path(data_dir.join(".env"));
                api_key = env_api_key();
            }

            let migrated = !api_key.is_empty() && !config_path.exists();

            app.manage(AppState {
                api_key: Mutex::new(api_key),
                // without timeouts a stalled request hangs playback forever
                http: reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(10))
                    .timeout(std::time::Duration::from_secs(90))
                    .build()
                    .unwrap_or_default(),
                cache_dir,
                config_path,
            });

            // persist the migrated key so this only ever happens once
            if migrated {
                let state = app.state::<AppState>();
                if let Ok(key) = state.key() {
                    let _ = state.persist_key(&key);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_voices,
            tts,
            save_book,
            list_books,
            delete_book,
            read_favorites_seed,
            api_key_status,
            set_api_key,
            clear_api_key,
            cache_info,
            clear_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Unique scratch directory per test — no external crate needed.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fish-reader-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ids_cannot_escape_the_books_directory() {
        assert_eq!(sanitize_id("../../etc/passwd"), "etcpasswd");
        assert_eq!(sanitize_id("a/../b"), "ab");
        assert_eq!(sanitize_id("m9k2p-x7f3a1"), "m9k2p-x7f3a1");
        assert_eq!(sanitize_id("...."), "");
        assert_eq!(sanitize_id("/"), "");
    }

    #[test]
    fn saving_a_book_is_atomic_and_leaves_no_partial_file() {
        let dir = scratch("atomic");
        write_book_atomic(&dir, "book-1", r#"{"id":"book-1","title":"A"}"#).unwrap();

        let saved = dir.join("book-1.json");
        assert!(saved.exists(), "book should exist after save");
        assert!(!dir.join("book-1.json.part").exists(), "no .part must remain");

        // overwriting must not destroy the previous file if it succeeds
        write_book_atomic(&dir, "book-1", r#"{"id":"book-1","title":"B"}"#).unwrap();
        assert!(fs::read_to_string(&saved).unwrap().contains("\"B\""));
    }

    #[test]
    fn an_interrupted_save_never_hides_the_real_book() {
        let dir = scratch("interrupted");
        write_book_atomic(&dir, "book-1", r#"{"title":"real"}"#).unwrap();
        // simulate a crash mid-write: a stray .part file left behind
        fs::write(dir.join("book-1.json.part"), "{tru").unwrap();

        let books = read_books_from(&dir);
        assert_eq!(books.len(), 1, "the .part file must not be loaded");
        assert_eq!(books[0]["title"], "real");
    }

    #[test]
    fn corrupt_books_are_skipped_not_fatal() {
        let dir = scratch("corrupt");
        write_book_atomic(&dir, "good", r#"{"title":"ok"}"#).unwrap();
        fs::write(dir.join("bad.json"), "{ this is not json").unwrap();

        let books = read_books_from(&dir);
        assert_eq!(books.len(), 1, "one bad file must not lose the library");
        assert_eq!(books[0]["title"], "ok");
    }

    #[test]
    fn deleting_a_book_removes_it_and_any_partial() {
        let dir = scratch("delete");
        write_book_atomic(&dir, "book-1", r#"{"title":"x"}"#).unwrap();
        fs::write(dir.join("book-1.json.part"), "partial").unwrap();

        remove_book_from(&dir, "book-1").unwrap();
        assert!(!dir.join("book-1.json").exists());
        assert!(!dir.join("book-1.json.part").exists());
        // deleting something already gone is not an error
        remove_book_from(&dir, "book-1").unwrap();
    }

    #[test]
    fn the_api_key_round_trips_and_is_owner_only() {
        let dir = scratch("key");
        let config = dir.join("config.json");

        assert_eq!(read_stored_key(&config), "", "missing config yields no key");

        write_key_file(&config, "sk-test-1234").unwrap();
        assert_eq!(read_stored_key(&config), "sk-test-1234");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&config).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "key file must not be readable by others");
        }

        // a corrupt config must not panic or return garbage
        fs::write(&config, "not json at all").unwrap();
        assert_eq!(read_stored_key(&config), "");

        // a config without the field must not panic
        fs::write(&config, r#"{"something_else":true}"#).unwrap();
        assert_eq!(read_stored_key(&config), "");
    }

    #[test]
    fn cache_reporting_counts_clips_and_clearing_empties_it() {
        let dir = scratch("cache");
        fs::write(dir.join("a.mp3"), vec![0u8; 1000]).unwrap();
        fs::write(dir.join("b.mp3"), vec![0u8; 500]).unwrap();
        // sidecar alignment files count toward size but are not "clips"
        fs::write(dir.join("a.align.json"), vec![0u8; 100]).unwrap();

        let info = scan_cache(&dir);
        assert_eq!(info.files, 2, "only mp3s are counted as clips");
        assert_eq!(info.bytes, 1600, "all files count toward size");

        purge_files(&dir).unwrap();
        let empty = scan_cache(&dir);
        assert_eq!(empty.files, 0);
        assert_eq!(empty.bytes, 0);
    }

    #[test]
    fn clearing_a_missing_cache_is_an_error_not_a_panic() {
        let missing = std::env::temp_dir().join("fish-reader-test-does-not-exist");
        let _ = fs::remove_dir_all(&missing);
        assert!(purge_files(&missing).is_err());
        // and reporting on it is simply empty
        assert_eq!(scan_cache(&missing).files, 0);
    }

    #[test]
    fn purge_does_not_recurse_into_subdirectories() {
        let dir = scratch("purge-scope");
        let nested = dir.join("books");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("important.json"), "keep me").unwrap();
        fs::write(dir.join("clip.mp3"), "audio").unwrap();

        purge_files(&dir).unwrap();
        assert!(!dir.join("clip.mp3").exists(), "clips are cleared");
        assert!(nested.join("important.json").exists(), "nested files survive");
    }
}
