import { BookIcon, GearIcon, PlusIcon, WaveIcon } from "./Icons";

export type AppView = "library" | "voices";

interface Props {
  onUpload: () => void;
  active: AppView;
  onNavigate: (view: AppView) => void;
  onSettings: () => void;
}

export function Sidebar({ onUpload, active, onNavigate, onSettings }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand titlebar-pad" data-tauri-drag-region>
        <div className="wordmark">
          <strong>Fish</strong>Reader
        </div>
      </div>

      <button className="upload-btn" onClick={onUpload}>
        <span className="plus-circle">
          <PlusIcon />
        </span>
        Upload your content
      </button>

      <nav aria-label="Main navigation">
        <button
          className={`nav-item ${active === "library" ? "active" : ""}`}
          onClick={() => onNavigate("library")}
        >
          <BookIcon /> Library
        </button>
        <button
          className={`nav-item ${active === "voices" ? "active" : ""}`}
          onClick={() => onNavigate("voices")}
        >
          <WaveIcon /> Saved voices
        </button>
      </nav>

      <button className="nav-item sidebar-settings" onClick={onSettings}>
        <GearIcon /> Settings
      </button>

      <div className="sidebar-footer">Powered by Fish Audio · local &amp; private</div>
    </aside>
  );
}
