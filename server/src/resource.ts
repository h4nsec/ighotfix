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

  return sections;
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
  const editableType = EDITABLE_TYPES.has(rt) && (src.language !== "fsh" || !!toObject(src));

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
  };
}
