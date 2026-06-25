/**
 * Canonical model + API contract shared between client and server.
 *
 * The canonical model is deliberately source-language agnostic. Each adapter
 * (fsh / json / xml) is responsible for projecting its source into this model
 * and for translating an {@link Edit} back into a precise, format-preserving
 * splice of the original source text.
 */

export type SourceLanguage = "fsh" | "json" | "xml";

export type ArtifactKind =
  | "profile"
  | "extension"
  | "logical"
  | "valueset"
  | "codesystem"
  | "conceptmap"
  | "capabilitystatement"
  | "searchparameter"
  | "operationdefinition"
  | "implementationguide"
  | "example"
  | "config"
  | "page"
  | "file"
  | "other";

export type ArtifactCategory =
  | "Profiles"
  | "Extensions"
  | "Terminology"
  | "Capabilities"
  | "Implementation Guide"
  | "Configuration"
  | "Pages"
  | "Examples"
  | "Other";

/** A single FHIR conformance/example artifact discovered in the IG. */
export interface Artifact {
  /** Stable id — the path relative to the IG root. */
  id: string;
  /** Absolute path on disk. */
  filePath: string;
  /** FHIR source language for adapter-backed artifacts; undefined for plain files. */
  language?: SourceLanguage;
  /** Display/syntax format, e.g. "fsh", "json", "xml", "ini", "yaml", "markdown". */
  format: string;
  /** FHIR resourceType, e.g. "StructureDefinition"; empty for non-FHIR files. */
  resourceType: string;
  /** Human name (StructureDefinition.name etc.). */
  name: string;
  /** Human title if present, else falls back to name. */
  title?: string;
  /** Canonical url if present. */
  url?: string;
  kind: ArtifactKind;
  category: ArtifactCategory;
  /** True when this artifact has a structured editor (profiles/extensions). */
  editable: boolean;
}

/** Classify a non-FHIR IG file (config, page, or other) by name/extension. */
export function classifyFile(
  fileName: string,
): { kind: ArtifactKind; category: ArtifactCategory; format: string } | null {
  const lower = fileName.toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  const CONFIG_NAMES = new Set([
    "ig.ini",
    "sushi-config.yaml",
    "sushi-config.yml",
    "package.json",
    "package-list.json",
    "publication-request.json",
    "menu.xml",
  ]);
  if (CONFIG_NAMES.has(lower) || ext === ".ini" || ext === ".yaml" || ext === ".yml") {
    const format = ext === ".ini" ? "ini" : ext === ".json" ? "json" : ext === ".xml" ? "xml" : "yaml";
    return { kind: "config", category: "Configuration", format };
  }
  if (ext === ".md") return { kind: "page", category: "Pages", format: "markdown" };
  if (ext === ".txt") return { kind: "file", category: "Other", format: "text" };
  if (ext === ".json") return { kind: "file", category: "Other", format: "json" };
  if (ext === ".xml") return { kind: "page", category: "Pages", format: "xml" };
  if (ext === ".fsh") return { kind: "file", category: "Other", format: "fsh" };
  return null;
}

/** Classify a resource into a sidebar category + editability. */
export function classify(
  resourceType: string,
  opts: { sdType?: string; sdKind?: string } = {},
): { kind: ArtifactKind; category: ArtifactCategory; editable: boolean } {
  switch (resourceType) {
    case "StructureDefinition": {
      if (opts.sdType === "Extension")
        return { kind: "extension", category: "Extensions", editable: true };
      if (opts.sdKind === "logical")
        return { kind: "logical", category: "Profiles", editable: true };
      return { kind: "profile", category: "Profiles", editable: true };
    }
    case "ValueSet":
      return { kind: "valueset", category: "Terminology", editable: false };
    case "CodeSystem":
      return { kind: "codesystem", category: "Terminology", editable: false };
    case "ConceptMap":
    case "NamingSystem":
      return { kind: "conceptmap", category: "Terminology", editable: false };
    case "CapabilityStatement":
      return { kind: "capabilitystatement", category: "Capabilities", editable: false };
    case "SearchParameter":
      return { kind: "searchparameter", category: "Capabilities", editable: false };
    case "OperationDefinition":
      return { kind: "operationdefinition", category: "Capabilities", editable: false };
    case "ActorDefinition":
      return { kind: "other", category: "Capabilities", editable: false };
    case "ImplementationGuide":
      return { kind: "implementationguide", category: "Implementation Guide", editable: false };
    default:
      return { kind: "example", category: "Examples", editable: false };
  }
}

