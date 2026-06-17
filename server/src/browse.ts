import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export interface BrowseDir {
  name: string;
  path: string;
  /** Markers suggesting this folder is a FHIR IG root. */
  igMarkers: string[];
}

export interface BrowseResult {
  /** Absolute path being listed. Empty string = the drive list (Windows). */
  path: string;
  /** Parent path to navigate up to, or null at the top. */
  parent: string | null;
  sep: string;
  dirs: BrowseDir[];
  /** Shallow count of loadable artifacts directly in this folder. */
  fileCounts: { fsh: number; json: number; xml: number };
  /** IG markers found in the listed folder itself. */
  igMarkers: string[];
}

const IG_MARKER_FILES = ["sushi-config.yaml", "sushi-config.yml", "ig.ini"];
const IG_MARKER_DIRS = ["input", "fsh"];
const SKIP_DIRS = new Set(["node_modules", ".git", "output", "temp", "fsh-generated"]);

function isWindows(): boolean {
  return process.platform === "win32";
}

function listDrives(): BrowseDir[] {
  const drives: BrowseDir[] = [];
  for (let c = 65; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    if (existsSync(root)) drives.push({ name: root, path: root, igMarkers: [] });
  }
  return drives;
}

/** Detect IG markers present in `dir` (non-recursive). */
function igMarkersIn(dir: string, names: Set<string>): string[] {
  const markers: string[] = [];
  for (const f of IG_MARKER_FILES) if (names.has(f.toLowerCase())) markers.push(f);
  for (const d of IG_MARKER_DIRS) if (names.has(d.toLowerCase())) markers.push(`${d}/`);
  return markers;
}

export async function browse(input: string): Promise<BrowseResult> {
  const sep = path.sep;

  // Top level on Windows: present the drive list.
  if (isWindows() && (!input || input === "/" || input === "\\")) {
    return {
      path: "",
      parent: null,
      sep,
      dirs: listDrives(),
      fileCounts: { fsh: 0, json: 0, xml: 0 },
      igMarkers: [],
    };
  }

  const abs = path.resolve(input || (isWindows() ? "" : "/"));
  const entries = await readdir(abs, { withFileTypes: true });

  const dirs: BrowseDir[] = [];
  const fileCounts = { fsh: 0, json: 0, xml: 0 };

  // Build a lower-cased name set of children for fast IG-marker detection.
  const subdirChecks: Promise<void>[] = [];

  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      const childPath = path.join(abs, e.name);
      const dir: BrowseDir = { name: e.name, path: childPath, igMarkers: [] };
      dirs.push(dir);
      // Peek one level in to flag likely IG roots (best-effort, ignore errors).
      subdirChecks.push(
        readdir(childPath)
          .then((names) => {
            dir.igMarkers = igMarkersIn(
              childPath,
              new Set(names.map((n) => n.toLowerCase())),
            );
          })
          .catch(() => {}),
      );
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (ext === ".fsh") fileCounts.fsh++;
      else if (ext === ".json") fileCounts.json++;
      else if (ext === ".xml") fileCounts.xml++;
    }
  }

  await Promise.all(subdirChecks);
  dirs.sort((a, b) => a.name.localeCompare(b.name));

  const parentPath = path.dirname(abs);
  const parent =
    parentPath === abs
      ? isWindows()
        ? "" // drive root → go back to the drive list
        : null
      : parentPath;

  const selfNames = new Set(entries.map((e) => e.name.toLowerCase()));

  return {
    path: abs,
    parent,
    sep,
    dirs,
    fileCounts,
    igMarkers: igMarkersIn(abs, selfNames),
  };
}
