/**
 * A small, position-tracking XML scanner for the FHIR XML subset.
 *
 * We deliberately do not aim for full XML conformance. FHIR XML is well-formed,
 * namespaced-but-simple, uses `value="..."` leaf attributes, and avoids CDATA.
 * What we need is exact source offsets for every element and attribute value so
 * edits can be spliced without disturbing surrounding formatting.
 */

export interface XmlAttr {
  name: string;
  value: string;
  /** Offset of the first character inside the quotes. */
  valueStart: number;
  /** Offset just past the last character inside the quotes. */
  valueEnd: number;
}

export interface XmlElement {
  name: string;
  attrs: XmlAttr[];
  children: XmlElement[];
  parent?: XmlElement;
  /** Offset of the opening `<`. */
  tagStart: number;
  /** Offset just past the opening tag's `>`. */
  openTagEnd: number;
  selfClosing: boolean;
  /** Offset of the closing tag's `<` (`= openTagEnd` when self-closing). */
  closeTagStart: number;
  /** Offset just past the closing tag's `>` (`= openTagEnd` when self-closing). */
  closeTagEnd: number;
}

const NAME_END = /[\s/>]/;
const ATTR_NAME_END = /[\s=/>]/;
const WS = /\s/;

export function scanXml(text: string): XmlElement[] {
  const n = text.length;
  const roots: XmlElement[] = [];
  const stack: XmlElement[] = [];
  let i = 0;

  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt === -1) break;
    i = lt;

    if (text.startsWith("<!--", i)) {
      const e = text.indexOf("-->", i);
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (text.startsWith("<?", i)) {
      const e = text.indexOf("?>", i);
      i = e === -1 ? n : e + 2;
      continue;
    }
    if (text.startsWith("<!", i)) {
      const e = text.indexOf(">", i);
      i = e === -1 ? n : e + 1;
      continue;
    }
    if (text[i + 1] === "/") {
      // Closing tag.
      const gt = text.indexOf(">", i);
      const el = stack.pop();
      if (el) {
        el.closeTagStart = i;
        el.closeTagEnd = gt === -1 ? n : gt + 1;
      }
      i = gt === -1 ? n : gt + 1;
      continue;
    }

    // Opening tag.
    const tagStart = i;
    i++; // skip '<'
    let j = i;
    while (j < n && !NAME_END.test(text[j])) j++;
    const name = text.slice(i, j);

    let k = j;
    const attrs: XmlAttr[] = [];
    let selfClosing = false;
    while (k < n) {
      while (k < n && WS.test(text[k])) k++;
      if (text[k] === "/" && text[k + 1] === ">") {
        selfClosing = true;
        k += 2;
        break;
      }
      if (text[k] === ">") {
        k += 1;
        break;
      }
      const a = k;
      while (k < n && !ATTR_NAME_END.test(text[k])) k++;
      const attrName = text.slice(a, k);
      while (k < n && WS.test(text[k])) k++;
      if (text[k] === "=") {
        k++;
        while (k < n && WS.test(text[k])) k++;
        const quote = text[k];
        if (quote === '"' || quote === "'") {
          const vStart = k + 1;
          const vEnd = text.indexOf(quote, vStart);
          const end = vEnd === -1 ? n : vEnd;
          attrs.push({
            name: attrName,
            value: text.slice(vStart, end),
            valueStart: vStart,
            valueEnd: end,
          });
          k = end + 1;
        }
      } else if (attrName.length === 0) {
        k++; // avoid infinite loop on stray character
      }
    }

    const openTagEnd = k;
    const el: XmlElement = {
      name,
      attrs,
      children: [],
      tagStart,
      openTagEnd,
      selfClosing,
      closeTagStart: openTagEnd,
      closeTagEnd: openTagEnd,
    };
    const parent = stack[stack.length - 1];
    if (parent) {
      el.parent = parent;
      parent.children.push(el);
    } else {
      roots.push(el);
    }
    if (!selfClosing) stack.push(el);
    i = openTagEnd;
  }

  return roots;
}

/* ---------------- helpers ---------------- */

export function attr(el: XmlElement, name: string): XmlAttr | undefined {
  return el.attrs.find((a) => a.name === name);
}

export function attrValue(el: XmlElement, name: string): string | undefined {
  return attr(el, name)?.value;
}

/** First direct child element with the given (local or prefixed) name. */
export function child(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c) => localName(c.name) === name);
}

export function children(el: XmlElement, name: string): XmlElement[] {
  return el.children.filter((c) => localName(c.name) === name);
}

/** The FHIR leaf `value` attribute, e.g. `<min value="1"/>` → "1". */
export function leafValue(el: XmlElement | undefined): string | undefined {
  return el ? attrValue(el, "value") : undefined;
}

export function localName(name: string): string {
  const i = name.indexOf(":");
  return i === -1 ? name : name.slice(i + 1);
}

/** The indentation (leading whitespace) of the line containing `offset`. */
export function indentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const m = /^[ \t]*/.exec(text.slice(lineStart, offset));
  return m ? m[0] : "";
}

/**
 * The indentation a new child of `container` should use: match the existing
 * first child, or the container's own indent plus two spaces.
 */
export function childIndent(text: string, container: XmlElement): string {
  const first = container.children[0];
  if (first) return indentAt(text, first.tagStart);
  return indentAt(text, container.tagStart) + "  ";
}
