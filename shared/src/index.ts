/**
 * Canonical model + API contract shared between client and server.
 *
 * The canonical model is deliberately source-language agnostic. Each adapter
 * (fsh / json / xml) is responsible for projecting its source into this model
 * and for translating an {@link Edit} back into a precise, format-preserving
 * splice of the original source text.
 */

export type SourceLanguage = "fsh" | "json" | "xml";

/** A single FHIR conformance/example artifact discovered in the IG. */
export interface Artifact {
  /** Stable id — the path relative to the IG root. */
  id: string;
  /** Absolute path on disk. */
  filePath: string;
  language: SourceLanguage;
  /** FHIR resourceType, e.g. "StructureDefinition", "ValueSet". */
  resourceType: string;
  /** Human name (StructureDefinition.name etc.). */
  name: string;
  /** Canonical url if present. */
  url?: string;
  /** Whether we could project this into an editable view yet. */
  supported: boolean;
}

/** Lightweight summary used by the IG explorer tree. */
export interface IgSummary {
  root: string;
  artifacts: Artifact[];
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

/** One row in the profile element table (from the differential). */
export interface ElementView {
  /** ElementDefinition.id, e.g. "Observation.status". */
  id: string;
  /** ElementDefinition.path, e.g. "Observation.status". */
  path: string;
  min?: number;
  max?: string;
  short?: string;
  mustSupport?: boolean;
  types?: string[];
  binding?: ElementBinding;
  /** Set when this element defines a slice (ElementDefinition.sliceName). */
  sliceName?: string;
  /** Slicing definition present on this element (the slice "header"). */
  slicing?: SlicingInfo;
  /** For an extension element, the profile URL of the extension it references. */
  extensionUrl?: string;
  /** True when the element only exists in the differential (a constraint). */
  inDifferential: boolean;
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
}

/* ------------------------------------------------------------------ *
 * Edits — structured, source-agnostic mutations
 * ------------------------------------------------------------------ */

export type Edit =
  | SetCardinalityEdit
  | SetBindingEdit
  | AddSliceEdit
  | AddExtensionEdit;

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
