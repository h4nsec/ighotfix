import { useState } from "react";
import type { Edit, ResourceView } from "@igb/shared";
import { Plus, X } from "lucide-react";

const STATUSES = ["draft", "active", "retired", "unknown"];
const CS_CONTENT = ["complete", "fragment", "not-present", "example", "supplement"];

function arr<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v as T];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function TerminologyEditor({
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
  const rt = view.resourceType;

  const valueOf = (path: string, base: unknown): string => {
    const p = [...pending].reverse().find(
      (e) => (e.kind === "setValue" || e.kind === "removeValue") && e.path === path,
    );
    if (p?.kind === "removeValue") return "";
    if (p?.kind === "setValue") return p.value === null ? "" : String(p.value);
    return base === undefined || base === null ? "" : String(base);
  };

  const set = (path: string, value: string | boolean, label: string) =>
    onEdit({ kind: "setValue", artifactId: id, path, value, description: `${label} = ${value}` });

  return (
    <>
      <div className="profile-head">
        <h2>{view.title ?? view.name ?? rt}</h2>
        <div className="sub">
          {rt}{view.name ? ` · ${view.name}` : ""} · {view.language}
        </div>
      </div>

      <table className="kv form">
        <tbody>
          <Row label="Status">
            <select value={valueOf("status", data.status)} onChange={(e) => set("status", e.target.value, "status")}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Row>
          <TextRow label="Name" path="name" data={data} valueOf={valueOf} set={set} />
          <TextRow label="Title" path="title" data={data} valueOf={valueOf} set={set} />
          <TextRow label="Version" path="version" data={data} valueOf={valueOf} set={set} />
          <TextRow label="Publisher" path="publisher" data={data} valueOf={valueOf} set={set} />
          <Row label="Description">
            <textarea
              rows={2}
              value={valueOf("description", data.description)}
              onChange={(e) => set("description", e.target.value, "description")}
            />
          </Row>
          {rt === "CodeSystem" && (
            <>
              <Row label="Content">
                <select value={valueOf("content", data.content)} onChange={(e) => set("content", e.target.value, "content")}>
                  <option value=""></option>
                  {CS_CONTENT.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Row>
              <Row label="Case sensitive">
                <input
                  type="checkbox"
                  checked={valueOf("caseSensitive", data.caseSensitive) === "true"}
                  onChange={(e) => set("caseSensitive", e.target.checked, "caseSensitive")}
                />
              </Row>
            </>
          )}
        </tbody>
      </table>

      {rt === "CodeSystem" && (
        <ConceptTable
          concepts={arr(data.concept)}
          path="concept"
          id={id}
          pending={pending}
          onEdit={onEdit}
          valueOf={valueOf}
        />
      )}

      {rt === "ValueSet" && (
        <ComposeSection
          compose={data.compose ?? {}}
          id={id}
          pending={pending}
          onEdit={onEdit}
          valueOf={valueOf}
        />
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th>{label}</th>
      <td>{children}</td>
    </tr>
  );
}

function TextRow({
  label, path, data, valueOf, set,
}: {
  label: string;
  path: string;
  data: any;
  valueOf: (p: string, b: unknown) => string;
  set: (p: string, v: string, l: string) => void;
}) {
  return (
    <Row label={label}>
      <input value={valueOf(path, data[path])} onChange={(e) => set(path, e.target.value, label)} />
    </Row>
  );
}

function ConceptTable({
  concepts,
  path,
  id,
  pending,
  onEdit,
  valueOf,
}: {
  concepts: any[];
  path: string;
  id: string;
  pending: Edit[];
  onEdit: (e: Edit) => void;
  valueOf: (p: string, b: unknown) => string;
}) {
  const [draftCode, setDraftCode] = useState("");
  const [draftDisplay, setDraftDisplay] = useState("");

  const pathRe = new RegExp(`^${escapeRe(path)}\\[\\d+\\]$`);
  const removed = new Set(
    pending
      .filter((e) => e.kind === "removeValue" && pathRe.test(e.path))
      .map((e) => Number(/\[(\d+)\]$/.exec(e.path)?.[1]))
      .filter((n) => !isNaN(n)),
  );
  const addedCount = pending.filter((e) => e.kind === "addValue" && e.path === path).length;

  const add = () => {
    if (!draftCode.trim()) return;
    onEdit({
      kind: "addValue",
      artifactId: id,
      path,
      value: draftDisplay.trim()
        ? { code: draftCode.trim(), display: draftDisplay.trim() }
        : { code: draftCode.trim() },
      description: `+ concept ${draftCode.trim()}`,
    });
    setDraftCode("");
    setDraftDisplay("");
  };

  return (
    <div className="res-section">
      <div className="group-label">Concepts ({concepts.length})</div>
      <table className="sp-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Display</th>
            <th>Definition</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {concepts.map((c, i) =>
            removed.has(i) ? null : (
              <tr key={i}>
                <td>
                  <input
                    value={valueOf(`${path}[${i}].code`, c.code)}
                    onChange={(e) =>
                      onEdit({ kind: "setValue", artifactId: id, path: `${path}[${i}].code`, value: e.target.value, description: "concept code" })
                    }
                  />
                </td>
                <td>
                  <input
                    value={valueOf(`${path}[${i}].display`, c.display)}
                    onChange={(e) =>
                      onEdit({ kind: "setValue", artifactId: id, path: `${path}[${i}].display`, value: e.target.value, description: "concept display" })
                    }
                  />
                </td>
                <td>
                  <input
                    value={valueOf(`${path}[${i}].definition`, c.definition)}
                    onChange={(e) =>
                      onEdit({ kind: "setValue", artifactId: id, path: `${path}[${i}].definition`, value: e.target.value, description: "concept definition" })
                    }
                  />
                </td>
                <td>
                  <button
                    className="chip-x"
                    title="Remove concept"
                    onClick={() =>
                      onEdit({ kind: "removeValue", artifactId: id, path: `${path}[${i}]`, description: `− concept ${c.code}` })
                    }
                  >
                    <X size={13} />
                  </button>
                </td>
              </tr>
            ),
          )}
          {addedCount > 0 && (
            <tr className="dirty">
              <td colSpan={4} className="muted-cell">{addedCount} added — save to edit</td>
            </tr>
          )}
          <tr className="add-row">
            <td>
              <input
                placeholder="code"
                value={draftCode}
                onChange={(e) => setDraftCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
              />
            </td>
            <td>
              <input
                placeholder="display"
                value={draftDisplay}
                onChange={(e) => setDraftDisplay(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
              />
            </td>
            <td colSpan={2}>
              <button onClick={add} disabled={!draftCode.trim()}>
                <Plus size={13} /> Add
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ComposeSection({
  compose,
  id,
  pending,
  onEdit,
  valueOf,
}: {
  compose: any;
  id: string;
  pending: Edit[];
  onEdit: (e: Edit) => void;
  valueOf: (p: string, b: unknown) => string;
}) {
  const [draftSystem, setDraftSystem] = useState("");
  const includes: any[] = arr(compose.include);

  const removedIncludes = new Set(
    pending
      .filter((e) => e.kind === "removeValue" && /^compose\.include\[\d+\]$/.test(e.path))
      .map((e) => Number(/\[(\d+)\]$/.exec(e.path)?.[1]))
      .filter((n) => !isNaN(n)),
  );
  const addedIncludes = pending.filter((e) => e.kind === "addValue" && e.path === "compose.include").length;

  const addInclude = () => {
    if (!draftSystem.trim()) return;
    onEdit({
      kind: "addValue",
      artifactId: id,
      path: "compose.include",
      value: { system: draftSystem.trim() },
      description: `+ include ${draftSystem.trim()}`,
    });
    setDraftSystem("");
  };

  return (
    <div className="res-section">
      <div className="group-label">Compose · Include ({includes.length})</div>
      {includes.map((inc, i) =>
        removedIncludes.has(i) ? null : (
          <IncludeBlock
            key={i}
            inc={inc}
            idx={i}
            id={id}
            pending={pending}
            onEdit={onEdit}
            valueOf={valueOf}
          />
        ),
      )}
      {addedIncludes > 0 && (
        <div className="muted-cell" style={{ padding: "4px 12px 8px" }}>
          {addedIncludes} include(s) added — save to edit
        </div>
      )}
      <div className="include-add-row">
        <input
          placeholder="System URL (e.g. http://terminology.hl7.org/CodeSystem/…)"
          value={draftSystem}
          onChange={(e) => setDraftSystem(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addInclude()}
        />
        <button disabled={!draftSystem.trim()} onClick={addInclude}>
          <Plus size={13} /> Add include
        </button>
      </div>
    </div>
  );
}

function IncludeBlock({
  inc, idx, id, pending, onEdit, valueOf,
}: {
  inc: any;
  idx: number;
  id: string;
  pending: Edit[];
  onEdit: (e: Edit) => void;
  valueOf: (p: string, b: unknown) => string;
}) {
  const prefix = `compose.include[${idx}]`;
  const concepts: any[] = arr(inc.concept);
  const filters: any[] = arr(inc.filter);

  return (
    <div className="include-block">
      <div className="include-head">
        <input
          className="system-input"
          value={valueOf(`${prefix}.system`, inc.system)}
          placeholder="system URL"
          onChange={(e) =>
            onEdit({ kind: "setValue", artifactId: id, path: `${prefix}.system`, value: e.target.value, description: "include system" })
          }
        />
        <input
          className="version-input"
          placeholder="version"
          value={valueOf(`${prefix}.version`, inc.version ?? "")}
          onChange={(e) =>
            onEdit({ kind: "setValue", artifactId: id, path: `${prefix}.version`, value: e.target.value, description: "include version" })
          }
        />
        <button
          className="chip-x"
          title="Remove include"
          onClick={() =>
            onEdit({ kind: "removeValue", artifactId: id, path: prefix, description: `− include ${inc.system ?? ""}` })
          }
        >
          <X size={13} />
        </button>
      </div>
      {concepts.length > 0 && (
        <ConceptTable
          concepts={concepts}
          path={`${prefix}.concept`}
          id={id}
          pending={pending}
          onEdit={onEdit}
          valueOf={valueOf}
        />
      )}
      {filters.length > 0 && concepts.length === 0 && (
        <div className="muted-cell" style={{ padding: "4px 12px 8px" }}>
          {filters.length} filter rule(s) — use Edit source to modify
        </div>
      )}
    </div>
  );
}
