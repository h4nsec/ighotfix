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
    const root = scanXml(src.text).find((e) => localName(e.name) !== "?xml") ?? scanXml(src.text)[0];
    if (!root) return null;
    // Only treat genuine FHIR resources — the xmlns must be the FHIR namespace.
    // This rejects xhtml fragments (<div>, <ul>) found in IG page content.
    const xmlns = attrValue(root, "xmlns");
    if (!xmlns || !xmlns.includes("hl7.org/fhir")) return null;
    const rt = localName(root.name);
    const sdType = leafValue(child(root, "type"));
    const sdKind = leafValue(child(root, "kind"));
    const c = classify(rt, { sdType, sdKind });
    return {
      id: src.id,
      filePath: src.filePath,
      language: "xml",
      resourceType: rt,
      name: leafValue(child(root, "name")) ?? leafValue(child(root, "id")) ?? src.id,
      title: leafValue(child(root, "title")),
      url: leafValue(child(root, "url")),
      ...c,
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
          isSummary: leafValue(child(el, "isSummary")) === "true",
          isModifier: leafValue(child(el, "isModifier")) === "true",
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
      } else if (edit.kind === "setFlag") {
        if (edit.value) {
          working = ensureElement(working, edit.path);
          working = setElementLeaf(working, edit.path, edit.flag, "true");
        } else {
          working = removeElementLeaf(working, edit.path, edit.flag);
        }
        descs.push(`${edit.path} ${edit.flag} → ${edit.value}`);
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
      } else if (edit.kind === "setValue") {
        working = setValueAtPath(working, edit.path, edit.value);
        descs.push(edit.description ?? `${edit.path} = ${edit.value}`);
      } else if (edit.kind === "addValue") {
        working = addValueAtPath(working, edit.path, edit.value);
        descs.push(edit.description ?? `${edit.path} + item`);
      } else if (edit.kind === "removeValue") {
        working = removeValueAtPath(working, edit.path);
        descs.push(edit.description ?? `remove ${edit.path}`);
      }
    }
    return collapseToOriginal(src.text, working, descs);
  },
};

/* ---------------- generic path-addressed edits ---------------- */

function resourceRoot(text: string): XmlElement | undefined {
  const roots = scanXml(text);
  return roots.find((e) => localName(e.name) !== "?xml") ?? roots[0];
}

/** Walk (name, optional index) pairs from a starting element. */
function walkPath(start: XmlElement, segs: (string | number)[]): XmlElement | undefined {
  let cur: XmlElement | undefined = start;
  let i = 0;
  while (i < segs.length && cur) {
    const name = segs[i++] as string;
    const kids = children(cur, name);
    let idx = 0;
    if (typeof segs[i] === "number") {
      idx = segs[i] as number;
      i++;
    }
    cur = kids[idx];
  }
  return cur;
}

function primitiveStr(v: unknown): string {
  return escapeXmlAttr(typeof v === "string" ? v : String(v));
}

/** Replace (or add) the `value` attribute on an element. */
function setValueAttr(text: string, el: XmlElement, value: unknown): string {
  const v = el.attrs.find((a) => a.name === "value");
  if (v) return splice(text, v.valueStart, v.valueEnd, primitiveStr(value));
  // No value attribute yet — insert one just before the tag's `>` or `/>`.
  const insertAt = el.selfClosing ? el.openTagEnd - 2 : el.openTagEnd - 1;
  return splice(text, insertAt, insertAt, ` value="${primitiveStr(value)}"`);
}

function setValueAtPath(text: string, path: string, value: unknown): string {
  if (value === null) return removeValueAtPath(text, path);
  const root = resourceRoot(text);
  if (!root) return text;
  const segs = parsePath(path);
  const last = segs[segs.length - 1];
  if (typeof last === "number") {
    const el = walkPath(root, segs);
    return el ? setValueAttr(text, el, value) : text;
  }
  const parent = walkPath(root, segs.slice(0, -1));
  if (!parent) return text;
  const existing = child(parent, last);
  if (existing) return setValueAttr(text, existing, value);
  // Append a new leaf at the end of the parent's children.
  const indent = childIndent(text, parent);
  const block = `\n${indent}<${last} value="${primitiveStr(value)}"/>`;
  const els = parent.children;
  const at = els.length ? els[els.length - 1].closeTagEnd : parent.openTagEnd;
  return splice(text, at, at, block);
}

/** Keys that are XML attributes in FHIR (not child elements). */
const XML_ATTR_KEYS = new Set(["url", "id"]);

/** Build XML for an added array item (primitive leaf or nested object). */
function objectToXml(name: string, value: unknown, indent: string): string {
  if (value === null || value === undefined || typeof value !== "object") {
    return `${indent}<${name} value="${primitiveStr(value)}"/>`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  // FHIR XML carries url/id (and primitive `value`) as attributes on the tag.
  const attrs = entries
    .filter(([k, v]) => (XML_ATTR_KEYS.has(k) || k === "value") && typeof v !== "object")
    .map(([k, v]) => ` ${k}="${primitiveStr(v)}"`)
    .join("");
  const childEntries = entries.filter(
    ([k, v]) => !((XML_ATTR_KEYS.has(k) || k === "value") && typeof v !== "object"),
  );
  if (childEntries.length === 0) return `${indent}<${name}${attrs}/>`;
  const lines = [`${indent}<${name}${attrs}>`];
  for (const [k, v] of childEntries) {
    if (Array.isArray(v)) for (const item of v) lines.push(objectToXml(k, item, indent + "  "));
    else lines.push(objectToXml(k, v, indent + "  "));
  }
  lines.push(`${indent}</${name}>`);
  return lines.join("\n");
}

function addValueAtPath(text: string, path: string, value: unknown): string {
  const root = resourceRoot(text);
  if (!root) return text;
  const segs = parsePath(path);
  const name = segs[segs.length - 1] as string;
  const parent = walkPath(root, segs.slice(0, -1));
  if (!parent || typeof name !== "string") return text;
  const indent = childIndent(text, parent);
  const block = "\n" + objectToXml(name, value, indent);
  // Insert after the last existing sibling of the same name, else at end.
  const sameName = children(parent, name);
  const anchor = sameName.length
    ? sameName[sameName.length - 1].closeTagEnd
    : parent.children.length
      ? parent.children[parent.children.length - 1].closeTagEnd
      : parent.openTagEnd;
  return splice(text, anchor, anchor, block);
}

function removeValueAtPath(text: string, path: string): string {
  const root = resourceRoot(text);
  if (!root) return text;
  const segs = parsePath(path);
  const last = segs[segs.length - 1];
  const target =
    typeof last === "number"
      ? walkPath(root, segs)
      : (() => {
          const parent = walkPath(root, segs.slice(0, -1));
          return parent && child(parent, last);
        })();
  if (!target) return text;
  const lineStart = text.lastIndexOf("\n", target.tagStart);
  const from = lineStart === -1 ? target.tagStart : lineStart;
  return splice(text, from, target.closeTagEnd, "");
}

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

/** Remove a leaf child (e.g. <mustSupport/>) from a differential element. */
function removeElementLeaf(text: string, path: string, name: string): string {
  const root = findRoot(text);
  const diff = root && findDifferential(root);
  const el = diff && findElement(diff, path);
  const leaf = el && child(el, name);
  if (!leaf) return text;
  // Remove the whole line, including the preceding newline + indentation.
  const lineStart = text.lastIndexOf("\n", leaf.tagStart);
  const from = lineStart === -1 ? leaf.tagStart : lineStart;
  return splice(text, from, leaf.closeTagEnd, "");
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
