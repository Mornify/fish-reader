import { invoke } from "@tauri-apps/api/core";

/** Backend sentinel meaning "no Fish Audio account connected yet". */
export const NO_API_KEY = "NO_API_KEY";

/** True when an error came from a missing key, so callers can open onboarding
 *  instead of showing a raw string to the user. */
export function isMissingKeyError(message: unknown): boolean {
  return String(message ?? "").includes(NO_API_KEY);
}

const inTauri = () => "__TAURI_INTERNALS__" in window;

export async function hasApiKey(): Promise<boolean> {
  if (!inTauri()) {
    // browser preview only (never runs in the packaged app): lets the design
    // of the first-run flow be inspected without wiping the real key
    return localStorage.getItem("preview-onboarding") !== "1";
  }
  try {
    return await invoke<boolean>("api_key_status");
  } catch {
    return false;
  }
}

/** Validates against the live API before storing. Throws a friendly message. */
export async function saveApiKey(key: string): Promise<void> {
  if (!inTauri()) {
    if (!key.trim().startsWith("good")) {
      throw new Error("That key wasn't accepted. Make sure you copied the whole key.");
    }
    return;
  }
  await invoke("set_api_key", { key });
}

export async function disconnectAccount(): Promise<void> {
  if (!inTauri()) return;
  try {
    await invoke("clear_api_key");
  } catch {
    /* already gone */
  }
}

/** Open a URL in the user's real browser (onboarding links to fish.audio). */
export async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}
