import { useEffect, useRef, useState } from "react";
import { FileCode2, Trash2, X } from "lucide-react";
import type { Edit, ResourceSection, ResourceView } from "@igb/shared";
import { ArrayEditor } from "./SearchParameterEditor.js";

const TEXT_STATUSES = ["generated", "extensions", "additional", "empty"] as const;

const EXT_TYPES = [
  { value: "valueString",  label: "string" },
  { value: "valueCode",    label: "code" },
  { value: "valueUri",     label: "uri" },
  { value: "valueBoolean", label: "boolean" },
  { value: "valueInteger", label: "integer" },
  { value: "valueDecimal", label: "decimal" },
] as const;

const EMPTY_NARRATIVE = '<div xmlns="http://www.w3.org/1999/xhtml"><p></p></div>';

function narrativeInner(div: string): string {
  const m = /^<div[^>]*>([\s\S]*)<\/div>\s*$/i.exec(div.trim());
  return m ? m[1] : div;
}

function displayName(data: Record<string, any>): string | undefined {
  if (typeof data.name === "string" && data.name) return data.name;
  if (Array.isArray(data.name) && data.name.length > 0) {
    const n = data.name[0] as Record<string, any>;
    if (typeof n.text === "string" && n.text) return n.text;
    const family = typeof n.family === "string" ? n.family : "";
    const given = Array.isArray(n.given) ? (n.given as string[]).join(" ") : "";
    const full = [given, family].filter(Boolean).join(" ");
    if (full) return full;
  }
  const code = data.code as Record<string, any> | undefined;
  if (code) {
    if (typeof code.text === "string" && code.text) return code.text;
    const coding = Array.isArray(code.coding) ? code.coding[0] : undefined;
    if (coding && typeof coding.display === "string" && coding.display) return coding.display;
  }
  const typeArr = Array.isArray(data.type) ? data.type[0] : undefined;
  if (typeArr && typeof typeArr.text === "string" && typeArr.text) return typeArr.text;
  return undefined;
}

/** Extract sub-paths for each column of an array section (strips "arrayKey[0]." prefix). */
function subPathsFor(s: ResourceSection): string[] {
  const prefix = `${s.arrayKey}[0].`;
  const firstRow = s.table?.rowPaths?.[0] ?? [];
  return firstRow.map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : ""));
}

/** Build an object from dot-path keys + values for addValue edits. */
function buildAddRowObject(subPaths: string[], values: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  subPaths.forEach((sp, ci) => {
    const v = values[ci]?.trim();
    if (!sp || !v) return;
    const parts = sp.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
      cur = cur[parts[i]] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = v;
  });
  return obj;
}

/* ── Narrative WYSIWYG editor ─────────────────────────────────── */

function NarrativeEditor({
  initialHtml,
  onChange,
}: {
  initialHtml: string;
  onChange: (fullDiv: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState("");

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function exec(cmd: string, value?: string) {
    document.execCommand(cmd, false, value ?? undefined);
    ref.current?.focus();
  }

  function handleInput() {
    if (ref.current) {
      onChange(`<div xmlns="http://www.w3.org/1999/xhtml">${ref.current.innerHTML}</div>`);
    }
  }

  function openSource() {
    const inner = ref.current?.innerHTML ?? initialHtml;
    setSourceText(`<div xmlns="http://www.w3.org/1999/xhtml">${inner}</div>`);
    setSourceMode(true);
  }

  function applySource() {
    const inner = narrativeInner(sourceText);
    if (ref.current) ref.current.innerHTML = inner;
    onChange(sourceText);
    setSourceMode(false);
  }

  return (
    <div className="narrative-editor-wrap">
      {!sourceMode && (
        <div className="narrative-toolbar">
          <button type="button" title="Bold"
            onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}>
            <b>B</b>
          </button>
          <button type="button" title="Italic"
            onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}>
            <i>I</i>
          </button>
          <span className="tb-sep" />
          <button type="button" title="Heading"
            onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", "h3"); }}>
            H
          </button>
          <button type="button" title="Paragraph"
            onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", "p"); }}>
            ¶
          </button>
          <span className="tb-sep" />
          <button type="button" title="Bullet list"
            onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}>
            •
          </button>
          <button type="button" title="Numbered list"
            onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}>
            1.
          </button>
          <span className="tb-sep" />
          <button type="button" title="View / edit raw XHTML" onClick={openSource}>
            &lt;/&gt;
          </button>
        </div>
      )}

      {sourceMode ? (
        <div className="narrative-source-wrap">
          <textarea
            className="narrative-textarea"
            rows={14}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            spellCheck={false}
          />
          <div className="narrative-source-foot">
            <button onClick={() => setSourceMode(false)}>Cancel</button>
            <button className="primary" onClick={applySource}>Apply</button>
          </div>
        </div>
      ) : (
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          className="narrative-content-edit"
          onInput={handleInput}
        />
      )}
    </div>
  );
}

