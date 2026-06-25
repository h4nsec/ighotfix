import type {
  Artifact,
  ResourceField,
  ResourceSection,
  ResourceView,
} from "@igb/shared";
import type { LoadedSource } from "./adapters/index.js";
import { xmlResourceObject } from "./adapters/xml-scan.js";
import { instanceToObject } from "./adapters/fsh.js";

/** Parse a source into a FHIR-JSON object (best effort). */
function toObject(src: LoadedSource): any {
  if (src.language === "json") {
    try {
      return JSON.parse(src.text);
    } catch {
      return null;
    }
  }
  if (src.language === "xml") return xmlResourceObject(src.text);
  if (src.language === "fsh") return instanceToObject(src.text);
  return null;
}

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function arr<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v as T];
}

function field(label: string, value: unknown): ResourceField | null {
  const v = str(value);
  return v ? { label, value: v } : null;
}

function compact(fields: (ResourceField | null)[]): ResourceField[] {
  return fields.filter((f): f is ResourceField => f !== null);
}

/** Build the type-specific sections for a resource object. */
function sectionsFor(rt: string, obj: any): ResourceSection[] {
  const sections: ResourceSection[] = [];

  if (rt === "SearchParameter") {
    sections.push({
      title: "Search parameter",
      rows: compact([
        field("Code", obj.code),
        field("Type", obj.type),
        field("Expression", obj.expression),
        field("Derived from", obj.derivedFrom),
        field("Multiple or", str(obj.multipleOr)),
        field("Multiple and", str(obj.multipleAnd)),
      ]),
    });
    const bases = arr(obj.base).map((b) => [str(b) ?? ""]);
    if (bases.length) sections.push({ title: "Bases", table: { headers: ["Resource"], rows: bases } });
    const comparators = arr(obj.comparator).map((c) => [str(c) ?? ""]);
    if (comparators.length)
      sections.push({ title: "Comparators", table: { headers: ["Comparator"], rows: comparators } });
  }

  if (rt === "CapabilityStatement") {
    for (const rest of arr(obj.rest)) {
      const rows = arr(rest.resource).map((r: any) => [
        str(r.type) ?? "",
        str(r.profile) ?? "",
        arr(r.interaction)
          .map((i: any) => str(i.code))
          .filter(Boolean)
          .join(", "),
        arr(r.searchParam)
          .map((s: any) => str(s.name))
          .filter(Boolean)
          .join(", "),
      ]);
      sections.push({
        title: `REST (${str(rest.mode) ?? "server"})`,
        table: {
          headers: ["Resource", "Profile", "Interactions", "Search params"],
          rows,
        },
      });
    }
  }

  if (rt === "ValueSet") {
    const includes = arr(obj.compose?.include).map((inc: any) => [
      str(inc.system) ?? "",
      str(inc.version) ?? "",
      arr(inc.concept).length
        ? `${arr(inc.concept).length} codes`
        : arr(inc.filter).length
          ? "filter"
          : "all",
    ]);
    if (includes.length)
      sections.push({
        title: "Compose · include",
        table: { headers: ["System", "Version", "Codes"], rows: includes },
      });
  }

  if (rt === "CodeSystem") {
    const concepts = arr(obj.concept)
      .slice(0, 200)
      .map((c: any) => [str(c.code) ?? "", str(c.display) ?? ""]);
    if (concepts.length)
      sections.push({
        title: `Concepts${arr(obj.concept).length > 200 ? " (first 200)" : ""}`,
        table: { headers: ["Code", "Display"], rows: concepts },
      });
  }

  if (rt === "ImplementationGuide") {
    const deps = arr(obj.dependsOn).map((d: any) => [
      str(d.packageId) ?? str(d.uri) ?? "",
      str(d.version) ?? "",
    ]);
    if (deps.length)
      sections.push({ title: "Depends on", table: { headers: ["Package", "Version"], rows: deps } });
  }

  // Generic summary for any resource type not handled above (e.g. Patient, Medication, Observation).
  if (sections.length === 0) {
    const extRows = genericExtensionRows(obj);
    if (extRows.length) sections.push({ title: "Extensions", rows: extRows, kind: "extensions" });
    const rows = genericRows(obj);
    if (rows.length) sections.push({ title: "Details", rows });
    sections.push(...genericArraySections(obj));
  }

  return sections;
}

/** Keys we never surface in the generic summary — already shown elsewhere or not useful. */
const GENERIC_SKIP = new Set([
  "resourceType", "id", "meta", "text", "extension", "modifierExtension", "contained",
  "url", "version", "status", "experimental", "publisher", "date", "fhirVersion",
  "kind", "baseDefinition", "type",
]);

