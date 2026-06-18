import { useState } from "react";
import type { Edit, ResourceView } from "@igb/shared";

const STATUSES = ["draft", "active", "retired", "unknown"];
const SP_TYPES = [
  "number",
  "date",
  "string",
  "token",
  "reference",
  "composite",
  "quantity",
  "uri",
  "special",
];

/** Structured editor for a SearchParameter, emitting generic value edits. */
export function SearchParameterEditor({
  view,
  pending,
  onEdit,
}: {
  view: ResourceView;
  pending: Edit[];
  onEdit: (e: Edit) => void;
}) {
  const data = (view.data ?? {}) as any;

  // Effective value of a scalar path, accounting for pending edits.
  const valueOf = (path: string, base: unknown): string => {
    const p = [...pending].reverse().find(
      (e) => (e.kind === "setValue" || e.kind === "removeValue") && e.path === path,
    );
    if (p?.kind === "removeValue") return "";
    if (p?.kind === "setValue") return p.value === null ? "" : String(p.value);
    return base === undefined || base === null ? "" : String(base);
  };

  const set = (path: string, value: string, label: string) =>
    onEdit({ kind: "setValue", artifactId: view.artifactId, path, value, description: `${label} = ${value}` });

  const bases: string[] = Array.isArray(data.base) ? data.base : data.base ? [data.base] : [];

  return (
    <>
      <div className="profile-head">
        <h2>{view.title ?? view.name ?? "SearchParameter"}</h2>
        <div className="sub">
          SearchParameter{view.name ? ` · ${view.name}` : ""} · {view.language}
        </div>
      </div>

      <table className="kv form">
        <tbody>
          <Field label="Status">
            <select value={valueOf("status", data.status)} onChange={(e) => set("status", e.target.value, "status")}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Code">
            <input value={valueOf("code", data.code)} onChange={(e) => set("code", e.target.value, "code")} />
          </Field>
          <Field label="Type">
            <select value={valueOf("type", data.type)} onChange={(e) => set("type", e.target.value, "type")}>
              <option value=""></option>
              {SP_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Expression">
            <textarea
              rows={2}
              value={valueOf("expression", data.expression)}
              onChange={(e) => set("expression", e.target.value, "expression")}
            />
          </Field>
          <Field label="Derived from">
            <input
              value={valueOf("derivedFrom", data.derivedFrom)}
              onChange={(e) => set("derivedFrom", e.target.value, "derivedFrom")}
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={2}
              value={valueOf("description", data.description)}
              onChange={(e) => set("description", e.target.value, "description")}
            />
          </Field>
        </tbody>
      </table>

      <ArrayEditor
        title="Base resources"
        path="base"
        items={bases}
        pending={pending}
        artifactId={view.artifactId}
        onEdit={onEdit}
        placeholder="e.g. Patient"
      />
      <ArrayEditor
        title="Targets"
        path="target"
        items={Array.isArray(data.target) ? data.target : data.target ? [data.target] : []}
        pending={pending}
        artifactId={view.artifactId}
        onEdit={onEdit}
        placeholder="e.g. Practitioner"
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th>{label}</th>
      <td>{children}</td>
    </tr>
  );
}

/** Add/remove editor for a simple array of code/string values. */
export function ArrayEditor({
  title,
  path,
  items,
  pending,
  artifactId,
  onEdit,
  placeholder,
}: {
  title: string;
  path: string;
  items: string[];
  pending: Edit[];
  artifactId: string;
  onEdit: (e: Edit) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  // Reflect pending add/remove so the list looks live before saving.
  const removed = new Set(
    pending
      .filter((e) => e.kind === "removeValue" && e.path.startsWith(`${path}[`))
      .map((e) => Number((e as any).path.slice(path.length + 1, -1))),
  );
  const added = pending
    .filter((e) => e.kind === "addValue" && e.path === path)
    .map((e) => String((e as any).value));

  return (
    <div className="res-section">
      <div className="group-label">{title}</div>
      <div className="chip-list">
        {items.map((it, i) =>
          removed.has(i) ? null : (
            <span key={i} className="chip">
              {it}
              <button
                title="Remove"
                onClick={() =>
                  onEdit({
                    kind: "removeValue",
                    artifactId,
                    path: `${path}[${i}]`,
                    description: `remove ${path} ${it}`,
                  })
                }
              >
                ✕
              </button>
            </span>
          ),
        )}
        {added.map((it, i) => (
          <span key={"new" + i} className="chip new">
            {it}
          </span>
        ))}
        <span className="chip-add">
          <input
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                onEdit({
                  kind: "addValue",
                  artifactId,
                  path,
                  value: draft.trim(),
                  description: `${path} + ${draft.trim()}`,
                });
                setDraft("");
              }
            }}
          />
        </span>
      </div>
    </div>
  );
}
