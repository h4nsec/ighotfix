import { useEffect, useState } from "react";
import { browse, getHome, type BrowseResult } from "./api.js";
import { BookMarked, Check, ChevronRight, Folder, Monitor, X } from "lucide-react";

function parseBreadcrumbs(path: string): { label: string; path: string }[] {
  if (!path) return [];
  const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = norm.split("/").filter(Boolean);
  if (!parts.length) return [];

  const isDrive = /^[A-Za-z]:$/.test(parts[0]);

  return parts.map((label, i) => {
    let built: string;
    if (i === 0 && isDrive) {
      built = label + "/";
    } else if (isDrive) {
      built = parts[0] + "/" + parts.slice(1, i + 1).join("/");
    } else {
      built = "/" + parts.slice(0, i + 1).join("/");
    }
    return { label, path: built };
  });
}

export function FolderPicker({
  initialPath,
  title = "Choose IG folder",
  onPick,
  onClose,
}: {
  initialPath?: string;
  title?: string;
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

  const crumbs = result?.path ? parseBreadcrumbs(result.path) : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>

        <div className="picker-breadcrumbs">
          {crumbs.length === 0 ? (
            <span className="picker-crumb current">Computer</span>
          ) : (
            <>
              <button
                className="picker-root-btn"
                onClick={() => go("")}
                title="Browse drives"
              >
                <Monitor size={13} />
              </button>
              {crumbs.map((crumb, i) => (
                <span key={crumb.path} style={{ display: "contents" }}>
                  <ChevronRight size={12} className="picker-sep" />
                  <button
                    className={"picker-crumb" + (i === crumbs.length - 1 ? " current" : "")}
                    onClick={() => i < crumbs.length - 1 && go(crumb.path)}
                    disabled={i === crumbs.length - 1}
                    title={crumb.path}
                  >
                    {crumb.label}
                  </button>
                </span>
              ))}
            </>
          )}
        </div>

        {error && <div className="error">{error}</div>}

        <div className="picker-list">
          {loading && (
            <div className="picker-loading">
              <div className="picker-spinner" />
              Loading…
            </div>
          )}
          {!loading && result?.dirs.length === 0 && (
            <div className="picker-empty">No sub-folders here.</div>
          )}
          {!loading &&
            result?.dirs.map((d) => (
              <div
                key={d.path}
                className={"picker-row" + (d.igMarkers.length > 0 ? " ig-folder" : "")}
              >
                <span className={"picker-icon" + (d.igMarkers.length > 0 ? " ig-icon" : "")}>
                  {d.igMarkers.length > 0 ? <BookMarked size={14} /> : <Folder size={14} />}
                </span>
                <button className="picker-name" onClick={() => go(d.path)}>
                  {d.name}
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
                    <Check size={13} /> Looks like an IG
                    {result.igMarkers.length > 0 ? ` (${result.igMarkers.join(", ")})` : ""}
                  </span>
                ) : (
                  <span className="muted">No IG markers detected</span>
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
