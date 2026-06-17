import {
  parseTree,
  findNodeAtLocation,
  modify,
  type Node,
  type JSONPath,
} from "jsonc-parser";
import type {
  Artifact,
  Edit,
  ElementView,
  ProfileView,
  TextChange,
} from "@igb/shared";
import type { Adapter, LoadedSource } from "./types.js";

const FORMAT = {
  insertSpaces: true,
  tabSize: 2,
  // Keep the existing EOL of the document where possible.
  eol: "\n",
} as const;

function getString(root: Node | undefined, path: JSONPath): string | undefined {
  if (!root) return undefined;
  const n = findNodeAtLocation(root, path);
  return typeof n?.value === "string" ? n.value : undefined;
}

function getNumber(root: Node | undefined, path: JSONPath): number | undefined {
  if (!root) return undefined;
  const n = findNodeAtLocation(root, path);
  return typeof n?.value === "number" ? n.value : undefined;
}

/** Locate the index of a differential element by its id (preferred) or path. */
function findElementIndex(
  root: Node | undefined,
  path: string,
): number | undefined {
  const elements = root && findNodeAtLocation(root, ["differential", "element"]);
  if (!elements || elements.type !== "array" || !elements.children) return undefined;
  for (let i = 0; i < elements.children.length; i++) {
    const el = elements.children[i];
    const id = findNodeAtLocation(el, ["id"])?.value;
    const p = findNodeAtLocation(el, ["path"])?.value;
    if (id === path || p === path) return i;
  }
  return undefined;
}

function differentialLength(root: Node | undefined): number {
  const elements = root && findNodeAtLocation(root, ["differential", "element"]);
  return elements?.children?.length ?? 0;
}

export const jsonAdapter: Adapter = {
  language: "json",
  extensions: [".json"],

  describe(src: LoadedSource): Artifact | null {
    let obj: any;
    try {
      obj = JSON.parse(src.text);
    } catch {
      return null;
    }
    if (!obj || typeof obj !== "object" || !obj.resourceType) return null;
    return {
      id: src.id,
      filePath: src.filePath,
      language: "json",
      resourceType: obj.resourceType,
      name: obj.name ?? obj.id ?? src.id,
      url: obj.url,
      supported: obj.resourceType === "StructureDefinition",
    };
  },

  toProfileView(src: LoadedSource, artifact: Artifact): ProfileView | null {
    let sd: any;
    try {
      sd = JSON.parse(src.text);
    } catch {
      return null;
    }
    if (sd.resourceType !== "StructureDefinition") return null;

    const diff: any[] = sd.differential?.element ?? [];
    const elements: ElementView[] = diff.map((el): ElementView => ({
      id: el.id ?? el.path,
      path: el.path,
      min: el.min,
      max: el.max,
      short: el.short,
      mustSupport: el.mustSupport,
      types: Array.isArray(el.type)
        ? el.type.map((t: any) => t.code).filter(Boolean)
        : undefined,
      binding: el.binding
        ? { strength: el.binding.strength, valueSet: el.binding.valueSet }
        : undefined,
      inDifferential: true,
    }));

    return {
      artifactId: artifact.id,
      name: sd.name ?? artifact.name,
      title: sd.title,
      type: sd.type,
      baseDefinition: sd.baseDefinition,
      derivation: sd.derivation,
      url: sd.url,
      elements,
    };
  },

  computeChanges(src: LoadedSource, edits: Edit[]): TextChange[] {
    // Apply edits sequentially against a working copy so offsets stay valid,
    // then diff working copy spans back as TextChanges. jsonc-parser already
    // produces minimal edits, so we surface those directly per edit and rebase.
    const changes: TextChange[] = [];
    let working = src.text;

    for (const edit of edits) {
      const root = parseTree(working);
      const idx = findElementIndex(root, edit.path);

      const mods: { path: JSONPath; value: unknown; insert?: boolean }[] = [];
      let description = "";

      if (edit.kind === "setCardinality") {
        if (idx === undefined) {
          const at = differentialLength(root);
          mods.push({
            path: ["differential", "element", at],
            value: { id: edit.path, path: edit.path, min: edit.min, max: edit.max },
            insert: true,
          });
        } else {
          mods.push({ path: ["differential", "element", idx, "min"], value: edit.min });
          mods.push({ path: ["differential", "element", idx, "max"], value: edit.max });
        }
        description = `${edit.path} cardinality → ${edit.min}..${edit.max}`;
      } else if (edit.kind === "setBinding") {
        const bindingValue = { strength: edit.strength, valueSet: edit.valueSet };
        if (idx === undefined) {
          const at = differentialLength(root);
          mods.push({
            path: ["differential", "element", at],
            value: { id: edit.path, path: edit.path, binding: bindingValue },
            insert: true,
          });
        } else {
          mods.push({ path: ["differential", "element", idx, "binding"], value: bindingValue });
        }
        description = `${edit.path} binding → ${edit.valueSet} (${edit.strength})`;
      }

      for (const m of mods) {
        const jsoncEdits = modify(working, m.path, m.value, {
          formattingOptions: FORMAT,
          isArrayInsertion: m.insert,
        });
        for (const e of jsoncEdits) {
          changes.push({
            start: e.offset,
            end: e.offset + e.length,
            newText: e.content,
            description,
          });
        }
        // Advance the working copy so subsequent locations resolve correctly.
        working = applyJsoncEdits(working, jsoncEdits);
      }
    }

    // The accumulated `changes` were computed against evolving working copies,
    // so their offsets are not all relative to the original. Recompute a single
    // clean diff: emit one replacement of the whole document is wasteful, so
    // instead we return a single change spanning the changed region.
    return collapseToOriginal(src.text, working, changes);
  },
};

/** Apply jsonc-parser edits (offset/length/content) to text. */
function applyJsoncEdits(
  text: string,
  edits: { offset: number; length: number; content: string }[],
): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, e.offset) + e.content + out.slice(e.offset + e.length);
  }
  return out;
}

/**
 * Because we applied edits against successive working copies, produce a single
 * minimal TextChange describing original→final by trimming the common prefix
 * and suffix. This keeps the round-trip format-preserving and offset-correct.
 */
function collapseToOriginal(
  original: string,
  final: string,
  _raw: TextChange[],
): TextChange[] {
  if (original === final) return [];
  let start = 0;
  const min = Math.min(original.length, final.length);
  while (start < min && original[start] === final[start]) start++;
  let endO = original.length;
  let endF = final.length;
  while (endO > start && endF > start && original[endO - 1] === final[endF - 1]) {
    endO--;
    endF--;
  }
  const descriptions = _raw.map((c) => c.description).filter(Boolean);
  return [
    {
      start,
      end: endO,
      newText: final.slice(start, endF),
      description: [...new Set(descriptions)].join("; "),
    },
  ];
}
