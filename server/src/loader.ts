import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { classifyFile, type Artifact, type IgSummary } from "@igb/shared";
import { adapterForExtension, type LoadedSource } from "./adapters/index.js";

const PATTERNS = [
  "**/*.fsh",
  "**/*.json",
  "**/*.xml",
  "**/*.ini",
  "**/*.yaml",
  "**/*.yml",
  "**/*.md",
  "**/*.txt",
];
const IGNORE = [
  "**/node_modules/**",
  "**/output/**",
  "**/temp/**",
  "**/.git/**",
  "**/.github/**",
  "**/fsh-generated/**",
  "**/input-cache/**",
  "**/template/**",
];

/** Files that are never useful to surface even though they match the patterns. */
const SKIP_NAMES = new Set(["package-lock.json", "package.lock.json"]);

const FHIR_EXTS = new Set([".fsh", ".json", ".xml"]);

export async function loadSource(
  root: string,
  rel: string,
): Promise<LoadedSource | null> {
  const ext = path.extname(rel);
  const adapter = adapterForExtension(ext);
  if (!adapter) return null;
  const filePath = path.join(root, rel);
  const text = await readFile(filePath, "utf8");
  return { id: rel.split(path.sep).join("/"), filePath, language: adapter.language, text };
}

/** Read the raw text of any IG file (FHIR or not). */
export async function readRaw(root: string, rel: string): Promise<string> {
  return readFile(path.join(root, rel), "utf8");
}

/** Build an Artifact for a non-FHIR file (config, page, or other). */
function fileArtifact(root: string, rel: string): Artifact | null {
  const id = rel.split(path.sep).join("/");
  const base = path.basename(rel);
  const c = classifyFile(base);
  if (!c) return null;
  return {
    id,
    filePath: path.join(root, rel),
    format: c.format,
    resourceType: "",
    name: base,
    title: id,
    kind: c.kind,
    category: c.category,
    editable: false,
  };
}

export async function loadIg(root: string): Promise<IgSummary> {
  const files = await fg(PATTERNS, {
    cwd: root,
    ignore: IGNORE,
    dot: false,
    onlyFiles: true,
  });

  const artifacts: Artifact[] = [];
  for (const rel of files) {
    if (SKIP_NAMES.has(path.basename(rel).toLowerCase())) continue;
    const ext = path.extname(rel).toLowerCase();

    // FHIR-shaped files: let the adapter recognise them first.
    if (FHIR_EXTS.has(ext)) {
      const src = await loadSource(root, rel);
      const adapter = src && adapterForExtension(ext);
      const artifact = adapter && src ? adapter.describe(src) : null;
      if (artifact) {
        artifacts.push(artifact);
        continue;
      }
    }
    // Otherwise surface it as a plain editable file.
    const fileArt = fileArtifact(root, rel);
    if (fileArt) artifacts.push(fileArt);
  }

  artifacts.sort((a, b) => a.id.localeCompare(b.id));
  return { root, artifacts };
}