/** Lightweight summary used by the IG explorer tree. */
export interface IgSummary {
  root: string;
  artifacts: Artifact[];
  /** Non-fatal note, e.g. when no FHIR artifacts were found. */
  warning?: string;
}

/* ------------------------------------------------------------------ *
 * Profile (StructureDefinition) view
 * ------------------------------------------------------------------ */

export type Derivation = "specialization" | "constraint";

export interface ElementBinding {
  strength?: "required" | "extensible" | "preferred" | "example";
  valueSet?: string;
}

export interface SlicingInfo {
  discriminator?: { type: string; path: string }[];
  rules?: "open" | "closed" | "openAtEnd";
  ordered?: boolean;
}

/** One row in the profile element table. */
export interface ElementView {
  /** ElementDefinition.id, e.g. "Observation.status". */
  id: string;
  /** ElementDefinition.path, e.g. "Observation.status". */
  path: string;
  min?: number;
  max?: string;
  short?: string;
  mustSupport?: boolean;
  isSummary?: boolean;
  isModifier?: boolean;
  types?: string[];
  binding?: ElementBinding;
  /** Set when this element defines a slice (ElementDefinition.sliceName). */
  sliceName?: string;
  /** Slicing definition present on this element (the slice "header"). */
  slicing?: SlicingInfo;
  /** For an extension element, the profile URL of the extension it references. */
  extensionUrl?: string;
  /** True when the element appears in the differential (i.e. is constrained). */
  inDifferential: boolean;
  /** True when this element comes from the snapshot but has no differential constraint. */
  fromSnapshot?: boolean;
}

export interface ProfileView {
  artifactId: string;
  name: string;
  title?: string;
  /** Base FHIR type, e.g. "Observation". */
  type: string;
  baseDefinition?: string;
  derivation?: Derivation;
  url?: string;
  elements: ElementView[];
  /** True when the source file contains commented-out content. */
  hasComments?: boolean;
}

/* ------------------------------------------------------------------ *
 * Read-only resource view (non-editable artifacts)
 * ------------------------------------------------------------------ */

export interface ResourceField {
  label: string;
  value: string;
  /** FHIR path for setValue edits, e.g. "code.text" or "extension[0].valueString". */
  path?: string;
  /** FHIR path for removeValue — may differ from path (e.g. remove whole extension vs just its value). */
  removePath?: string;
}

export interface ResourceSection {
  title: string;
  /** Simple key/value rows. */
  rows?: ResourceField[];
  /** Tabular data (e.g. CapabilityStatement resources). */
  table?: {
    headers: string[];
    rows: string[][];
    /** Parallel FHIR paths for each cell — present on editable array sections, empty string means read-only. */
    rowPaths?: string[][];
  };
  /** Original FHIR key when this section was generated from a top-level array, enables row removal. */
  arrayKey?: string;
  /** Marks sections that have a dedicated add UI in the editor. */
  kind?: "extensions";
}

/** A structured, read-only projection of any FHIR artifact. */
export interface ResourceView {
  artifactId: string;
  resourceType: string;
  language: SourceLanguage;
  name?: string;
  title?: string;
  url?: string;
  status?: string;
  description?: string;
  /** Top metadata key/value pairs. */
  fields: ResourceField[];
  /** Type-specific sections. */
  sections: ResourceSection[];
  /** Original source text. */
  raw: string;
  /** Normalized FHIR object (for editors to read current values by path). */
  data?: unknown;
  /** True when this resource type has a dedicated structured editor. */
  editableType?: boolean;
  /** True when the source file contains commented-out content invisible to the structured editor. */
  hasComments?: boolean;
}

