import { useState } from "react";
import type { Edit, ResourceView } from "@igb/shared";
import { Plus, X } from "lucide-react";

const STATUSES = ["draft", "active", "retired", "unknown"];
const GENERATIONS = ["html", "markdown", "xml", "generated"];

function arr<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v as T];
}

/** Structured editor for an ImplementationGuide — so the (huge) ig.xml is visual. */
export function ImplementationGuideEditor({
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
  const set = (path: string, value: string | boolean, label: string) =>
    onEdit({ kind: "setValue", artifactId: id, path, value, description: `${label} = ${value}` });

  const def = data.definition ?? {};

  return (
    <>
      <div className="profile-head">
        <h2>{view.title ?? view.name ?? "ImplementationGuide"}</h2>
        <div className="sub">
          ImplementationGuide{view.name ? ` · ${view.name}` : ""} · {view.language}
        </div>
      </div>

      {/* Metadata */}
      <table className="kv form">
        <tbody>
          <Row label="Status">
            <select value={valueOf("status", data.status)} onChange={(e) => set("status", e.target.value, "status")}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Row>
          <TextRow label="Name" path="name" data={data} valueOf={valueOf} set={set} />
          <TextRow label="Title" path="title" data={data} valueOf={valueOf} set={set} />
          <TextRow label="Version" path="version" data={data} valueOf={valueOf} set={set} />
          <TextRow label="Package id" path="packageId" data={data} valueOf={valueOf} set={set} />
          <TextRow label="FHIR version" path="fhirVersion" data={data} valueOf={valueOf} set={set} />
          <TextRow label="Publisher" path="publisher" data={data} valueOf={valueOf} set={set} />
          <TextRow label="License" path="license" data={data} valueOf={valueOf} set={set} />
          <Row label="Description">
            <textarea
              rows={2}
              value={valueOf("description", data.description)}
              onChange={(e) => set("description", e.target.value, "description")}
            />
          </Row>
        </tbody>
      </table>

      {/* Dependencies */}
      <ListSection
        title="Dependencies"
        items={arr(data.dependsOn)}
        path="dependsOn"
        columns={[
          { header: "Package id", field: "packageId" },
          { header: "URI", field: "uri" },
          { header: "Version", field: "version" },
        ]}
        newItem={{ packageId: "", uri: "", version: "" }}
        rowKey={(d) => d.packageId ?? d.uri}
        id={id}
        pending={pending}
        onEdit={onEdit}
        valueOf={valueOf}
      />

      {/* Resources — the big list */}
      <ResourceList def={def} id={id} pending={pending} onEdit={onEdit} valueOf={valueOf} set={set} />

      {/* Build parameters */}
      <ListSection
        title="Build parameters"
        items={arr(def.parameter)}
        path="definition.parameter"
        columns={[
          { header: "Code", field: "code" },
          { header: "Value", field: "value" },
        ]}
        newItem={{ code: "", value: "" }}
        rowKey={(d) => d.code}
        id={id}
        pending={pending}
        onEdit={onEdit}
        valueOf={valueOf}
      />

      {/* Page tree */}
      {def.page && (
        <div className="res-section">
          <div className="group-label">Pages</div>
          <PageNode page={def.page} path="definition.page" id={id} valueOf={valueOf} set={set} depth={0} />
        </div>
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
  label,
  path,
  data,
  valueOf,
  set,
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

/** Generic add/remove/edit table for a simple array of flat objects. */
function ListSection({
  title,
  items,
  path,
  columns,
  newItem,
  rowKey,
  id,
  pending,
  onEdit,
  valueOf,
}: {
  title: string;
  items: any[];
  path: string;
  columns: { header: string; field: string }[];
  newItem: Record<string, unknown>;
  rowKey: (item: any) => string;
  id: string;
  pending: Edit[];
  onEdit: (e: Edit) => void;
  valueOf: (p: string, b: unknown) => string;
}) {
  const removed = new Set(
    pending
      .filter((e) => e.kind === "removeValue" && e.path.startsWith(`${path}[`))
      .map((e) => Number((e as any).path.slice(`${path}[`.length, -1))),
  );
  const added = pending.filter((e) => e.kind === "addValue" && e.path === path).length;

  return (
    <div className="res-section">
      <div className="group-label">
        {title} ({items.length})
      </div>
      <table className="sp-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.field}>{c.header}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) =>
            removed.has(i) ? null : (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.field}>
                    <input
                      value={valueOf(`${path}[${i}].${c.field}`, it[c.field])}
                      onChange={(e) =>
                        onEdit({
                          kind: "setValue",
                          artifactId: id,
                          path: `${path}[${i}].${c.field}`,
                          value: e.target.value,
                          description: `${title} ${c.field}`,
                        })
                      }
                    />
                  </td>
                ))}
                <td>
                  <button
                    className="chip-x"
                    title="Remove"
                    onClick={() =>
                      onEdit({ kind: "removeValue", artifactId: id, path: `${path}[${i}]`, description: `− ${rowKey(it)}` })
                    }
                  >
                    <X size={13} />
                  </button>
                </td>
              </tr>
            ),
          )}
          {added > 0 && (
            <tr className="dirty">
              <td colSpan={columns.length + 1} className="muted-cell">
                {added} added — save to edit
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="sp-add">
        <button onClick={() => onEdit({ kind: "addValue", artifactId: id, path, value: newItem, description: `+ ${title}` })}>
          <Plus size={13} /> Add
        </button>
      </div>
    </div>
  );
}

/** The definition.resource[] table with a filter (can be hundreds of rows). */
function ResourceList({
  def,
  id,
  pending,
  onEdit,
  valueOf,
  set,
}: {
  def: any;
  id: string;
  pending: Edit[];
  onEdit: (e: Edit) => void;
  valueOf: (p: string, b: unknown) => string;
  set: (p: string, v: string | boolean, l: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const resources = arr(def.resource);
  const path = "definition.resource";
  const removed = new Set(
    pending
      .filter((e) => e.kind === "removeValue" && e.path.startsWith(`${path}[`) && /\]$/.test((e as any).path))
      .map((e) => Number((e as any).path.slice(`${path}[`.length, -1))),
  );
  const q = filter.trim().toLowerCase();
  const rows = resources
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => {
      if (removed.has(i)) return false;
      if (!q) return true;
      const ref = r.reference?.reference ?? "";
      return ref.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q);
    });

  return (
    <div className="res-section">
      <div className="group-label">Resources ({resources.length})</div>
      <input
        className="ig-filter"
        placeholder="Filter resources by reference or name…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="ig-resource-scroll">
        <table className="sp-table">
          <thead>
            <tr>
              <th style={{ width: "28%" }}>Reference</th>
              <th style={{ width: "26%" }}>Name</th>
              <th>Example of (canonical)</th>
              <th style={{ width: "58px" }}>Example</th>
              <th style={{ width: "30px" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, i }) => {
              const exBool = valueOf(`${path}[${i}].exampleBoolean`, r.exampleBoolean) === "true";
              return (
                <tr key={i}>
                  <td>
                    <input
                      value={valueOf(`${path}[${i}].reference.reference`, r.reference?.reference)}
                      onChange={(e) => set(`${path}[${i}].reference.reference`, e.target.value, "reference")}
                    />
                  </td>
                  <td>
                    <input
                      value={valueOf(`${path}[${i}].name`, r.name)}
                      onChange={(e) => set(`${path}[${i}].name`, e.target.value, "name")}
                    />
                  </td>
                  <td>
                    <input
                      placeholder={r.exampleCanonical ? "" : "(not an example)"}
                      value={valueOf(`${path}[${i}].exampleCanonical`, r.exampleCanonical)}
                      onChange={(e) => set(`${path}[${i}].exampleCanonical`, e.target.value, "exampleCanonical")}
                    />
                  </td>
                  <td className="ms-cell">
                    <input
                      type="checkbox"
                      checked={exBool}
                      title="exampleBoolean"
                      onChange={(e) => set(`${path}[${i}].exampleBoolean`, e.target.checked, "exampleBoolean")}
                    />
                  </td>
                  <td>
                    <button
                      className="chip-x"
                      title="Remove"
                      onClick={() =>
                        onEdit({
                          kind: "removeValue",
                          artifactId: id,
                          path: `${path}[${i}]`,
                          description: `− ${r.reference?.reference ?? r.name}`,
                        })
                      }
                    >
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sp-add">
        <button
          onClick={() =>
            onEdit({
              kind: "addValue",
              artifactId: id,
              path,
              value: { reference: { reference: "" }, name: "", exampleBoolean: false },
              description: "+ resource",
            })
          }
        >
          <Plus size={13} /> Add resource
        </button>
      </div>
    </div>
  );
}

/** Recursive editable page node. */
function PageNode({
  page,
  path,
  id,
  valueOf,
  set,
  depth,
}: {
  page: any;
  path: string;
  id: string;
  valueOf: (p: string, b: unknown) => string;
  set: (p: string, v: string, l: string) => void;
  depth: number;
}) {
  const children = arr(page.page);
  return (
    <div className="ig-page" style={{ marginLeft: depth ? 16 : 0 }}>
      <div className="ig-page-row">
        <span className="ig-page-name">{page.nameUrl ?? page.name ?? "(page)"}</span>
        <input
          className="ig-page-title"
          value={valueOf(`${path}.title`, page.title)}
          onChange={(e) => set(`${path}.title`, e.target.value, "page title")}
        />
        <select value={valueOf(`${path}.generation`, page.generation)} onChange={(e) => set(`${path}.generation`, e.target.value, "generation")}>
          {GENERATIONS.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </div>
      {children.map((child, i) => (
        <PageNode
          key={i}
          page={child}
          path={`${path}.page[${i}]`}
          id={id}
          valueOf={valueOf}
          set={set}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
