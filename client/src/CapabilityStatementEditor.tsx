import { useState } from "react";
import type { Edit, ResourceView } from "@igb/shared";

const STATUSES = ["draft", "active", "retired", "unknown"];
const INTERACTIONS = [
  "read",
  "vread",
  "update",
  "patch",
  "delete",
  "history-instance",
  "history-type",
  "create",
  "search-type",
];

function arr<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v as T];
}

/** Structured editor for a CapabilityStatement's REST resource matrix. */
export function CapabilityStatementEditor({
  view,
  pending,
  onEdit,
}: {
  view: ResourceView;
  pending: Edit[];
  onEdit: (e: Edit) => void;
}) {
  const data = (view.data ?? {}) as any;
  const id = view.artifactId;

  const valueOf = (path: string, base: unknown): string => {
    const p = [...pending].reverse().find(
      (e) => (e.kind === "setValue" || e.kind === "removeValue") && e.path === path,
    );
    if (p?.kind === "removeValue") return "";
    if (p?.kind === "setValue") return p.value === null ? "" : String(p.value);
    return base === undefined || base === null ? "" : String(base);
  };
  const set = (path: string, value: string, label: string) =>
    onEdit({ kind: "setValue", artifactId: id, path, value, description: `${label} = ${value}` });

  return (
    <>
      <div className="profile-head">
        <h2>{view.title ?? view.name ?? "CapabilityStatement"}</h2>
        <div className="sub">
          CapabilityStatement{view.name ? ` · ${view.name}` : ""} · {view.language}
        </div>
      </div>

      <table className="kv form">
        <tbody>
          <tr>
            <th>Status</th>
            <td>
              <select value={valueOf("status", data.status)} onChange={(e) => set("status", e.target.value, "status")}>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </td>
          </tr>
          <tr>
            <th>Title</th>
            <td>
              <input value={valueOf("title", data.title)} onChange={(e) => set("title", e.target.value, "title")} />
            </td>
          </tr>
          <tr>
            <th>Date</th>
            <td>
              <input value={valueOf("date", data.date)} onChange={(e) => set("date", e.target.value, "date")} />
            </td>
          </tr>
          <tr>
            <th>Description</th>
            <td>
              <textarea
                rows={2}
                value={valueOf("description", data.description)}
                onChange={(e) => set("description", e.target.value, "description")}
              />
            </td>
          </tr>
        </tbody>
      </table>

      {arr(data.rest).map((rest: any, ri: number) => (
        <div key={ri} className="res-section">
          <div className="group-label">
            REST · {valueOf(`rest[${ri}].mode`, rest.mode) || "server"}
          </div>
          {arr(rest.resource).map((res: any, rj: number) => (
            <ResourceCard
              key={rj}
              base={`rest[${ri}].resource[${rj}]`}
              res={res}
              artifactId={id}
              pending={pending}
              onEdit={onEdit}
              valueOf={valueOf}
              set={set}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function ResourceCard({
  base,
  res,
  artifactId,
  pending,
  onEdit,
  valueOf,
  set,
}: {
  base: string;
  res: any;
  artifactId: string;
  pending: Edit[];
  onEdit: (e: Edit) => void;
  valueOf: (path: string, base: unknown) => string;
  set: (path: string, value: string, label: string) => void;
}) {
  const interactions = arr(res.interaction);
  const currentCodes = new Set(interactions.map((i: any) => i.code));
  const searchParams = arr(res.searchParam);

  // Pending-aware interaction state.
  const pendingAddCodes = pending
    .filter((e) => e.kind === "addValue" && e.path === `${base}.interaction`)
    .map((e) => (e as any).value?.code);
  const pendingRemovedIdx = new Set(
    pending
      .filter((e) => e.kind === "removeValue" && e.path.startsWith(`${base}.interaction[`))
      .map((e) => Number((e as any).path.slice(`${base}.interaction[`.length, -1))),
  );
  const effectiveCodes = new Set<string>();
  interactions.forEach((it: any, k: number) => {
    if (!pendingRemovedIdx.has(k)) effectiveCodes.add(it.code);
  });
  pendingAddCodes.forEach((c) => c && effectiveCodes.add(c));

  const toggleInteraction = (code: string) => {
    if (effectiveCodes.has(code)) {
      const idx = interactions.findIndex((i: any) => i.code === code);
      if (idx >= 0)
        onEdit({
          kind: "removeValue",
          artifactId,
          path: `${base}.interaction[${idx}]`,
          description: `${res.type} − ${code}`,
        });
    } else {
      onEdit({
        kind: "addValue",
        artifactId,
        path: `${base}.interaction`,
        value: { code },
        description: `${res.type} + ${code}`,
      });
    }
  };

  return (
    <div className="cs-resource">
      <div className="cs-resource-type">{res.type ?? "(resource)"}</div>
      <table className="kv form">
        <tbody>
          <tr>
            <th>Profile</th>
            <td>
              <input
                value={valueOf(`${base}.profile`, res.profile)}
                onChange={(e) => set(`${base}.profile`, e.target.value, `${res.type} profile`)}
              />
            </td>
          </tr>
        </tbody>
      </table>

      <div className="cs-label">Interactions</div>
      <div className="flag-toggles wrap">
        {INTERACTIONS.map((code) => (
          <button
            key={code}
            type="button"
            className={"flag-toggle" + (effectiveCodes.has(code) ? " on" : "")}
            onClick={() => toggleInteraction(code)}
          >
            {code}
          </button>
        ))}
      </div>

      <SearchParamEditor
        base={base}
        resType={res.type}
        items={searchParams}
        pending={pending}
        artifactId={artifactId}
        onEdit={onEdit}
      />
    </div>
  );
}

function SearchParamEditor({
  base,
  resType,
  items,
  pending,
  artifactId,
  onEdit,
}: {
  base: string;
  resType: string;
  items: any[];
  pending: Edit[];
  artifactId: string;
  onEdit: (e: Edit) => void;
}) {
  const [draft, setDraft] = useState("");
  const path = `${base}.searchParam`;
  const removed = new Set(
    pending
      .filter((e) => e.kind === "removeValue" && e.path.startsWith(`${path}[`))
      .map((e) => Number((e as any).path.slice(`${path}[`.length, -1))),
  );
  const added = pending
    .filter((e) => e.kind === "addValue" && e.path === path)
    .map((e) => (e as any).value?.name);

  return (
    <>
      <div className="cs-label">Search params</div>
      <div className="chip-list">
        {items.map((sp, i) =>
          removed.has(i) ? null : (
            <span key={i} className="chip">
              {sp.name}
              <button
                title="Remove"
                onClick={() =>
                  onEdit({
                    kind: "removeValue",
                    artifactId,
                    path: `${path}[${i}]`,
                    description: `${resType} − search ${sp.name}`,
                  })
                }
              >
                ✕
              </button>
            </span>
          ),
        )}
        {added.map((nm, i) => (
          <span key={"n" + i} className="chip new">
            {nm}
          </span>
        ))}
        <span className="chip-add">
          <input
            value={draft}
            placeholder="search param name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                onEdit({
                  kind: "addValue",
                  artifactId,
                  path,
                  value: { name: draft.trim() },
                  description: `${resType} + search ${draft.trim()}`,
                });
                setDraft("");
              }
            }}
          />
        </span>
      </div>
    </>
  );
}
