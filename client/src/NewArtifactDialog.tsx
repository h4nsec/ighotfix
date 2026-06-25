import { useMemo, useState } from "react";
import type { Artifact } from "@igb/shared";
import { createArtifact } from "./api.js";
import { X } from "lucide-react";

type NewType = "SearchParameter" | "CapabilityStatement" | "Example";

const FHIR_RESOURCE_TYPES = [
  "AllergyIntolerance",
  "CarePlan",
  "CareTeam",
  "Condition",
  "Device",
  "DiagnosticReport",
  "Encounter",
  "Goal",
  "Immunization",
  "Location",
  "Medication",
  "MedicationRequest",
  "MedicationStatement",
  "Observation",
  "Organization",
  "Patient",
  "Practitioner",
  "PractitionerRole",
  "Procedure",
  "RelatedPerson",
  "ServiceRequest",
  "Specimen",
];

/** Infer the canonical URL base from an existing artifact's url. */
function inferCanonicalBase(artifacts: Artifact[]): string {
  for (const a of artifacts) {
    if (!a.url) continue;
    const m = /^(.*)\/[A-Za-z]+\/[^/]+$/.exec(a.url);
    if (m) return m[1];
  }
  return "";
}

function inferDir(artifacts: Artifact[], type: NewType): string {
  const near =
    type === "Example"
      ? (artifacts.find((a) => a.category === "Examples") ??
          artifacts.find((a) => a.category === "Profiles") ??
          artifacts[0])
      : (artifacts.find((a) => a.category === "Capabilities") ??
          artifacts.find((a) => a.category === "Profiles") ??
          artifacts[0]);
  if (!near) return "";
  const i = near.id.lastIndexOf("/");
  return i === -1 ? "" : near.id.slice(0, i);
}

function inferLanguage(artifacts: Artifact[]): "json" | "xml" | "fsh" {
  const counts: Record<string, number> = { xml: 0, json: 0, fsh: 0 };
  for (const a of artifacts) if (a.language) counts[a.language] = (counts[a.language] ?? 0) + 1;
  const order: ("fsh" | "xml" | "json")[] = ["fsh", "xml", "json"];
  return order.sort((a, b) => counts[b] - counts[a])[0];
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
  const [language, setLanguage] = useState<"json" | "xml" | "fsh">(() => inferLanguage(artifacts));
  const [fhirResourceType, setFhirResourceType] = useState("Patient");
  const [profile, setProfile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dir = useMemo(() => inferDir(artifacts, type), [artifacts, type]);
  const canonicalBase = useMemo(() => inferCanonicalBase(artifacts), [artifacts]);

  const profileArtifacts = useMemo(
    () => artifacts.filter((a) => a.category === "Profiles" && a.url),
    [artifacts],
  );

  const effectiveId = idTouched
    ? id
    : name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

  const isExample = type === "Example";

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
        ...(isExample && {
          fhirResourceType,
          profile: profile || undefined,
        }),
      });
      onCreated(artifactId);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  const fileHint = (dir ? dir + "/" : "") + (effectiveId || "…") + "." + language;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>New artifact</h3>
          <button onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>

        <div className="new-form">
          <label>Type</label>
          <div className="seg">
            {(["SearchParameter", "CapabilityStatement", "Example"] as NewType[]).map((t) => (
              <button
                key={t}
                className={type === t ? "on" : ""}
                onClick={() => setType(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {isExample && (
            <>
              <label>Resource type</label>
              <select value={fhirResourceType} onChange={(e) => setFhirResourceType(e.target.value)}>
                {FHIR_RESOURCE_TYPES.map((rt) => (
                  <option key={rt}>{rt}</option>
                ))}
              </select>

              <label>
                Profile{" "}
                <span style={{ fontWeight: "normal", opacity: 0.6, fontSize: "0.85em" }}>
                  (optional)
                </span>
              </label>
              {profileArtifacts.length > 0 ? (
                <select value={profile} onChange={(e) => setProfile(e.target.value)}>
                  <option value="">— none —</option>
                  {profileArtifacts.map((a) => (
                    <option key={a.url} value={a.url}>
                      {a.title ?? a.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={profile}
                  placeholder="https://..."
                  onChange={(e) => setProfile(e.target.value)}
                />
              )}
            </>
          )}

          <label>{isExample ? "Label / id hint" : "Name"}</label>
          <input
            autoFocus
            value={name}
            placeholder={isExample ? "e.g. AU Core Patient Example" : "e.g. MyPatientSearch"}
            onChange={(e) => setName(e.target.value)}
          />

          <label>Id / filename</label>
          <input
            value={effectiveId}
            placeholder={isExample ? "au-core-patient-example" : "my-patient-search"}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.target.value);
            }}
          />

          <label>Format</label>
          <div className="seg">
            {(["xml", "json", "fsh"] as const).map((l) => (
              <button key={l} className={language === l ? "on" : ""} onClick={() => setLanguage(l)}>
                {l}
              </button>
            ))}
          </div>

          <div className="new-hint">
            Will create <code>{fileHint}</code>
            {!isExample && canonicalBase && (
              <>
                <br />
                url: <code>{`${canonicalBase}/${type}/${effectiveId || "…"}`}</code>
              </>
            )}
            {isExample && profile && (
              <>
                <br />
                profile: <code>{profile}</code>
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
          <button
            className="primary"
            onClick={create}
            disabled={busy || (!isExample && !name.trim()) || !effectiveId}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
