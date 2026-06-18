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

const EXPECTATION_URL =
  "http://hl7.org/fhir/StructureDefinition/capabilitystatement-expectation";
const CONFORMANCE = ["SHALL", "SHOULD", "MAY", "SHOULD-NOT"];

/** Index of the conformance (expectation) extension within an element's extensions. */
function expectationIndex(el: any): number {
  return arr(el?.extension).findIndex((x: any) => x?.url === EXPECTATION_URL);
}
function expectationValue(el: any): string {
  const e = arr(el?.extension).find((x: any) => x?.url === EXPECTATION_URL);
  return e?.valueCode ?? "";
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
  const removedIdx = new Set(
    pending
      .filter((e) => e.kind === "removeValue" && e.path.startsWith(`${path}[`) && /\]$/.test((e as any).path))
      .map((e) => Number((e as any).path.slice(`${path}[`.length, -1)))
      .filter((n) => !Number.isNaN(n)),
  );
  const added = pending
    .filter((e) => e.kind === "addValue" && e.path === path)
    .map((e) => (e as any).value?.name);

  // Effective value of a scalar at a searchParam sub-path, pending-aware.
  const valueOf = (p: string, b: unknown): string => {
    const pe = [...pending].reverse().find(
      (e) => (e.kind === "setValue" || e.kind === "removeValue") && e.path === p,
    );
    if (pe?.kind === "removeValue") return "";
    if (pe?.kind === "setValue") return pe.value === null ? "" : String(pe.value);
    return b === undefined || b === null ? "" : String(b);
  };

  const setConformance = (sp: any, i: number, level: string) => {
    const ei = expectationIndex(sp);
    if (!level) {
      if (ei >= 0)
        onEdit({ kind: "removeValue", artifactId, path: `${path}[${i}].extension[${ei}]`, description: `${resType} ${sp.name} conformance cleared` });
      return;
    }
    if (ei >= 0) {
      onEdit({ kind: "setValue", artifactId, path: `${path}[${i}].extension[${ei}].valueCode`, value: level, description: `${resType} ${sp.name} → ${level}` });
    } else {
      onEdit({ kind: "addValue", artifactId, path: `${path}[${i}].extension`, value: { url: EXPECTATION_URL, valueCode: level }, description: `${resType} ${sp.name} → ${level}` });
    }
  };

  return (
    <>
      <div className="cs-label">Search params</div>
      <table className="sp-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Conformance</th>
            <th>Documentation</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((sp, i) =>
            removedIdx.has(i) ? null : (
              <tr key={i}>
                <td className="path">{sp.name}</td>
                <td>
                  <input
                    className="sm"
                    value={valueOf(`${path}[${i}].type`, sp.type)}
                    placeholder="token…"
                    onChange={(e) =>
                      onEdit({ kind: "setValue", artifactId, path: `${path}[${i}].type`, value: e.target.value, description: `${sp.name} type` })
                    }
                  />
                </td>
                <td>
                  <select
                    value={expectationValue(sp)}
                    onChange={(e) => setConformance(sp, i, e.target.value)}
                  >
                    <option value="">—</option>
                    {CONFORMANCE.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={valueOf(`${path}[${i}].documentation`, sp.documentation)}
                    placeholder="documentation…"
                    onChange={(e) =>
                      onEdit({ kind: "setValue", artifactId, path: `${path}[${i}].documentation`, value: e.target.value, description: `${sp.name} documentation` })
                    }
                  />
                </td>
                <td>
                  <button
                    className="chip-x"
                    title="Remove"
                    onClick={() =>
                      onEdit({ kind: "removeValue", artifactId, path: `${path}[${i}]`, description: `${resType} − search ${sp.name}` })
                    }
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ),
          )}
          {added.map((nm, i) => (
            <tr key={"n" + i} className="dirty">
              <td className="path">{nm}</td>
              <td colSpan={4} className="muted-cell">added — edit after saving</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sp-add">
        <input
          value={draft}
          placeholder="add search param name…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              onEdit({ kind: "addValue", artifactId, path, value: { name: draft.trim() }, description: `${resType} + search ${draft.trim()}` });
              setDraft("");
            }
          }}
        />
      </div>
    </>
  );
}
