import type {
  Artifact,
  Edit,
  ElementView,
  ProfileView,
  TextChange,
} from "@igb/shared";
import { collapseToOriginal, type Adapter, type LoadedSource } from "./types.js";
import {
  attrValue,
  child,
  children,
  childIndent,
  leafValue,
  localName,
  scanXml,
  type XmlElement,
} from "./xml-scan.js";

/** Canonical child order within ElementDefinition (subset we anchor against). */
const ELEMENT_ORDER = [
  "path",
  "representation",
  "sliceName",
  "sliceIsConstraining",
  "label",
  "code",
  "slicing",
  "short",
  "definition",
  "comment",
  "requirements",
  "alias",
  "min",
  "max",
  "base",
  "contentReference",
  "type",
  "defaultValue",
  "meaningWhenMissing",
  "fixed",
  "pattern",
  "example",
  "minValue",
  "maxValue",
  "maxLength",
  "condition",
  "constraint",
  "mustSupport",
  "isModifier",
  "isSummary",
  "binding",
  "mapping",
];
const BINDING_ORDER = ["strength", "description", "valueSet"];

function escapeXmlAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function findRoot(text: string): XmlElement | undefined {
  return scanXml(text).find((e) => localName(e.name) === "StructureDefinition");
}

function findDifferential(sd: XmlElement): XmlElement | undefined {
  return child(sd, "differential");
}

/** Find a differential element by ElementDefinition.id or .path. */
function findElement(diff: XmlElement, path: string): XmlElement | undefined {
  return children(diff, "element").find(
    (el) => attrValue(el, "id") === path || leafValue(child(el, "path")) === path,
  );
}

export const xmlAdapter: Adapter = {
  language: "xml",
  extensions: [".xml"],

  describe(src: LoadedSource): Artifact | null {
    const root = scanXml(src.text)[0];
    if (!root) return null;
    const rt = localName(root.name);
    // Only treat FHIR resources (heuristic: has child leaf elements with value).
    const name = leafValue(child(root, "name")) ?? leafValue(child(root, "id")) ?? src.id;
    return {
      id: src.id,
      filePath: src.filePath,
      language: "xml",
      resourceType: rt,
      name,
      url: leafValue(child(root, "url")),
      supported: rt === "StructureDefinition",
    };
  },

  toProfileView(src: LoadedSource, artifact: Artifact): ProfileView | null {
    const root = findRoot(src.text);
    if (!root) return null;
    const diff = findDifferential(root);
    const elements: ElementView[] = [];
    if (diff) {
      for (const el of children(diff, "element")) {
        const path = leafValue(child(el, "path")) ?? attrValue(el, "id") ?? "";
        const sliceName = leafValue(child(el, "sliceName"));
        const binding = child(el, "binding");
        const typeEls = children(el, "type");
        const extProfile = typeEls
          .map((t) => leafValue(child(t, "profile")))
          .find(Boolean);
        elements.push({
          id: attrValue(el, "id") ?? path,
          path,
          min: numberOrUndef(leafValue(child(el, "min"))),
          max: leafValue(child(el, "max")),
          short: leafValue(child(el, "short")),
          mustSupport: leafValue(child(el, "mustSupport")) === "true",
          types: typeEls.map((t) => leafValue(child(t, "code"))).filter(Boolean) as string[],
          binding: binding
            ? {
                strength: leafValue(child(binding, "strength")) as any,
                valueSet: leafValue(child(binding, "valueSet")),
              }
            : undefined,
          sliceName,
          extensionUrl: extProfile,
          inDifferential: true,
        });
      }
    }
    return {
      artifactId: artifact.id,
      name: leafValue(child(root, "name")) ?? artifact.name,
      title: leafValue(child(root, "title")),
      type: leafValue(child(root, "type")) ?? "",
      baseDefinition: leafValue(child(root, "baseDefinition")),
      derivation: leafValue(child(root, "derivation")) as any,
      url: leafValue(child(root, "url")),
      elements,
    };
  },

  computeChanges(src: LoadedSource, edits: Edit[]): TextChange[] {
    let working = src.text;
    const descs: string[] = [];

    for (const edit of edits) {
      if (edit.kind === "setCardinality") {
        working = ensureElement(working, edit.path);
        working = setElementLeaf(working, edit.path, "min", String(edit.min));
        working = setElementLeaf(working, edit.path, "max", edit.max);
        descs.push(`${edit.path} cardinality → ${edit.min}..${edit.max}`);
      } else if (edit.kind === "setBinding") {
        working = ensureElement(working, edit.path);
        working = ensureBinding(working, edit.path, edit.valueSet, edit.strength);
        descs.push(`${edit.path} binding → ${edit.valueSet} (${edit.strength})`);
      } else if (edit.kind === "addSlice") {
        working = ensureElement(working, edit.path);
        if (edit.discriminator) working = ensureSlicing(working, edit.path, edit.discriminator);
        working = insertDifferentialElement(working, {
          id: `${edit.path}:${edit.sliceName}`,
          path: edit.path,
          sliceName: edit.sliceName,
          min: edit.min,
          max: edit.max,
        });
        descs.push(`${edit.path} slice + ${edit.sliceName}`);
      } else if (edit.kind === "addExtension") {
        const extPath = `${edit.path}.extension`;
        working = insertDifferentialElement(working, {
          id: `${extPath}:${edit.sliceName}`,
          path: extPath,
          sliceName: edit.sliceName,
          min: edit.min,
          max: edit.max,
          extensionProfile: edit.extensionUrl,
        });
        descs.push(`${extPath} + extension ${edit.sliceName}`);
      }
    }
    return collapseToOriginal(src.text, working, descs);
  },
};

