/**
 * Window helpers: Spotify-style floating mini window, fullscreen toggle, and
 * the macOS sound-output picker. All guarded so the plain-browser dev preview
 * never crashes (no Tauri bridge there).
 */

const inTauri = () => "__TAURI_INTERNALS__" in window;

let savedSize: { width: number; height: number } | null = null;

export async function enterMiniWindow(): Promise<boolean> {
  if (!inTauri()) return false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();

    if (await win.isFullscreen()) {
      // macOS ignores setSize while fullscreen — leave fullscreen first and
      // wait out the exit animation before shrinking
      savedSize = { width: 1200, height: 800 }; // fullscreen isn't a real window size
      await win.setFullscreen(false);
      for (let i = 0; i < 30 && (await win.isFullscreen()); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 400));
    } else {
      const size = await win.innerSize();
      const factor = await win.scaleFactor();
      savedSize = { width: size.width / factor, height: size.height / factor };
    }

    // the window's configured minimum (900×600) would clamp setSize and leave
    // a full-size always-on-top window, so lower it first
    await win.setMinSize(new LogicalSize(360, 120));
    await win.setResizable(false);
    await win.setAlwaysOnTop(true);
    await win.setSize(new LogicalSize(440, 148));
    return true;
  } catch {
    return false;
  }
}

export async function exitMiniWindow(): Promise<void> {
  if (!inTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    await win.setAlwaysOnTop(false);
    await win.setResizable(true);
    const s = savedSize ?? { width: 1200, height: 800 };
    await win.setSize(new LogicalSize(Math.max(s.width, 900), Math.max(s.height, 600)));
    await win.setMinSize(new LogicalSize(900, 600)); // restore the real floor
  } catch {
    /* stay as-is */
  }
}

export async function toggleFullscreen(): Promise<void> {
  if (!inTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
  } catch {
    /* ignore */
  }
}

/** "Connect to device" — macOS routes ALL app audio via the system output,
 *  so the honest equivalent is jumping straight to the output picker. */
export async function openSoundOutputSettings(): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl("x-apple.systempreferences:com.apple.Sound-Settings.extension");
  } catch {
    /* ignore */
  }
}
