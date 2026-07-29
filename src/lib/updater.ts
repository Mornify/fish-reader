/**
 * Auto-update: on launch the app asks GitHub Releases for latest.json; when a
 * newer signed build exists, App shows a banner and this module downloads,
 * verifies (minisign pubkey baked into tauri.conf.json), swaps the .app, and
 * relaunches. No-ops silently in the browser preview and when offline.
 */

export interface AvailableUpdate {
  version: string;
  notes: string;
  /** download + verify + install + relaunch */
  install: () => Promise<void>;
}

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? "",
      install: async () => {
        await update.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch {
    return null; // offline, endpoint missing, or first run — never bother the user
  }
}
