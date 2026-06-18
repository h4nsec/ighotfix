import { writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";

export type CreatableType = "SearchParameter" | "CapabilityStatement";

export interface CreateRequest {
  resourceType: CreatableType;
  /** Resource id; also used as the filename. */
  id: string;
  name: string;
  language: "json" | "xml";
  /** Relative directory under the IG root to place the file. */
  dir?: string;
  /** Canonical URL base, e.g. "http://hl7.org.au/fhir/core". */
  canonicalBase?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function safeId(id: string): string {
  return id.trim().replace(/[^A-Za-z0-9._-]/g, "-");
}

function skeletonObject(req: CreateRequest, url: string): any {
  if (req.resourceType === "SearchParameter") {
    return {
      resourceType: "SearchParameter",
      id: req.id,
      url,
      name: req.name,
      status: "draft",
      description: "",
      code: "",
      base: [],
      type: "string",
      expression: "",
    };
  }
  return {
    resourceType: "CapabilityStatement",
    id: req.id,
    url,
    name: req.name,
    title: req.name,
    status: "draft",
    date: today(),
    kind: "requirements",
    fhirVersion: "4.0.1",
    format: ["json", "xml"],
    rest: [{ mode: "server", resource: [] }],
  };
}

/** Serialize the skeleton object to pretty JSON or FHIR XML. */
function serialize(obj: any, language: "json" | "xml"): string {
  if (language === "json") return JSON.stringify(obj, null, 2) + "\n";
  return objectToFhirXml(obj) + "\n";
}

function esc(v: unknown): string {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

const ATTR_KEYS = new Set(["url", "id"]);

function elemXml(name: string, value: unknown, indent: string): string {
  if (value === null || value === undefined || typeof value !== "object") {
    return `${indent}<${name} value="${esc(value)}"/>`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const attrs = entries
    .filter(([k, v]) => (ATTR_KEYS.has(k) || k === "value") && typeof v !== "object")
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");
  const children = entries.filter(
    ([k, v]) => !((ATTR_KEYS.has(k) || k === "value") && typeof v !== "object"),
  );
  if (children.length === 0) return `${indent}<${name}${attrs}/>`;
  const lines = [`${indent}<${name}${attrs}>`];
  for (const [k, v] of children) {
    if (Array.isArray(v)) for (const item of v) lines.push(elemXml(k, item, indent + "  "));
    else lines.push(elemXml(k, v, indent + "  "));
  }
  lines.push(`${indent}</${name}>`);
  return lines.join("\n");
}

function objectToFhirXml(obj: any): string {
  const rt = obj.resourceType;
  const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, `<${rt} xmlns="http://hl7.org/fhir">`];
  for (const [k, v] of Object.entries(obj)) {
    if (k === "resourceType") continue;
    if (Array.isArray(v)) for (const item of v) lines.push(elemXml(k, item, "  "));
    else lines.push(elemXml(k, v, "  "));
  }
  lines.push(`</${rt}>`);
  return lines.join("\n");
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function createArtifact(
  root: string,
  req: CreateRequest,
): Promise<{ artifactId: string }> {
  const id = safeId(req.id);
  if (!id) throw new Error("id is required");
  const ext = req.language === "json" ? ".json" : ".xml";
  const relDir = (req.dir ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const relPath = (relDir ? `${relDir}/` : "") + id + ext;
  const absDir = path.join(root, relDir);
  const absPath = path.join(absDir, id + ext);

  if (await exists(absPath)) throw new Error(`File already exists: ${relPath}`);

  const base = (req.canonicalBase || "http://example.org/fhir").replace(/\/+$/, "");
  const url = `${base}/${req.resourceType}/${id}`;
  const obj = skeletonObject({ ...req, id }, url);

  await mkdir(absDir, { recursive: true });
  await writeFile(absPath, serialize(obj, req.language), "utf8");
  return { artifactId: relPath };
}
