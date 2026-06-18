import { useMemo, useState } from "react";
import type {
  Artifact,
  ArtifactCategory,
  Edit,
  ElementFlag,
  ElementView,
  ProfileView,
  ResourceView,
} from "@igb/shared";
import { FLAG_LABELS } from "@igb/shared";
import { applyEdits, getProfile, getResource, gitStatus, loadIg, type GitStatus } from "./api.js";
import { FolderPicker } from "./FolderPicker.js";
import { ResourceViewer } from "./ResourceViewer.js";
import { SearchParameterEditor } from "./SearchParameterEditor.js";
import { CapabilityStatementEditor } from "./CapabilityStatementEditor.js";
import { NewArtifactDialog } from "./NewArtifactDialog.js";
import { GitPanel } from "./GitPanel.js";

const DEFAULT_ROOT = "C:/Users/User/Documents/IG Builder/fixtures/sample-ig";

const CATEGORY_ORDER: ArtifactCategory[] = [
  "Profiles",
  "Extensions",
  "Terminology",
  "Capabilities",
  "Implementation Guide",
  "Examples",
  "Other",
];

export function App() {
  const [root, setRoot] = useState(DEFAULT_ROOT);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [resource, setResource] = useState<ResourceView | null>(null);
  const [pending, setPending] = useState<Edit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [filter, setFilter] = useState("");

  async function refreshGit() {
    try {
      setGit(await gitStatus());
    } catch {
      setGit(null);
    }
  }
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ Examples: true });

  async function doLoad(target = root) {
    setError(null);
    setBusy(true);
    try {
      const summary = await loadIg(target);
      setArtifacts(summary.artifacts);
      setSelected(null);
      setProfile(null);
      setResource(null);
      setPending([]);
      refreshGit();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openArtifact(a: Artifact) {
    setError(null);
    setSelected(a.id);
    setPending([]);
    setProfile(null);
    setResource(null);
    try {
      if (a.editable) setProfile(await getProfile(a.id));
      else setResource(await getResource(a.id));
    } catch (e) {
      setError(String(e));
    }
  }

  function queueEdit(edit: Edit) {
    // Collapse repeated "set" edits to the same target; keep every add/remove.
    const COLLAPSE = new Set(["setCardinality", "setBinding", "setFlag", "setValue"]);
    const sameTarget = (a: Edit, b: Edit) =>
      COLLAPSE.has(a.kind) &&
      a.kind === b.kind &&
      (a as any).path === (b as any).path &&
      (a.kind !== "setFlag" || a.flag === (b as typeof a).flag);
    setPending((prev) => [...prev.filter((e) => !sameTarget(e, edit)), edit]);
  }

  async function reopen(id: string) {
    // Reload whichever view is currently showing this artifact.
    if (resource) setResource(await getResource(id));
    else setProfile(await getProfile(id));
  }

  async function save() {
    if (!selected || pending.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await applyEdits(selected, pending, true);
      await reopen(selected);
      setPending([]);
      refreshGit();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(
    () => groupArtifacts(artifacts, filter),
    [artifacts, filter],
  );
  const total = artifacts.length;
  const shown = grouped.reduce((n, [, items]) => n + items.length, 0);

  return (
    <div className="app">
      <div className="topbar">
        <h1>
          <span className="brand">IG</span> Builder
        </h1>
        <input
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          placeholder="Path to IG folder…"
          spellCheck={false}
        />
        <button onClick={() => setPicking(true)} disabled={busy}>
          Browse…
        </button>
        <button className="primary" onClick={() => doLoad()} disabled={busy}>
          Load IG
        </button>
        {artifacts.length > 0 && (
          <button onClick={() => setCreating(true)} disabled={busy} title="Create a new artifact">
            + New
          </button>
        )}
        {artifacts.length > 0 && (
          <button className="git-chip" onClick={() => setGitOpen(true)} title="Git">
            {git?.isRepo ? (
              <>
                <span className="git-icon">⎇</span> {git.branch}
                {!git.clean && <span className="git-dot" title="uncommitted changes" />}
              </>
            ) : (
              <>
                <span className="git-icon">⎇</span> git
              </>
            )}
          </button>
        )}
      </div>

      {picking && (
        <FolderPicker
          initialPath={root}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setRoot(p);
            setPicking(false);
            doLoad(p);
          }}
        />
      )}

      {creating && (
        <NewArtifactDialog
          artifacts={artifacts}
          onClose={() => setCreating(false)}
          onCreated={async (artifactId) => {
            setCreating(false);
            const summary = await loadIg(root);
            setArtifacts(summary.artifacts);
            const a = summary.artifacts.find((x) => x.id === artifactId);
            if (a) await openArtifact(a);
            refreshGit();
          }}
        />
      )}

      {gitOpen && <GitPanel onClose={() => setGitOpen(false)} onChanged={refreshGit} />}

      {error && <div className="error">{error}</div>}

      <div className="body">
        <aside className="sidebar">
          {artifacts.length > 0 && (
            <div className="sidebar-filter">
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Filter ${total} artifacts…`}
                spellCheck={false}
              />
              {filter && <span className="filter-count">{shown}</span>}
            </div>
          )}
          {grouped.map(([category, items]) => {
            const isCollapsed = collapsed[category] && !filter;
            return (
              <div key={category}>
                <div
                  className="group-label clickable"
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [category]: !c[category] }))
                  }
                >
                  <span className="caret">{isCollapsed ? "▸" : "▾"}</span>
                  {category} ({items.length})
                </div>
                {!isCollapsed &&
                  items.map((a) => (
                    <div
                      key={a.id}
                      className={"artifact" + (a.id === selected ? " active" : "")}
                      onClick={() => openArtifact(a)}
                      title={a.id}
                    >
                      <span className="name">
                        {a.title ?? a.name}
                        {!a.editable && <span className="lock">read-only</span>}
                      </span>
                      <span className="meta">
                        <span className={"badge " + a.language}>{a.language}</span>
                        <span className="rt">{a.resourceType}</span>
                      </span>
                    </div>
                  ))}
              </div>
            );
          })}
          {artifacts.length === 0 && (
            <div className="group-label">Load an IG to begin.</div>
          )}
          {artifacts.length > 0 && shown === 0 && (
            <div className="group-label">No artifacts match “{filter}”.</div>
          )}
        </aside>

        <main className="main">
          {!profile && !resource && (
            <div className="empty">Select an artifact from the sidebar.</div>
          )}
          {profile && (
            <ProfileEditor profile={profile} pending={pending} onEdit={queueEdit} />
          )}
          {resource &&
            (resource.editableType && resource.resourceType === "SearchParameter" ? (
              <SearchParameterEditor view={resource} pending={pending} onEdit={queueEdit} />
            ) : resource.editableType && resource.resourceType === "CapabilityStatement" ? (
              <CapabilityStatementEditor view={resource} pending={pending} onEdit={queueEdit} />
            ) : (
              <ResourceViewer view={resource} />
            ))}
          {pending.length > 0 && (
            <div className="pending-bar">
              <span className="count">{pending.length} unsaved change(s)</span>
              <span className="spacer" />
              <button onClick={() => setPending([])} disabled={busy}>
                Discard
              </button>
              <button className="primary" onClick={save} disabled={busy}>
                Write to source
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function groupArtifacts(
  artifacts: Artifact[],
  filter: string,
): [ArtifactCategory, Artifact[]][] {
  const q = filter.trim().toLowerCase();
  const map = new Map<ArtifactCategory, Artifact[]>();
  for (const a of artifacts) {
    if (
      q &&
      !(a.title ?? a.name).toLowerCase().includes(q) &&
      !a.name.toLowerCase().includes(q) &&
      !a.resourceType.toLowerCase().includes(q) &&
      !a.id.toLowerCase().includes(q)
    )
      continue;
    const arr = map.get(a.category) ?? [];
    arr.push(a);
    map.set(a.category, arr);
  }
  for (const arr of map.values())
    arr.sort((a, b) => (a.title ?? a.name).localeCompare(b.title ?? b.name));
  return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!]);
}

function ProfileEditor({
  profile,
  pending,
  onEdit,
}: {
  profile: ProfileView;
  pending: Edit[];
  onEdit: (e: Edit) => void;
}) {
  const [addExt, setAddExt] = useState(false);
  const [addEl, setAddEl] = useState(false);
  // Element paths the user introduced this session that aren't in the
  // differential yet. They become real rows once an edit is saved.
  const [addedPaths, setAddedPaths] = useState<string[]>([]);

  const existingPaths = new Set(profile.elements.map((e) => e.id));
  const extraRows: ElementView[] = addedPaths
    .filter((p) => !existingPaths.has(p))
    .map((p) => ({ id: p, path: p, inDifferential: false }));

  function addElement(rawPath: string) {
    let p = rawPath.trim();
    if (!p) return;
    // Auto-prefix with the constrained type when the user omits it.
    if (!p.startsWith(profile.type + ".") && p !== profile.type) p = `${profile.type}.${p}`;
    setAddedPaths((prev) => (prev.includes(p) || existingPaths.has(p) ? prev : [...prev, p]));
    setAddEl(false);
  }

  return (
    <>
      <div className="profile-head">
        <h2>{profile.title ?? profile.name}</h2>
        <div className="sub">
          {profile.name} · constrains {profile.type}
          {profile.derivation ? ` · ${profile.derivation}` : ""}
        </div>
        <div className="head-actions">
          <button onClick={() => setAddEl((v) => !v)}>+ Element</button>
          <button onClick={() => setAddExt((v) => !v)}>+ Extension</button>
        </div>
        {addEl && (
          <AddElementForm type={profile.type} onAdd={addElement} onCancel={() => setAddEl(false)} />
        )}
        {addExt && (
          <AddExtensionForm
            artifactId={profile.artifactId}
            basePath={profile.type}
            onAdd={(e) => {
              onEdit(e);
              setAddExt(false);
            }}
            onCancel={() => setAddExt(false)}
          />
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: "34%" }}>Path</th>
            <th style={{ width: "108px" }}>Flags</th>
            <th style={{ width: "14%" }}>Card.</th>
            <th>Binding</th>
            <th style={{ width: "70px" }}></th>
          </tr>
        </thead>
        <tbody>
          {[...profile.elements, ...extraRows].map((el) => (
            <ElementRow
              key={el.id}
              el={el}
              type={profile.type}
              artifactId={profile.artifactId}
              pending={pending}
              onEdit={onEdit}
            />
          ))}
        </tbody>
      </table>
      {pending.some((e) => e.kind === "addSlice" || e.kind === "addExtension") && (
        <div className="pending-adds">
          <div className="group-label">Pending additions</div>
          {pending
            .filter((e) => e.kind === "addSlice" || e.kind === "addExtension")
            .map((e, i) => (
              <div key={i} className="pending-add">
                {e.kind === "addSlice"
                  ? `slice ${e.path}:${e.sliceName} (${e.min}..${e.max})`
                  : `extension ${e.path}.extension:${e.sliceName} → ${e.extensionUrl}`}
              </div>
            ))}
        </div>
      )}
    </>
  );
}

function AddElementForm({
  type,
  onAdd,
  onCancel,
}: {
  type: string;
  onAdd: (path: string) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState("");
  return (
    <div className="inline-form">
      <span className="path-prefix">{type}.</span>
      <input
        autoFocus
        placeholder="element path, e.g. telecom or contact.name"
        size={32}
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onAdd(path);
          if (e.key === "Escape") onCancel();
        }}
      />
      <button className="primary" disabled={!path.trim()} onClick={() => onAdd(path)}>
        Add row
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}

function AddExtensionForm({
  artifactId,
  basePath,
  onAdd,
  onCancel,
}: {
  artifactId: string;
  basePath: string;
  onAdd: (e: Edit) => void;
  onCancel: () => void;
}) {
  const [sliceName, setSliceName] = useState("");
  const [url, setUrl] = useState("");
  const [min, setMin] = useState(0);
  const [max, setMax] = useState("1");
  return (
    <div className="inline-form">
      <input placeholder="slice name" value={sliceName} onChange={(e) => setSliceName(e.target.value)} />
      <input
        placeholder="extension url"
        size={36}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <input className="num" type="number" min={0} value={min} onChange={(e) => setMin(Number(e.target.value))} />
      <span>..</span>
      <input className="num" value={max} onChange={(e) => setMax(e.target.value)} />
      <button
        className="primary"
        disabled={!sliceName || !url}
        onClick={() =>
          onAdd({
            kind: "addExtension",
            artifactId,
            path: basePath,
            sliceName,
            extensionUrl: url,
            min,
            max,
          })
        }
      >
        Add
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}

function AddSliceForm({
  artifactId,
  path,
  onAdd,
  onCancel,
}: {
  artifactId: string;
  path: string;
  onAdd: (e: Edit) => void;
  onCancel: () => void;
}) {
  const [sliceName, setSliceName] = useState("");
  const [min, setMin] = useState(0);
  const [max, setMax] = useState("1");
  const [discPath, setDiscPath] = useState("");
  return (
    <div className="inline-form">
      <input placeholder="slice name" value={sliceName} onChange={(e) => setSliceName(e.target.value)} />
      <input className="num" type="number" min={0} value={min} onChange={(e) => setMin(Number(e.target.value))} />
      <span>..</span>
      <input className="num" value={max} onChange={(e) => setMax(e.target.value)} />
      <input
        placeholder="discriminator path (opt)"
        size={18}
        value={discPath}
        onChange={(e) => setDiscPath(e.target.value)}
      />
      <button
        className="primary"
        disabled={!sliceName}
        onClick={() =>
          onAdd({
            kind: "addSlice",
            artifactId,
            path,
            sliceName,
            min,
            max,
            discriminator: discPath ? { type: "value", path: discPath } : undefined,
          })
        }
      >
        Add
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}

function ElementRow({
  el,
  artifactId,
  pending,
  onEdit,
}: {
  el: ElementView;
  type: string;
  artifactId: string;
  pending: Edit[];
  onEdit: (e: Edit) => void;
}) {
  const [addingSlice, setAddingSlice] = useState(false);
  const editKey = el.id; // slices share path with their base, so key on id
  const pendingCard = pending.find(
    (e) => e.kind === "setCardinality" && e.path === editKey,
  ) as Extract<Edit, { kind: "setCardinality" }> | undefined;
  const pendingBind = pending.find(
    (e) => e.kind === "setBinding" && e.path === editKey,
  ) as Extract<Edit, { kind: "setBinding" }> | undefined;
  const flagEdits = pending.filter(
    (e) => e.kind === "setFlag" && e.path === editKey,
  ) as Extract<Edit, { kind: "setFlag" }>[];
  const flagValue = (flag: ElementFlag, base: boolean | undefined): boolean =>
    flagEdits.find((e) => e.flag === flag)?.value ?? base ?? false;

  const min = pendingCard?.min ?? el.min ?? 0;
  const max = pendingCard?.max ?? el.max ?? "*";
  const vs = pendingBind?.valueSet ?? el.binding?.valueSet ?? "";
  const strength = pendingBind?.strength ?? el.binding?.strength ?? "required";
  const flags: { flag: ElementFlag; on: boolean }[] = [
    { flag: "mustSupport", on: flagValue("mustSupport", el.mustSupport) },
    { flag: "isSummary", on: flagValue("isSummary", el.isSummary) },
    { flag: "isModifier", on: flagValue("isModifier", el.isModifier) },
  ];

  const dirty = !!pendingCard || !!pendingBind || flagEdits.length > 0;
  const isSlice = !!el.sliceName;
  const isExtension = el.path.endsWith(".extension");
  // Only repeating-or-sliceable elements get a slice action; keep it simple by
  // offering it on non-slice rows.
  const canSlice = !isSlice;

  return (
    <>
      <tr className={dirty ? "dirty" : ""}>
        <td className={"path" + (isSlice ? " slice-row" : "")}>
          {isSlice ? (
            <>
              <span className="slice-marker">└</span>
              <span className="badge slice">slice</span> {el.sliceName}
              {isExtension && <span className="badge ext">ext</span>}
              {el.extensionUrl && <span className="ext-url">{el.extensionUrl}</span>}
            </>
          ) : (
            <>
              {el.path}
              {el.slicing && <span className="badge slicing">sliced</span>}
              {!el.inDifferential && <span className="badge new">new</span>}
            </>
          )}
          {el.types && el.types.length > 0 && !isExtension && (
            <span className="flag">{el.types.join(" | ")}</span>
          )}
        </td>
        <td className="ms-cell">
          <div className="flag-toggles">
            {flags.map(({ flag, on }) => (
              <button
                key={flag}
                type="button"
                className={"flag-toggle" + (on ? " on" : "")}
                title={`${flag} — click to ${on ? "clear" : "set"}`}
                onClick={() =>
                  onEdit({ kind: "setFlag", artifactId, path: editKey, flag, value: !on })
                }
              >
                {FLAG_LABELS[flag]}
              </button>
            ))}
          </div>
        </td>
        <td>
        <div className="card-edit">
          <input
            type="number"
            min={0}
            value={min}
            onChange={(e) =>
              onEdit({
                kind: "setCardinality",
                artifactId,
                path: editKey,
                min: Number(e.target.value),
                max,
              })
            }
          />
          <span>..</span>
          <input
            value={max}
            onChange={(e) =>
              onEdit({
                kind: "setCardinality",
                artifactId,
                path: editKey,
                min,
                max: e.target.value,
              })
            }
          />
        </div>
      </td>
      <td className="binding-edit">
        <input
          placeholder="(no binding)"
          value={vs}
          size={28}
          onChange={(e) =>
            onEdit({
              kind: "setBinding",
              artifactId,
              path: editKey,
              valueSet: e.target.value,
              strength: strength as any,
            })
          }
        />{" "}
        <select
          value={strength}
          onChange={(e) =>
            onEdit({
              kind: "setBinding",
              artifactId,
              path: editKey,
              valueSet: vs,
              strength: e.target.value as any,
            })
          }
        >
          <option value="required">required</option>
          <option value="extensible">extensible</option>
          <option value="preferred">preferred</option>
          <option value="example">example</option>
        </select>
      </td>
      <td className="row-actions">
        {canSlice && (
          <button title="Add slice" onClick={() => setAddingSlice((v) => !v)}>
            + slice
          </button>
        )}
      </td>
    </tr>
      {addingSlice && (
        <tr className="form-row">
          <td colSpan={5}>
            <AddSliceForm
              artifactId={artifactId}
              path={el.path}
              onAdd={(e) => {
                onEdit(e);
                setAddingSlice(false);
              }}
              onCancel={() => setAddingSlice(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}