/** Convert a camelCase or kebab-case FHIR key / URL segment to a readable label. */
function fhirLabel(key: string): string {
  return key
    .replace(/\[x\]$/, "")
    .replace(/-([a-z])/g, (_, c: string) => ` ${c.toUpperCase()}`)  // kebab → camel
    .replace(/([A-Z])/g, " $1")                                      // camelCase → words
    .replace(/^([a-z])/, (c: string) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

/** Last path segment of an extension URL, converted to a readable label. */
function extensionLabel(url: string): string {
  const seg = url.split("/").pop()?.split("#").pop() ?? url;
  return fhirLabel(seg);
}

/** Extract the typed value from a FHIR extension (value[x]). */
function extensionValue(ext: Record<string, unknown>): string | undefined {
  const key = Object.keys(ext).find((k) => k.startsWith("value") && k !== "url");
  return key ? fhirDisplay(ext[key]) : undefined;
}

/**
 * Return a display string AND the specific sub-path within `key` that holds it,
 * so the ExampleEditor can render an editable input that writes back correctly.
 */
function fieldWithPath(
  key: string,
  value: unknown,
): { display: string; path: string } | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" && value) return { display: value, path: key };
  if (typeof value === "number" || typeof value === "boolean")
    return { display: String(value), path: key };
  if (Array.isArray(value)) return undefined;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.text === "string" && o.text) return { display: o.text, path: `${key}.text` };
    if (typeof o.display === "string" && o.display)
      return { display: o.display, path: `${key}.display` };
    if (typeof o.reference === "string" && o.reference)
      return { display: o.reference, path: `${key}.reference` };
    // Quantity — edit the numeric value
    if ((typeof o.value === "string" || typeof o.value === "number") && o.value !== "") {
      const unit = str(o.unit) ?? str(o.code);
      const display = unit ? `${o.value} ${unit}` : String(o.value);
      return { display, path: `${key}.value` };
    }
  }
  return undefined;
}

/**
 * Best-effort scalar display for any FHIR value.
 * Handles string, number, CodeableConcept, Reference, Quantity, HumanName, Address, etc.
 */
function fhirDisplay(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => fhirDisplay(v)).filter(Boolean) as string[];
    return parts.length ? parts.join("; ") : undefined;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    // CodeableConcept
    if (typeof o.text === "string" && o.text) return o.text;
    // Reference
    if (typeof o.display === "string" && o.display) return o.display;
    if (typeof o.reference === "string" && o.reference) {
      return o.display ? `${o.display} (${o.reference})` : o.reference;
    }
    // Coding / CodeableConcept.coding[0]
    const firstCoding = Array.isArray(o.coding) ? (o.coding[0] as Record<string, unknown>) : undefined;
    if (firstCoding) {
      if (typeof firstCoding.display === "string" && firstCoding.display) return firstCoding.display;
      if (typeof firstCoding.code === "string" && firstCoding.code) return firstCoding.code;
    }
    // Quantity / SimpleQuantity
    if ((typeof o.value === "string" || typeof o.value === "number") && o.value !== "") {
      const unit = str(o.unit) ?? str(o.code);
      return unit ? `${o.value} ${unit}` : String(o.value);
    }
    // Ratio (e.g. ingredient strength)
    if (o.numerator && o.denominator) {
      const num = fhirDisplay(o.numerator);
      const den = fhirDisplay(o.denominator);
      const denStr = str((o.denominator as any)?.value);
      return num && den ? (denStr === "1" ? num : `${num}/${den}`) : num ?? den;
    }
    // HumanName
    if (typeof o.family === "string" || Array.isArray(o.given)) {
      const family = str(o.family) ?? "";
      const given = Array.isArray(o.given) ? (o.given as string[]).join(" ") : "";
      if (str(o.text)) return str(o.text)!;
      return [given, family].filter(Boolean).join(" ") || undefined;
    }
    // Address
    if (typeof o.city === "string" || typeof o.country === "string" || typeof o.line !== "undefined") {
      if (str(o.text)) return str(o.text)!;
      const lines = arr(o.line).map((l) => str(l)).filter(Boolean);
      return [...lines, str(o.city), str(o.state), str(o.postalCode), str(o.country)]
        .filter(Boolean)
        .join(", ") || undefined;
    }
    // ContactPoint / Telecom
    if (typeof o.system === "string" && typeof o.value === "string") {
      return o.value || undefined;
    }
    // Identifier
    if (typeof o.value === "string") return o.value || undefined;
    // Period
    if (o.start || o.end) {
      return [str(o.start), str(o.end)].filter(Boolean).join(" – ");
    }
  }
  return undefined;
}

