import { useEffect, useState } from "react";
import {
  gitBranches,
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitInit,
  gitLog,
  gitPull,
  gitPush,
  gitStatus,
  type GitCommit,
  type GitStatus,
} from "./api.js";

export function GitPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [log, setLog] = useState<GitCommit[]>([]);
  const [message, setMessage] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [diffText, setDiffText] = useState<{ file: string; text: string } | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const st = await gitStatus();
    setStatus(st);
    if (st.isRepo) {
      setBranches((await gitBranches()).branches);
      setLog(await gitLog(12));
    }
    onChanged();
  }

  useEffect(() => {
    refresh().catch((e) => setOutput(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(fn: () => Promise<{ ok: boolean; output: string }>, after?: () => void) {
    setBusy(true);
    setOutput(null);
    try {
      const r = await fn();
      setOutput(r.output || (r.ok ? "Done." : "Failed."));
      if (r.ok) after?.();
      await refresh();
    } catch (e) {
      setOutput(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function showDiff(file: string) {
    if (diffText?.file === file) return setDiffText(null);
    const { diff } = await gitDiff(file);
    setDiffText({ file, text: diff || "(no diff vs HEAD — new or staged file)" });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal git" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            Git
            {status?.isRepo && status.branch && (
              <span className="branch-chip">⎇ {status.branch}</span>
            )}
          </h3>
          <button onClick={onClose}>✕</button>
        </div>

        {status && !status.isRepo && (
          <div className="git-body">
            {status.gitMissing ? (
              <div className="error">git is not installed or not on PATH.</div>
            ) : (
              <>
                <p className="muted">
                  This folder isn’t a git repository yet.
                </p>
                <button className="primary" disabled={busy} onClick={() => run(gitInit)}>
                  Initialize repository
                </button>
              </>
            )}
          </div>
        )}

        {status?.isRepo && (
          <div className="git-body">
            <div className="git-repo-path">{status.root}</div>

            {/* Branch controls */}
            <div className="git-section">
              <div className="group-label">Branch</div>
              <div className="git-branch-row">
                <select
                  value={status.branch}
                  disabled={busy}
                  onChange={(e) => run(() => gitCheckout(e.target.value))}
                >
                  {(status.branch && !branches.includes(status.branch)
                    ? [status.branch, ...branches]
                    : branches
                  ).map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
                <input
                  placeholder="new branch name"
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                />
                <button
                  disabled={busy || !newBranch.trim()}
                  onClick={() =>
                    run(
                      () => gitCreateBranch(newBranch.trim(), true),
                      () => setNewBranch(""),
                    )
                  }
                >
                  Create + switch
                </button>
              </div>
              {(status.ahead || status.behind) && status.hasRemote ? (
                <div className="muted small">
                  {status.ahead ? `↑${status.ahead} ahead ` : ""}
                  {status.behind ? `↓${status.behind} behind` : ""}
                </div>
              ) : null}
            </div>

            {/* Changes */}
            <div className="git-section">
              <div className="group-label">
                Changes ({status.files?.length ?? 0})
              </div>
              {status.clean ? (
                <div className="muted small">Working tree clean.</div>
              ) : (
                <div className="git-files">
                  {status.files!.map((f) => (
                    <div key={f.path}>
                      <div className="git-file" onClick={() => showDiff(f.path)}>
                        <span className={"git-code " + (f.staged ? "staged" : "")}>{f.code}</span>
                        <span className="git-file-path">{f.path}</span>
                        <span className="git-file-label">{f.label}</span>
                      </div>
                      {diffText?.file === f.path && <pre className="git-diff">{diffText.text}</pre>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Commit */}
            <div className="git-section">
              <div className="group-label">Commit all changes</div>
              <textarea
                rows={2}
                placeholder="Commit message…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="git-actions">
                <button
                  className="primary"
                  disabled={busy || status.clean || !message.trim()}
                  onClick={() => run(() => gitCommit(message), () => setMessage(""))}
                >
                  Commit
                </button>
                {status.hasRemote && (
                  <>
                    <button disabled={busy} onClick={() => run(gitPull)}>
                      Pull
                    </button>
                    <button disabled={busy} onClick={() => run(gitPush)}>
                      Push
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* History */}
            <div className="git-section">
              <div className="group-label">Recent commits</div>
              <div className="git-log">
                {log.map((c) => (
                  <div key={c.hash} className="git-commit">
                    <span className="git-hash">{c.hash}</span>
                    <span className="git-subject">{c.subject}</span>
                    <span className="git-meta">
                      {c.author} · {c.date}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {output && <pre className="git-output">{output}</pre>}
      </div>
    </div>
  );
}
