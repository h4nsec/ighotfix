import { useEffect, useMemo, useState } from "react";
import type { Artifact, Edit, ElementView, ProfileView } from "@igb/shared";
import { applyEdits, getProfile, loadIg } from "./api.js";

const DEFAULT_ROOT = "C:/Users/User/Documents/IG Builder/fixtures/sample-ig";

export function App() {
  const [root, setRoot] = useState(DEFAULT_ROOT);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [pending, setPending] = useState<Edit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function doLoad() {
    setError(null);
    setBusy(true);
    try {
      const summary = await loadIg(root);
      setArtifacts(summary.artifacts);
      setSelected(null);
      setProfile(null);
      setPending([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openArtifact(a: Artifact) {
    if (!a.supported) return;
    setError(null);
    setSelected(a.id);
    setPending([]);
    try {
      setProfile(await getProfile(a.id));
    } catch (e) {
      setError(String(e));
      setProfile(null);
    }
  }

  function queueEdit(edit: Edit) {
    // Replace any prior pending edit of the same kind+path.
    setPending((prev) => [
      ...prev.filter((e) => !(e.kind === edit.kind && e.path === edit.path)),
      edit,
    ]);
  }

  async function save() {
    if (!selected || pending.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await applyEdits(selected, pending, true);
      setProfile(await getProfile(selected));
      setPending([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => groupArtifacts(artifacts), [artifacts]);

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
        <button className="primary" onClick={doLoad} disabled={busy}>
          Load IG
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="body">
        <aside className="sidebar">
          {grouped.map(([type, items]) => (
            <div key={type}>
              <div className="group-label">
                {type} ({items.length})
              </div>
              {items.map((a) => (
                <div
                  key={a.id}
                  className={
                    "artifact" +
                    (a.id === selected ? " active" : "") +
                    (a.supported ? "" : " unsupported")
                  }
                  onClick={() => openArtifact(a)}
                >
                  <span className="name">{a.name}</span>
                  <span className="meta">
                    <span className={"badge " + a.language}>{a.language}</span>
                    <span>{a.id}</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
          {artifacts.length === 0 && (
            <div className="group-label">Load an IG to begin.</div>
          )}
        </aside>

        <main className="main">
          {!profile && <div className="empty">Select a profile to edit.</div>}
          {profile && (
            <ProfileEditor
              profile={profile}
              pending={pending}
              onEdit={queueEdit}
            />
          )}
          {profile && pending.length > 0 && (
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

function groupArtifacts(artifacts: Artifact[]): [string, Artifact[]][] {
  const map = new Map<string, Artifact[]>();
  for (const a of artifacts) {
    const arr = map.get(a.resourceType) ?? [];
    arr.push(a);
    map.set(a.resourceType, arr);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
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
  return (
    <>
      <div className="profile-head">
        <h2>{profile.title ?? profile.name}</h2>
        <div className="sub">
          {profile.name} · constrains {profile.type}
          {profile.derivation ? ` · ${profile.derivation}` : ""}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: "35%" }}>Path</th>
            <th style={{ width: "15%" }}>Card.</th>
            <th>Binding</th>
          </tr>
        </thead>
        <tbody>
          {profile.elements.map((el) => (
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
    </>
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
  const pendingCard = pending.find(
    (e) => e.kind === "setCardinality" && e.path === el.path,
  ) as Extract<Edit, { kind: "setCardinality" }> | undefined;
  const pendingBind = pending.find(
    (e) => e.kind === "setBinding" && e.path === el.path,
  ) as Extract<Edit, { kind: "setBinding" }> | undefined;

  const min = pendingCard?.min ?? el.min ?? 0;
  const max = pendingCard?.max ?? el.max ?? "*";
  const vs = pendingBind?.valueSet ?? el.binding?.valueSet ?? "";
  const strength = pendingBind?.strength ?? el.binding?.strength ?? "required";

  const dirty = !!pendingCard || !!pendingBind;

  return (
    <tr className={dirty ? "dirty" : ""}>
      <td className="path">
        {el.path}
        {el.mustSupport && <span className="flag">MS</span>}
        {el.types && el.types.length > 0 && (
          <span className="flag">{el.types.join(" | ")}</span>
        )}
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
                path: el.path,
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
                path: el.path,
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
              path: el.path,
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
              path: el.path,
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
    </tr>
  );
}
