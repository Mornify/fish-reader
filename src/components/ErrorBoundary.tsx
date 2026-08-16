import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last line of defence for the whole app.
 *
 * Without this, any error thrown during render — a malformed book, a corrupt
 * cached clip, a parser edge case — unmounts the tree and leaves a blank
 * window. On a desktop app that someone downloaded, a blank window is the worst
 * possible failure: nothing to read, nothing to click, and nothing to report.
 *
 * So this shows the app's own surface and type, says plainly what happened,
 * and offers the two things that actually recover: go back to the library
 * (the usual cause is one bad book), or reload.
 */
interface State {
  error: Error | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept local — this app sends no telemetry anywhere, and the report button
    // below hands the details to the user rather than to us.
    console.error("Fish Reader crashed:", error, info.componentStack);
  }

  private details(): string {
    const { error } = this.state;
    return [
      // typeof guard, not `?? ""`: an undeclared identifier throws a
      // ReferenceError rather than being undefined — and a crash screen that
      // crashes leaves a blank window, which is worse than having none.
      `Fish Reader ${typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : ""}`.trim(),
      navigator.userAgent,
      "",
      String(error?.stack ?? error?.message ?? error),
    ].join("\n");
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <div className="crash-card">
          <span className="crash-mark">Something went wrong</span>
          <h1>The reader stopped unexpectedly</h1>
          <p>
            Your library is safe — books and generated audio are stored separately
            and were not affected. This is usually caused by a single document
            that didn&apos;t import cleanly.
          </p>

          <div className="crash-actions">
            <button
              className="button primary"
              onClick={() => {
                // back to a known-good screen without touching stored data
                location.hash = "";
                location.reload();
              }}
            >
              Reload Fish Reader
            </button>
            <button
              className="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(this.details())
                  .then(() => this.setState({ copied: true }))
                  .catch(() => this.setState({ copied: false }));
              }}
            >
              {this.state.copied ? "Details copied" : "Copy error details"}
            </button>
          </div>

          <details className="crash-details">
            <summary>Technical details</summary>
            <pre>{this.details()}</pre>
          </details>

          <p className="crash-foot">
            If it keeps happening, the details above are what to include in a
            report at{" "}
            <a
              href="https://github.com/Mornify/fish-reader/issues"
              target="_blank"
              rel="noopener"
            >
              github.com/Mornify/fish-reader/issues
            </a>
            .
          </p>
        </div>
      </div>
    );
  }
}

declare const __APP_VERSION__: string | undefined;
