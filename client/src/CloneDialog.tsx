import { useEffect, useState } from "react";
import { getHome, gitClone, type CloneProgress } from "./api.js";

/** Clone a remote repository into a destination folder, then load it as an IG. */
export function CloneDialog({
  onClose,
  onCloned,
}: {
  onClose: () => void;
  onCloned: (path: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [progress, setProgress] = useState<CloneProgress | null>(null);

  useEffect(() => {
    getHome()
      .then((h) => setParent(h))
      .catch(() => {});
  }, []);

  const repoName =
    url.trim().replace(/\.git$/i, "").replace(/\/+$/, "").split(/[/:]/).pop()?.replace(/[^A-Za-z0-9._-]/g, "-") ?? "";

  async function clone() {
    setBusy(true);
    setOutput(null);
    setProgress(null);
    try {
      const r = await gitClone(url.trim(), parent.trim(), (p) => setProgress(p));
      if (r.ok && r.path) {
        onCloned(r.path);
      } else {
        setOutput(r.output || "Clone failed.");
      }
    } catch (e) {
      setOutput(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            Clone from remote
            {busy && <span className="working">cloning…</span>}
          </h3>
          <button onClick={onClose} disabled={busy} title={busy ? "Clone in progress" : "Close"}>
            ✕
          </button>
        </div>

        <div className="new-form">
          <label>Repository URL</label>
          <input
            autoFocus
            value={url}
            placeholder="https://github.com/org/my-ig.git"
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />

          <label>Destination folder</label>
          <input value={parent} onChange={(e) => setParent(e.target.value)} spellCheck={false} />

          <div className="new-hint">
            Clones into{" "}
            <code>
              {parent || "…"}
              {parent ? "/" : ""}
              {repoName || "repo"}
            </code>
            , then loads it. Public repos only for now — private repos that need a
            credential prompt will fail rather than hang.
          </div>
        </div>

        {busy && (
          <div className="clone-progress">
            <div className="clone-progress-label">
              <span>{progress?.phase ?? "Connecting…"}</span>
              {progress?.percent != null && <span>{progress.percent}%</span>}
            </div>
            <div className="progress-track">
              <div
                className={"progress-fill" + (progress?.percent == null ? " indeterminate" : "")}
                style={progress?.percent != null ? { width: `${progress.percent}%` } : undefined}
              />
            </div>
            {progress?.raw && <div className="clone-progress-raw">{progress.raw}</div>}
          </div>
        )}

        {output && <pre className="git-output">{output}</pre>}

        <div className="picker-foot">
          <span className="picker-hint" />
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={clone} disabled={busy || !url.trim() || !parent.trim()}>
            {busy ? "Cloning…" : "Clone"}
          </button>
        </div>
      </div>
    </div>
  );
}