interface NewElement {
  id: string;
  path: string;
  sliceName?: string;
  min: number;
  max: string;
  extensionProfile?: string;
}

/** Build and insert a new <element> before the differential's closing tag. */
function insertDifferentialElement(text: string, spec: NewElement): string {
  const root = findRoot(text);
  const diff = root && findDifferential(root);
  if (!diff) return text;

  const elIndent = childIndent(text, diff);
  const i = elIndent + "  ";
  const lines: string[] = [`${elIndent}<element id="${escapeXmlAttr(spec.id)}">`];
  lines.push(`${i}<path value="${escapeXmlAttr(spec.path)}"/>`);
  if (spec.sliceName) lines.push(`${i}<sliceName value="${escapeXmlAttr(spec.sliceName)}"/>`);
  lines.push(`${i}<min value="${spec.min}"/>`);
  lines.push(`${i}<max value="${escapeXmlAttr(spec.max)}"/>`);
  if (spec.extensionProfile) {
    lines.push(`${i}<type>`);
    lines.push(`${i}  <code value="Extension"/>`);
    lines.push(`${i}  <profile value="${escapeXmlAttr(spec.extensionProfile)}"/>`);
    lines.push(`${i}</type>`);
  }
  lines.push(`${elIndent}</element>`);
  const block = "\n" + lines.join("\n");
  const at = differentialInsertPoint(diff);
  return splice(text, at, at, block);
}

/**
 * Where to insert a new <element>: just after the last existing element (so the
 * differential's closing tag keeps its own line), or right after the open tag.
 */
function differentialInsertPoint(diff: XmlElement): number {
  const els = children(diff, "element");
  return els.length ? els[els.length - 1].closeTagEnd : diff.openTagEnd;
}

/** Find the un-sliced base element for a path (the slicing header). */
function findBaseElement(diff: XmlElement, path: string): XmlElement | undefined {
  return children(diff, "element").find(
    (el) =>
      (attrValue(el, "id") === path || leafValue(child(el, "path")) === path) &&
      !child(el, "sliceName"),
  );
}

/** Ensure a <slicing> block exists on the base element for `path`. */
function ensureSlicing(
  text: string,
  path: string,
  disc: { type: string; path: string },
): string {
  const root = findRoot(text);
  const diff = root && findDifferential(root);
  const base = diff && findBaseElement(diff, path);
  if (!base || child(base, "slicing")) return text;

  const { at, indent } = insertionPoint(text, base, "slicing", ELEMENT_ORDER);
  const i = indent + "  ";
  const block =
    `\n${indent}<slicing>` +
    `\n${i}<discriminator>` +
    `\n${i}  <type value="${escapeXmlAttr(disc.type)}"/>` +
    `\n${i}  <path value="${escapeXmlAttr(disc.path)}"/>` +
    `\n${i}</discriminator>` +
    `\n${i}<rules value="open"/>` +
    `\n${indent}</slicing>`;
  return splice(text, at, at, block);
}