/** Parse a FHIR element path ("rest[0].resource[2].code") into segments. */
export function parsePath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const seg of path.split(".")) {
    const m = /^([^[]+)((?:\[\d+\])*)$/.exec(seg);
    if (!m) continue;
    out.push(m[1]);
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) out.push(Number(idx[1]));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Edits — structured, source-agnostic mutations
 * ------------------------------------------------------------------ */

export type Edit =
  | SetCardinalityEdit
  | SetBindingEdit
  | SetFlagEdit
  | AddSliceEdit
  | AddExtensionEdit
  | SetValueEdit
  | AddValueEdit
  | RemoveValueEdit;

/* Generic, resource-agnostic field edits, addressed by a FHIR element path
 * (dot-separated with `[n]` array indices), e.g. "status", "base[1]",
 * "rest[0].resource[2].interaction[1].code". */

/** Set (or, when value is null, clear) a primitive at a path. */
export interface SetValueEdit {
  kind: "setValue";
  artifactId: string;
  path: string;
  value: string | number | boolean | null;
  description?: string;
}

/** Append an item to the array at `path`. Value may be a primitive or object. */
export interface AddValueEdit {
  kind: "addValue";
  artifactId: string;
  /** Path of the array, e.g. "base" or "rest[0].resource". */
  path: string;
  value: unknown;
  description?: string;
}

/** Remove the element at `path` (a property or a specific array index). */
export interface RemoveValueEdit {
  kind: "removeValue";
  artifactId: string;
  path: string;
  description?: string;
}

/** The editable boolean flags on an ElementDefinition. */
export type ElementFlag = "mustSupport" | "isSummary" | "isModifier";

/** Display token for each flag (FHIR/FSH convention). */
export const FLAG_LABELS: Record<ElementFlag, string> = {
  mustSupport: "MS",
  isSummary: "SU",
  isModifier: "?!",
};

export interface SetCardinalityEdit {
  kind: "setCardinality";
  artifactId: string;
  /** The element path the constraint applies to. */
  path: string;
  min: number;
  max: string;
}

export interface SetBindingEdit {
  kind: "setBinding";
  artifactId: string;
  path: string;
  valueSet: string;
  strength: NonNullable<ElementBinding["strength"]>;
}

/** Set or clear a boolean flag (mustSupport / isSummary / isModifier). */
export interface SetFlagEdit {
  kind: "setFlag";
  artifactId: string;
  path: string;
  flag: ElementFlag;
  value: boolean;
}

/** Add a named slice to a (repeating) element. */
export interface AddSliceEdit {
  kind: "addSlice";
  artifactId: string;
  /** The element being sliced, e.g. "Patient.identifier". */
  path: string;
  sliceName: string;
  min: number;
  max: string;
  /** Optional discriminator to add to the slicing header if none exists. */
  discriminator?: { type: string; path: string };
}

/** Add an extension usage (a slice on the `extension` element) to a profile. */
export interface AddExtensionEdit {
  kind: "addExtension";
  artifactId: string;
  /** Element to extend, e.g. "Patient" (→ Patient.extension) or a nested path. */
  path: string;
  /** Slice name for the extension usage. */
  sliceName: string;
  /** Canonical URL of the extension definition being referenced. */
  extensionUrl: string;
  /** In FSH, the profile name/alias used in `contains ... named`. */
  extensionName?: string;
  min: number;
  max: string;
}

/** Result of applying one or more edits to an artifact's source. */
export interface EditResult {
  artifactId: string;
  /** The new full source text after edits. */
  text: string;
  /** Human-readable diff hunks for preview. */
  changes: TextChange[];
  /** Number of source changes actually produced (0 = nothing matched). */
  applied?: number;
}

export interface TextChange {
  /** 0-based offset into the *original* text. */
  start: number;
  end: number;
  /** Replacement text. */
  newText: string;
  description: string;
}

/* ------------------------------------------------------------------ *
 * API contract
 * ------------------------------------------------------------------ */

export interface LoadRequest {
  root: string;
}

export interface ApplyEditsRequest {
  artifactId: string;
  edits: Edit[];
  /** When false, return the preview without touching disk. */
  write: boolean;
}
