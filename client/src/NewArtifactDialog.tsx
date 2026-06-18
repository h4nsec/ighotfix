import { useMemo, useState } from "react";
import type { Artifact } from "@igb/shared";
import { createArtifact } from "./api.js";

type NewType = "SearchParameter" | "CapabilityStatement";

/** Infer the canonical URL base from an existing artifact's url. */
function inferCanonicalBase(artifacts: Artifact[]): string {
  for (const a of artifacts) {
    if (!a.url) continue;
    // Strip the trailing "/<ResourceType>/<id>" to get the canonical base.
    const m = /^(.*)\/[A-Za-z]+\/[^/]+$/.exec(a.url);
    if (m) return m[1];
  }
  return "";
}

/** Place new files beside existing definitional artifacts (profiles/capabilities). */
function inferDir(artifacts: Artifact[]): string {
  const near =
    artifacts.find((a) => a.category === "Capabilities") ??
    artifacts.find((a) => a.category === "Profiles") ??
    artifacts[0];
  if (!near) return "";
  const i = near.id.lastIndexOf("/");
  return i === -1 ? "" : near.id.slice(0, i);
}

function inferLanguage(artifacts: Artifact[]): "json" | "xml" {
  let xml = 0;
  let json = 0;
  for (const a of artifacts) {
    if (a.language === "xml") xml++;
    else if (a.language === "json") json++;
  }
  return xml >= json ? "xml" : "json";
}

export function NewArtifactDialog({
  artifacts,
  onClose,
  onCreated,
}: {
  artifacts: Artifact[];
  onClose: () => void;
  onCreated: (artifactId: string) => void;
}) {
  const [type, setType] = useState<NewType>("SearchParameter");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [language, setLanguage] = useState<"json" | "xml">(() => inferLanguage(artifacts));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dir = useMemo(() => inferDir(artifacts), [artifacts]);
  const canonicalBase = useMemo(() => inferCanonicalBase(artifacts), [artifacts]);

  // Auto-derive an id slug from the name until the user edits id directly.
  const effectiveId = idTouched
    ? id
    : name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { artifactId } = await createArtifact({
        resourceType: type,
        id: effectiveId,
        name: name.trim(),
        language,
        dir,
        canonicalBase,
      });
      onCreated(artifactId);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>New artifact</h3>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="new-form">
          <label>Type</label>
          <div className="seg">
            {(["SearchParameter", "CapabilityStatement"] as NewType[]).map((t) => (
              <button
                key={t}
                className={type === t ? "on" : ""}
                onClick={() => setType(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <label>Name</label>
          <input
            autoFocus
            value={name}
            placeholder="e.g. MyPatientSearch"
            onChange={(e) => setName(e.target.value)}
          />

          <label>Id / filename</label>
          <input
            value={effectiveId}
            placeholder="my-patient-search"
            onChange={(e) => {
              setIdTouched(true);
              setId(e.target.value);
            }}
          />

          <label>Format</label>
          <div className="seg">
            {(["xml", "json"] as const).map((l) => (
              <button key={l} className={language === l ? "on" : ""} onClick={() => setLanguage(l)}>
                {l}
              </button>
            ))}
          </div>

          <div className="new-hint">
            Will create <code>{(dir ? dir + "/" : "") + (effectiveId || "…") + "." + language}</code>
            {canonicalBase && (
              <>
                <br />
                url: <code>{`${canonicalBase}/${type}/${effectiveId || "…"}`}</code>
              </>
            )}
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="picker-foot">
          <span className="picker-hint" />
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={create} disabled={busy || !name.trim() || !effectiveId}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
