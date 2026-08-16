import { invoke } from "@tauri-apps/api/core";
import { isDesktop, webApiKey, webClearKey, webValidateAndStoreKey } from "./platform";

/** Backend sentinel meaning "no Fish Audio account connected yet". */
export const NO_API_KEY = "NO_API_KEY";

/** True when an error came from a missing key, so callers can open onboarding
 *  instead of showing a raw string to the user. */
export function isMissingKeyError(message: unknown): boolean {
  return String(message ?? "").includes(NO_API_KEY);
}

const inTauri = isDesktop;

export async function hasApiKey(): Promise<boolean> {
  if (!inTauri()) {
    // dev affordance: force the first-run flow without clearing a real key
    if (localStorage.getItem("preview-onboarding") === "1") return false;
    return webApiKey().length > 0;
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
    await webValidateAndStoreKey(key);
    localStorage.removeItem("preview-onboarding");
    return;
  }
  await invoke("set_api_key", { key });
}

export async function disconnectAccount(): Promise<void> {
  if (!inTauri()) {
    webClearKey();
    return;
  }
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