/* ── Extension add form ───────────────────────────────────────── */

function ExtensionAddForm({
  extUrl, setExtUrl,
  extType, setExtType,
  extVal, setExtVal,
  onAdd,
  onEditSource,
}: {
  extUrl: string; setExtUrl: (v: string) => void;
  extType: string; setExtType: (v: string) => void;
  extVal: string; setExtVal: (v: string) => void;
  onAdd: () => void;
  onEditSource: () => void;
}) {
  const isBool = extType === "valueBoolean";
  const canAdd = !!extUrl.trim() && (isBool || !!extVal.trim());
  return (
    <>
      <div className="add-form-row">
        <input
          placeholder="Extension URL"
          title="Canonical URL of the extension StructureDefinition"
          value={extUrl}
          onChange={(e) => setExtUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canAdd && onAdd()}
          className="add-form-url"
        />
        <select
          value={extType}
          title="Data type for the extension value"
          className="add-form-type"
          onChange={(e) => {
            const t = e.target.value;
            setExtType(t);
            setExtVal(t === "valueBoolean" ? "true" : "");
          }}
        >
          {EXT_TYPES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {isBool ? (
          <select
            value={extVal}
            onChange={(e) => setExtVal(e.target.value)}
            className="add-form-val"
            title="Boolean value"
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            placeholder="Value"
            title="The value for this extension"
            value={extVal}
            onChange={(e) => setExtVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canAdd && onAdd()}
            className="add-form-val"
          />
        )}
        <button
          className="primary add-form-btn"
          onClick={onAdd}
          disabled={!canAdd}
          title="Add this extension to the resource"
        >
          Add
        </button>
      </div>
      <p className="field-hint">
        For complex values (Coding, CodeableConcept, Reference),{" "}
        <button className="link-btn" onClick={onEditSource}>Edit source</button>.
      </p>
    </>
  );
}

/* ── Main editor ──────────────────────────────────────────────── */

export function ExampleEditor({
  view,
  pending,
  onEdit,
  onEditSource,
}: {
  view: ResourceView;
  pending: Edit[];
  onEdit: (e: Edit) => void;
  onEditSource: () => void;
}) {
  const data = (view.data ?? {}) as Record<string, any>;

  const [addExtUrl, setAddExtUrl] = useState("");
  const [addExtVal, setAddExtVal] = useState("");
  const [addExtType, setAddExtType] = useState("valueString");
  const [addPath, setAddPath] = useState("");
  const [addVal, setAddVal] = useState("");
  const [addRowKey, setAddRowKey] = useState<string | null>(null);
  const [addRowVals, setAddRowVals] = useState<string[]>([]);
  const [addingNarrative, setAddingNarrative] = useState(false);

  useEffect(() => {
    setAddExtUrl("");
    setAddExtVal("");
    setAddExtType("valueString");
    setAddPath("");
    setAddVal("");
    setAddRowKey(null);
    setAddRowVals([]);
    setAddingNarrative(false);
  }, [view.artifactId]);

  const valueOf = (path: string, base: unknown): string => {
    const p = [...pending].reverse().find(
      (e) => (e.kind === "setValue" || e.kind === "removeValue") && e.path === path,
    );
    if (p?.kind === "removeValue") return "";
    if (p?.kind === "setValue") return p.value === null ? "" : String(p.value);
    return base === undefined || base === null ? "" : String(base);
  };

  const set = (path: string, value: string) =>
    onEdit({ kind: "setValue", artifactId: view.artifactId, path, value, description: `${path} = ${value}` });

  const remove = (path: string) =>
    onEdit({ kind: "removeValue", artifactId: view.artifactId, path });

  function addExtension() {
    const url = addExtUrl.trim();
    const raw = addExtVal.trim();
    const isBool = addExtType === "valueBoolean";
    if (!url || (!isBool && !raw)) return;
    let extValue: unknown = raw;
    if (isBool) extValue = raw === "true";
    else if (addExtType === "valueInteger") extValue = parseInt(raw, 10);
    else if (addExtType === "valueDecimal") extValue = parseFloat(raw);
    onEdit({
      kind: "addValue",
      artifactId: view.artifactId,
      path: "extension",
      value: { url, [addExtType]: extValue },
    });
    setAddExtUrl("");
    setAddExtVal("");
    setAddExtType("valueString");
  }

  function addField() {
    const path = addPath.trim();
    if (!path) return;
    set(path, addVal.trim());
    setAddPath("");
    setAddVal("");
  }

  function openAddRow(s: ResourceSection) {
    setAddRowKey(s.arrayKey!);
    setAddRowVals(subPathsFor(s).map(() => ""));
  }

  function submitAddRow(s: ResourceSection) {
    const subPaths = subPathsFor(s);
    const obj = buildAddRowObject(subPaths, addRowVals);
    if (Object.keys(obj).length > 0) {
      onEdit({ kind: "addValue", artifactId: view.artifactId, path: s.arrayKey!, value: obj });
    }
    setAddRowKey(null);
    setAddRowVals([]);
  }

  const profiles: string[] = Array.isArray(data.meta?.profile)
    ? data.meta.profile
    : data.meta?.profile
      ? [String(data.meta.profile)]
      : [];

  const hasStatus = "status" in data;
  const hasName = typeof data.name === "string";
  const hasTitle = typeof data.title === "string";
  const rawNarrative: string = typeof data.text?.div === "string" ? data.text.div : "";
  const narrativeStatus = valueOf("text.status", data.text?.status ?? "");
  const hasNarrative = !!rawNarrative;
  const showNarrativeEditor = hasNarrative || addingNarrative;

  const derivedTitle = displayName(data);
  const title =
    view.title ??
    derivedTitle ??
    (view.name && view.name !== data.id ? view.name : undefined) ??
    `${view.resourceType}/${data.id ?? ""}`;

  const hasExtSection = view.sections.some((s) => s.kind === "extensions");

  return (
    <>
      <div className="profile-head">
        <h2 title={derivedTitle ? "Derived from resource data — edit the relevant field below to change this" : undefined}>
          {title}
        </h2>
        <div className="sub">
          {view.resourceType}
          {data.id ? ` · ${data.id}` : ""} · {view.language}
        </div>
        <button className="src-btn" onClick={onEditSource} title="Edit source">
          <FileCode2 size={14} />
          Edit source
        </button>
      </div>

      {/* Narrative section — shown when it exists or user wants to add one */}
      {showNarrativeEditor ? (
        <div className="res-section">
          <div className="narrative-head">
            <span className="group-label" style={{ marginBottom: 0 }}>Narrative</span>
            <div className="narrative-head-controls">
              <select
                value={narrativeStatus || (addingNarrative ? "generated" : "")}
                onChange={(e) => set("text.status", e.target.value)}
                title="text.status — generated: auto-created by publisher · extensions: narrative + extensions · additional: narrative contains extra info · empty: no meaningful narrative"
              >
                <option value="">—</option>
                {TEXT_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              {!hasNarrative && (
                <button
                  className="secondary"
                  style={{ marginLeft: 8, fontSize: 11 }}
                  onClick={() => setAddingNarrative(false)}
                  title="Cancel adding narrative"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          <NarrativeEditor
            key={view.artifactId + (addingNarrative ? "-new" : "")}
            initialHtml={addingNarrative ? "<p></p>" : narrativeInner(rawNarrative)}
            onChange={(div) => {
              set("text.div", div);
              if (addingNarrative && !narrativeStatus) set("text.status", "generated");
            }}
          />
        </div>
      ) : (
        <div className="res-section">
          <div className="section-header-row">
            <span className="group-label" style={{ marginBottom: 0 }}>Narrative</span>
          </div>
          <button
            className="add-row-btn"
            title="Add a text.div narrative to this resource"
            onClick={() => {
              set("text.status", "generated");
              setAddingNarrative(true);
            }}
          >
            + Add narrative
          </button>
          <p className="field-hint">FHIR resources should include a human-readable narrative summary (text.div).</p>
        </div>
      )}

      <table className="kv form">
        <tbody>
          <Field label="Id">
            <input value={valueOf("id", data.id)} onChange={(e) => set("id", e.target.value)} />
          </Field>
          {hasName && (
            <Field label="Name">
              <input value={valueOf("name", data.name)} onChange={(e) => set("name", e.target.value)} />
            </Field>
          )}
          {hasTitle && (
            <Field label="Title">
              <input value={valueOf("title", data.title)} onChange={(e) => set("title", e.target.value)} />
            </Field>
          )}
          {hasStatus && (
            <Field label="Status">
              <input value={valueOf("status", data.status)} onChange={(e) => set("status", e.target.value)} />
            </Field>
          )}
        </tbody>
      </table>

      <ArrayEditor
        title="Profiles (meta.profile)"
        path="meta.profile"
        items={profiles}
        pending={pending}
        artifactId={view.artifactId}
        onEdit={onEdit}
        placeholder="https://..."
      />

      {view.sections.map((s, i) => {
        const subPaths = s.arrayKey && s.table?.rowPaths?.length ? subPathsFor(s) : [];
        const canAddRow = !!s.arrayKey && subPaths.some((p) => p !== "");

        return (
          <div key={i} className="res-section">
            <div className="section-header-row">
              <span className="group-label" style={{ marginBottom: 0 }}>{s.title}</span>
              {s.arrayKey && (
                <button
                  className="section-del-btn"
                  title={`Remove all ${s.title.toLowerCase()} entries from this resource`}
                  onClick={() => {
                    if (confirm(`Remove all ${s.title.toLowerCase()} entries?`)) {
                      remove(s.arrayKey!);
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>

            {s.rows && (
              <table className="kv form">
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.label}>
                      <th>{r.label}</th>
                      <td>
                        {r.path ? (
                          <input
                            value={valueOf(r.path, r.value)}
                            onChange={(e) => set(r.path!, e.target.value)}
                          />
                        ) : (
                          r.value
                        )}
                      </td>
                      <td className="row-act">
                        {r.removePath && (
                          <button
                            className="row-remove"
                            title={`Remove ${r.label}`}
                            onClick={() => remove(r.removePath!)}
                          >
                            <X size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {s.kind === "extensions" && (
              <ExtensionAddForm
                extUrl={addExtUrl} setExtUrl={setAddExtUrl}
                extType={addExtType} setExtType={setAddExtType}
                extVal={addExtVal} setExtVal={setAddExtVal}
                onAdd={addExtension}
                onEditSource={onEditSource}
              />
            )}

            {s.table && (
              <table className="kv form">
                <thead>
                  <tr>
                    {s.table.headers.map((h) => <th key={h}>{h}</th>)}
                    {s.arrayKey && <th className="row-act-head" />}
                  </tr>
                </thead>
                <tbody>
                  {s.table.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => {
                        const path = s.table!.rowPaths?.[ri]?.[ci];
                        return (
                          <td key={ci}>
                            {path ? (
                              <input
                                value={valueOf(path, cell)}
                                onChange={(e) => set(path, e.target.value)}
                              />
                            ) : cell}
                          </td>
                        );
                      })}
                      {s.arrayKey && (
                        <td className="row-act">
                          <button
                            className="row-remove"
                            title="Remove row"
                            onClick={() => remove(`${s.arrayKey}[${ri}]`)}
                          >
                            <X size={12} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {canAddRow && addRowKey === s.arrayKey && (
                    <tr className="add-row-form-tr">
                      {subPaths.map((sp, ci) => (
                        <td key={ci}>
                          {sp ? (
                            <input
                              placeholder={s.table!.headers[ci]}
                              title={`New ${s.table!.headers[ci].toLowerCase()} value`}
                              value={addRowVals[ci] ?? ""}
                              onChange={(e) => {
                                const nv = [...addRowVals];
                                nv[ci] = e.target.value;
                                setAddRowVals(nv);
                              }}
                              onKeyDown={(e) => e.key === "Enter" && submitAddRow(s)}
                            />
                          ) : (
                            <span className="cell-na" title="This column cannot be set from the add form">—</span>
                          )}
                        </td>
                      ))}
                      <td className="row-act add-row-actions">
                        <button
                          className="primary"
                          title="Add this row"
                          disabled={!addRowVals.some((v) => v?.trim())}
                          onClick={() => submitAddRow(s)}
                        >
                          Add
                        </button>
                        <button
                          title="Cancel"
                          onClick={() => { setAddRowKey(null); setAddRowVals([]); }}
                        >
                          <X size={12} />
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {canAddRow && addRowKey !== s.arrayKey && (
              <button
                className="add-row-btn"
                title={`Add a new ${s.title.toLowerCase()} entry`}
                onClick={() => openAddRow(s)}
              >
                + Add row
              </button>
            )}
          </div>
        );
      })}

      {!hasExtSection && (
        <div className="res-section">
          <div className="group-label">Extensions</div>
          <ExtensionAddForm
            extUrl={addExtUrl} setExtUrl={setAddExtUrl}
            extType={addExtType} setExtType={setAddExtType}
            extVal={addExtVal} setExtVal={setAddExtVal}
            onAdd={addExtension}
            onEditSource={onEditSource}
          />
        </div>
      )}

      <div className="res-section">
        <div className="group-label">Set field</div>
        <div className="add-form-row">
          <input
            placeholder="FHIR path  (e.g. code.text)"
            title="Dot-separated FHIR path to the field you want to set, e.g. code.text or identifier[0].value"
            value={addPath}
            onChange={(e) => setAddPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addField()}
            className="add-form-url"
          />
          <input
            placeholder="Value"
            title="The string value to set at this path"
            value={addVal}
            onChange={(e) => setAddVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addField()}
            className="add-form-val"
          />
          <button
            className="primary add-form-btn"
            onClick={addField}
            disabled={!addPath.trim()}
            title="Set the value at this FHIR path"
          >
            Set
          </button>
        </div>
        <p className="field-hint">
          Set any field by path: <code>code.text</code>, <code>identifier[0].value</code>, <code>birthDate</code>.
          To add a new property that doesn't exist yet, use a path like <code>address[0].city</code> or <code>contact[0].name.text</code>.
          For XML resources, the parent element must already exist — use <button className="link-btn" onClick={onEditSource}>Edit source</button> if unsure.
        </p>
      </div>
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
