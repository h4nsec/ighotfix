import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { Artifact, IgSummary } from "@igb/shared";
import { adapterForExtension, type LoadedSource } from "./adapters/index.js";

const PATTERNS = ["**/*.fsh", "**/*.json", "**/*.xml"];
const IGNORE = [
  "**/node_modules/**",
  "**/output/**",
  "**/temp/**",
  "**/.git/**",
  "**/fsh-generated/**",
  "**/input-cache/**",
  "**/pagecontent/**",
  "**/includes/**",
  "**/intro-notes/**",
];

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

export async function loadIg(root: string): Promise<IgSummary> {
  const files = await fg(PATTERNS, {
    cwd: root,
    ignore: IGNORE,
    dot: false,
    onlyFiles: true,
  });

  const artifacts: Artifact[] = [];
  for (const rel of files) {
    const src = await loadSource(root, rel);
    if (!src) continue;
    const adapter = adapterForExtension(path.extname(rel));
    const artifact = adapter?.describe(src);
    if (artifact) artifacts.push(artifact);
  }

  artifacts.sort((a, b) => a.id.localeCompare(b.id));
  return { root, artifacts };
}
