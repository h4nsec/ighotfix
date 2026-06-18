import {
  parseTree,
  findNodeAtLocation,
  modify,
  type Node,
  type JSONPath,
} from "jsonc-parser";
import {
  classify,
  parsePath,
  type Artifact,
  type Edit,
  type ElementView,
  type ProfileView,
  type TextChange,
} from "@igb/shared";
import { collapseToOriginal, type Adapter, type LoadedSource } from "./types.js";

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

/** Index of the base (un-sliced) element for a path — the slicing header. */
function findBaseElementIndex(
  root: Node | undefined,
  path: string,
): number | undefined {
  const elements = root && findNodeAtLocation(root, ["differential", "element"]);
  if (!elements || elements.type !== "array" || !elements.children) return undefined;
  for (let i = 0; i < elements.children.length; i++) {
    const el = elements.children[i];
    const p = findNodeAtLocation(el, ["path"])?.value;
    const sliceName = findNodeAtLocation(el, ["sliceName"])?.value;
    if (p === path && sliceName === undefined) return i;
  }
  return undefined;
}

function hasSlicing(root: Node | undefined, idx: number): boolean {
  const el = root && findNodeAtLocation(root, ["differential", "element", idx]);
  return !!el && findNodeAtLocation(el, ["slicing"]) !== undefined;
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
    if (!obj || typeof obj !== "object" || typeof obj.resourceType !== "string") return null;
    const c = classify(obj.resourceType, { sdType: obj.type, sdKind: obj.kind });
    return {
      id: src.id,
      filePath: src.filePath,
      language: "json",
      resourceType: obj.resourceType,
      name: obj.name ?? obj.id ?? src.id,
      title: obj.title,
      url: obj.url,
      ...c,
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
    const elements: ElementView[] = diff.map((el): ElementView => {
      const extProfile = Array.isArray(el.type)
        ? el.type.map((t: any) => t.profile?.[0]).find(Boolean)
        : undefined;
      return {
        id: el.id ?? el.path,
        path: el.path,
        min: el.min,
        max: el.max,
        short: el.short,
        mustSupport: el.mustSupport,
        isSummary: el.isSummary,
        isModifier: el.isModifier,
        types: Array.isArray(el.type)
          ? el.type.map((t: any) => t.code).filter(Boolean)
          : undefined,
        binding: el.binding
          ? { strength: el.binding.strength, valueSet: el.binding.valueSet }
          : undefined,
        sliceName: el.sliceName,
        slicing: el.slicing
          ? {
              discriminator: el.slicing.discriminator,
              rules: el.slicing.rules,
              ordered: el.slicing.ordered,
            }
          : undefined,
        extensionUrl: extProfile,
        inDifferential: true,
      };
    });

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
      } else if (edit.kind === "setFlag") {
        if (edit.value) {
          if (idx === undefined) {
            const at = differentialLength(root);
            mods.push({
              path: ["differential", "element", at],
              value: { id: edit.path, path: edit.path, [edit.flag]: true },
              insert: true,
            });
          } else {
            mods.push({ path: ["differential", "element", idx, edit.flag], value: true });
          }
        } else if (idx !== undefined) {
          // Clearing a flag removes the property (FHIR omits false).
          mods.push({ path: ["differential", "element", idx, edit.flag], value: undefined });
        }
        description = `${edit.path} ${edit.flag} → ${edit.value}`;
      } else if (edit.kind === "addSlice") {
        const baseIdx = findBaseElementIndex(root, edit.path);
        if (baseIdx !== undefined && !hasSlicing(root, baseIdx)) {
          mods.push({
            path: ["differential", "element", baseIdx, "slicing"],
            value: {
              ...(edit.discriminator
                ? { discriminator: [{ type: edit.discriminator.type, path: edit.discriminator.path }] }
                : {}),
              rules: "open",
            },
          });
        }
        mods.push({
          path: ["differential", "element", differentialLength(root)],
          value: {
            id: `${edit.path}:${edit.sliceName}`,
            path: edit.path,
            sliceName: edit.sliceName,
            min: edit.min,
            max: edit.max,
          },
          insert: true,
        });
        description = `${edit.path} slice + ${edit.sliceName}`;
      } else if (edit.kind === "addExtension") {
        const extPath = `${edit.path}.extension`;
        mods.push({
          path: ["differential", "element", differentialLength(root)],
          value: {
            id: `${extPath}:${edit.sliceName}`,
            path: extPath,
            sliceName: edit.sliceName,
            min: edit.min,
            max: edit.max,
            type: [{ code: "Extension", profile: [edit.extensionUrl] }],
          },
          insert: true,
        });
        description = `${extPath} + extension ${edit.sliceName}`;
      } else if (edit.kind === "setValue") {
        mods.push({ path: parsePath(edit.path), value: edit.value === null ? undefined : edit.value });
        description = edit.description ?? `${edit.path} = ${edit.value}`;
      } else if (edit.kind === "addValue") {
        const arrPath = parsePath(edit.path);
        const node = findNodeAtLocation(root!, arrPath);
        const at = node?.type === "array" ? (node.children?.length ?? 0) : 0;
        mods.push({ path: [...arrPath, at], value: edit.value, insert: true });
        description = edit.description ?? `${edit.path} + item`;
      } else if (edit.kind === "removeValue") {
        mods.push({ path: parsePath(edit.path), value: undefined });
        description = edit.description ?? `remove ${edit.path}`;
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
    // so report a single clean, offset-correct splice relative to the original.
    return collapseToOriginal(src.text, working, changes.map((c) => c.description));
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
