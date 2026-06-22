import { useState } from "react";
import type { ResourceView } from "@igb/shared";

/** Read-only viewer for non-editable artifacts (terminology, capabilities, examples). */
export function ResourceViewer({
  view,
  onEditSource,
}: {
  view: ResourceView;
  onEditSource?: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <>
      <div className="profile-head">
        <h2>{view.title ?? view.name ?? view.resourceType}</h2>
        <div className="sub">
          {view.resourceType}
          {view.name && view.name !== view.title ? ` · ${view.name}` : ""}
          {view.status ? ` · ${view.status}` : ""}
        </div>
        {view.description && <p className="res-desc">{view.description}</p>}
        <div className="head-actions">
          <button onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "Hide source" : "View source"}
          </button>
          {onEditSource && <button onClick={onEditSource}>Edit source</button>}
          <span className="readonly-tag">no structured editor</span>
        </div>
      </div>

      {showRaw ? (
        <pre className="raw-source">{view.raw}</pre>
      ) : (
        <>
          {view.fields.length > 0 && (
            <table className="kv">
              <tbody>
                {view.fields.map((f) => (
                  <tr key={f.label}>
                    <th>{f.label}</th>
                    <td>{f.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {view.sections.map((s, i) => (
            <div key={i} className="res-section">
              <div className="group-label">{s.title}</div>
              {s.rows && (
                <table className="kv">
                  <tbody>
                    {s.rows.map((r) => (
                      <tr key={r.label}>
                        <th>{r.label}</th>
                        <td>{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {s.table && (
                <table>
                  <thead>
                    <tr>
                      {s.table.headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.table.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} className={ci === 0 ? "path" : ""}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}

          {view.fields.length === 0 && view.sections.length === 0 && (
            <div className="empty">
              No structured summary for this {view.resourceType}. Use “View source”.
            </div>
          )}
        </>
      )}
    </>
  );
}