/** Rows for each extension on the resource, with removePath pointing to the whole extension item. */
function genericExtensionRows(obj: any): ResourceField[] {
  const rows: ResourceField[] = [];
  const exts = arr(obj.extension);
  for (let i = 0; i < exts.length; i++) {
    const ext = exts[i] as Record<string, unknown>;
    const url = str(ext.url);
    if (!url) continue;
    const valueKey = Object.keys(ext).find((k) => k.startsWith("value") && k !== "url");
    if (!valueKey) continue;
    const extVal = ext[valueKey];
    const d = fhirDisplay(extVal);
    if (!d) continue;
    const sub = fieldWithPath(valueKey, extVal);
    const writePath = sub ? `extension[${i}].${sub.path}` : `extension[${i}].${valueKey}`;
    rows.push({ label: extensionLabel(url), value: d, path: writePath, removePath: `extension[${i}]` });
  }
  return rows;
}

/** Extract scalar (non-array-of-objects) top-level fields as label/value rows. */
function genericRows(obj: any): ResourceField[] {
  const rows: ResourceField[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (GENERIC_SKIP.has(k)) continue;
    // Array of objects → handled separately as table sections
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null) continue;
    const result = fieldWithPath(k, v);
    if (result) rows.push({ label: fhirLabel(k), value: result.display, path: result.path, removePath: k });
  }
  return rows;
}

/** Extract array-of-objects top-level fields as table sections. */
function genericArraySections(obj: any): ResourceSection[] {
  const out: ResourceSection[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (GENERIC_SKIP.has(k)) continue;
    if (!Array.isArray(v) || v.length === 0) continue;
    const items = v as Record<string, unknown>[];
    if (typeof items[0] !== "object" || items[0] === null) continue;

    // Collect the set of keys that produce a displayable value across all items.
    const keys: string[] = [];
    for (const ik of Object.keys(items[0])) {
      if (items.some((it) => fhirDisplay(it[ik]) !== undefined)) keys.push(ik);
    }
    if (keys.length === 0) continue;

    const headers = keys.map(fhirLabel);
    const rows = items.map((item) => keys.map((ik) => fhirDisplay(item[ik]) ?? ""));
    // Provide write-back paths for each cell so the editor can render inputs.
    // Scalars use the key directly; complex objects use fieldWithPath to find the editable sub-path.
    const rowPaths = items.map((item, ri) =>
      keys.map((ik) => {
        const v = item[ik];
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          return `${k}[${ri}].${ik}`;
        }
        const fp = fieldWithPath(ik, v);
        return fp ? `${k}[${ri}].${fp.path}` : "";
      }),
    );
    out.push({ title: fhirLabel(k), table: { headers, rows, rowPaths }, arrayKey: k });
  }
  return out;
}

/**
 * Detect whether a source file contains commented-out content.
 * Uses a string-aware scanner for JSON/FSH to avoid false-positives on URLs.
 */
export function detectComments(text: string, language: "fsh" | "json" | "xml"): boolean {
  if (language === "xml") return text.includes("<!--");
  if (language !== "json" && language !== "fsh") return false;
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    if (inString) {
      if (c === "\\" && i + 1 < text.length) { i += 2; continue; }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') { inString = true; i++; continue; }
    if (c === "/" && i + 1 < text.length && (text[i + 1] === "/" || text[i + 1] === "*")) return true;
    i++;
  }
  return false;
}

/** Resource types with a dedicated structured editor. */
const EDITABLE_TYPES = new Set([
  "SearchParameter",
  "CapabilityStatement",
  "ImplementationGuide",
  "ValueSet",
  "CodeSystem",
]);

export function buildResourceView(src: LoadedSource, artifact: Artifact): ResourceView {
  const obj = toObject(src) ?? {};
  const rt = artifact.resourceType;
  // FSH instances are editable too, but only when we could normalize the rules.
  const editableType =
    (EDITABLE_TYPES.has(rt) || artifact.kind === "example") &&
    (src.language !== "fsh" || !!toObject(src));

  const fields = compact([
    field("URL", obj.url),
    field("Version", obj.version),
    field("Status", obj.status),
    field("Experimental", str(obj.experimental)),
    field("Publisher", obj.publisher),
    field("Date", obj.date),
    field("FHIR version", obj.fhirVersion),
    field("Kind", obj.kind),
    field("Base", obj.baseDefinition),
    field("Type", obj.type),
  ]);

  return {
    artifactId: artifact.id,
    resourceType: rt,
    language: src.language,
    name: str(obj.name) ?? artifact.name,
    title: str(obj.title) ?? artifact.title,
    url: str(obj.url) ?? artifact.url,
    status: str(obj.status),
    description: str(obj.description),
    fields,
    sections: sectionsFor(rt, obj),
    raw: src.text,
    data: obj,
    editableType,
    hasComments: detectComments(src.text, src.language),
  };
}
