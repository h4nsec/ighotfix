import { useEffect, useState } from "react";
import { browse, getHome, type BrowseResult } from "./api.js";

/**
 * A server-backed folder navigator. Lets the user walk the filesystem (drives →
 * folders) and pick an IG directory instead of typing an absolute path.
 */
export function FolderPicker({
  initialPath,
  onPick,
  onClose,
}: {
  initialPath?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function go(path: string) {
    setLoading(true);
    setError(null);
    try {
      setResult(await browse(path));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      const start = initialPath || (await getHome().catch(() => ""));
      await go(start);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const looksLikeIg =
    !!result &&
    (result.igMarkers.length > 0 ||
      result.fileCounts.fsh + result.fileCounts.json + result.fileCounts.xml > 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Choose IG folder</h3>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="picker-path">
          <button
            disabled={!result || result.parent === null}
            onClick={() => result?.parent !== null && go(result!.parent ?? "")}
            title="Up one level"
          >
            ↑ Up
          </button>
          <code>{result?.path || "Drives"}</code>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="picker-list">
          {loading && <div className="picker-empty">Loading…</div>}
          {!loading && result?.dirs.length === 0 && (
            <div className="picker-empty">No sub-folders here.</div>
          )}
          {!loading &&
            result?.dirs.map((d) => (
              <div key={d.path} className="picker-row" onDoubleClick={() => go(d.path)}>
                <button className="picker-name" onClick={() => go(d.path)}>
                  📁 {d.name}
                </button>
                {d.igMarkers.length > 0 && (
                  <span className="badge ig" title={d.igMarkers.join(", ")}>
                    IG
                  </span>
                )}
              </div>
            ))}
        </div>

        <div className="picker-foot">
          <div className="picker-hint">
            {result && result.path && (
              <>
                {looksLikeIg ? (
                  <span className="good">
                    Looks like an IG
                    {result.igMarkers.length > 0 ? ` (${result.igMarkers.join(", ")})` : ""}
                  </span>
                ) : (
                  <span className="muted">No IG markers in this folder</span>
                )}
                <span className="counts">
                  {" · "}
                  {result.fileCounts.fsh} fsh · {result.fileCounts.json} json ·{" "}
                  {result.fileCounts.xml} xml
                </span>
              </>
            )}
          </div>
          <button
            className="primary"
            disabled={!result?.path}
            onClick={() => result?.path && onPick(result.path)}
          >
            Use this folder
          </button>
        </div>
      </div>
    </div>
  );
}
