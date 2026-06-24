import { useEffect, useState } from "react";
import {
  gitBranches,
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitInit,
  gitLog,
  gitStage,
  gitStageAll,
  gitStatus,
  gitUnstage,
  gitUnstageAll,
  type GitCommit,
  type GitStatus,
} from "./api.js";
import { DiffView } from "./DiffView.js";
import { ArrowDown, ArrowUp, GitBranch, X } from "lucide-react";

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
    refresh().catch((e) => setOutput(e instanceof Error ? e.message : String(e)));
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
      setOutput(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function showDiff(file: string) {
    if (diffText?.file === file) return setDiffText(null);
    const { diff } = await gitDiff(file);
    setDiffText({ file, text: diff || "(no textual diff vs HEAD — new, binary, or staged file)" });
  }

  const stagedCount = status?.files?.filter((f) => f.staged).length ?? 0;

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal git" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            Git
            {status?.isRepo && status.branch && (
              <span className="branch-chip"><GitBranch size={12} /> {status.branch}</span>
            )}
            {busy && <span className="working">working…</span>}
          </h3>
          <button onClick={onClose} disabled={busy} title={busy ? "Operation in progress" : "Close"} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {status && !status.isRepo && (
          <div className="git-body">
            {status.gitMissing ? (
              <div className="error">git is not installed or not on PATH.</div>
            ) : (
              <>
                <p className="muted">
                  This folder isn't a git repository yet.
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
                  {status.ahead ? <><ArrowUp size={11} />{status.ahead} ahead </> : null}
                  {status.behind ? <><ArrowDown size={11} />{status.behind} behind</> : null}
                </div>
              ) : null}
            </div>

            {/* Changes */}
            <div className="git-section">
              <div className="git-changes-head">
                <div className="group-label">
                  Changes ({status.files?.length ?? 0}) · {stagedCount} staged
                </div>
                {!status.clean && (
                  <div className="git-stage-all">
                    <button disabled={busy} onClick={() => run(() => gitStageAll())}>
                      Stage all
                    </button>
                    <button disabled={busy || stagedCount === 0} onClick={() => run(() => gitUnstageAll())}>
                      Unstage all
                    </button>
                  </div>
                )}
              </div>
              {status.clean ? (
                <div className="muted small">Working tree clean.</div>
              ) : (
                <div className="git-files">
                  {status.files!.map((f) => (
                    <div key={f.path}>
                      <div className="git-file">
                        <input
                          type="checkbox"
                          checked={f.staged}
                          disabled={busy}
                          title={f.staged ? "Unstage" : "Stage"}
                          onChange={() =>
                            run(() => (f.staged ? gitUnstage([f.path]) : gitStage([f.path])))
                          }
                        />
                        <span className={"git-code " + (f.staged ? "staged" : "")}>{f.code}</span>
                        <span className="git-file-path" onClick={() => showDiff(f.path)}>
                          {f.path}
                        </span>
                        <span className="git-file-label">{f.label}</span>
                      </div>
                      {diffText?.file === f.path && (
                        <div className="git-diff-wrap">
                          <DiffView text={diffText.text} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Commit */}
            <div className="git-section">
              <div className="group-label">Commit staged changes</div>
              <textarea
                rows={2}
                placeholder="Commit message…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="git-actions">
                <button
                  className="primary"
                  disabled={busy || stagedCount === 0 || !message.trim()}
                  onClick={() => run(() => gitCommit(message), () => setMessage(""))}
                >
                  Commit {stagedCount > 0 ? `(${stagedCount})` : ""}
                </button>
                {stagedCount === 0 && !status.clean && (
                  <span className="muted small">Stage files to commit.</span>
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