function numberOrUndef(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/* ---------------- mutation primitives ---------------- */

/** Apply a single {start,end,newText} splice to text. */
function splice(text: string, start: number, end: number, newText: string): string {
  return text.slice(0, start) + newText + text.slice(end);
}

/** Find where to insert a new child of `name`, returning [offset, prefixIsNewline]. */
function insertionPoint(
  text: string,
  container: XmlElement,
  name: string,
  order: string[],
): { at: number; indent: string } {
  const idx = order.indexOf(name);
  let anchor: XmlElement | undefined;
  for (const c of container.children) {
    const ci = order.indexOf(localName(c.name));
    if (ci !== -1 && idx !== -1 && ci < idx) anchor = c;
  }
  const indent = childIndent(text, container);
  if (anchor) return { at: anchor.closeTagEnd, indent };
  // Insert as the first child, right after the container's open tag.
  return { at: container.openTagEnd, indent };
}

/** Set (or insert) a FHIR leaf `<name value="..."/>` inside `container`. */
function setLeaf(
  text: string,
  container: XmlElement,
  name: string,
  value: string,
  order: string[],
): string {
  const existing = child(container, name);
  if (existing) {
    const v = existing.attrs.find((a) => a.name === "value");
    if (v) return splice(text, v.valueStart, v.valueEnd, escapeXmlAttr(value));
    // Leaf with no value attribute — replace whole element.
    return splice(
      text,
      existing.tagStart,
      existing.closeTagEnd,
      `<${name} value="${escapeXmlAttr(value)}"/>`,
    );
  }
  const { at, indent } = insertionPoint(text, container, name, order);
  return splice(text, at, at, `\n${indent}<${name} value="${escapeXmlAttr(value)}"/>`);
}

/** Set a leaf inside the differential element identified by `path`. */
function setElementLeaf(text: string, path: string, name: string, value: string): string {
  const root = findRoot(text);
  const diff = root && findDifferential(root);
  const el = diff && findElement(diff, path);
  if (!el) return text;
  return setLeaf(text, el, name, value, ELEMENT_ORDER);
}

/** Ensure a differential element for `path` exists; create a minimal one if not. */
function ensureElement(text: string, path: string): string {
  const root = findRoot(text);
  if (!root) return text;
  const diff = findDifferential(root);
  if (!diff) return text;
  if (findElement(diff, path)) return text;

  const elIndent = childIndent(text, diff);
  const inner = elIndent + "  ";
  const block =
    `\n${elIndent}<element id="${escapeXmlAttr(path)}">` +
    `\n${inner}<path value="${escapeXmlAttr(path)}"/>` +
    `\n${elIndent}</element>`;
  const at = differentialInsertPoint(diff);
  return splice(text, at, at, block);
}

function ensureBinding(text: string, path: string, valueSet: string, strength: string): string {
  let working = text;
  let root = findRoot(working);
  let diff = root && findDifferential(root);
  let el = diff && findElement(diff, path);
  if (!el) return working;

  const binding = child(el, "binding");
  if (!binding) {
    const { at, indent } = insertionPoint(working, el, "binding", ELEMENT_ORDER);
    const inner = indent + "  ";
    const block =
      `\n${indent}<binding>` +
      `\n${inner}<strength value="${escapeXmlAttr(strength)}"/>` +
      `\n${inner}<valueSet value="${escapeXmlAttr(valueSet)}"/>` +
      `\n${indent}</binding>`;
    return splice(working, at, at, block);
  }

  // Binding exists — set its strength and valueSet leaves in place.
  working = setBindingLeaf(working, path, "strength", strength);
  working = setBindingLeaf(working, path, "valueSet", valueSet);
  return working;
}

function setBindingLeaf(text: string, path: string, name: string, value: string): string {
  const root = findRoot(text);
  const diff = root && findDifferential(root);
  const el = diff && findElement(diff, path);
  const binding = el && child(el, "binding");
  if (!binding) return text;
  return setLeaf(text, binding, name, value, BINDING_ORDER);
}
