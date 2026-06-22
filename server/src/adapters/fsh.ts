import {
  classify,
  parsePath,
  type Artifact,
  type Edit,
  type ElementBinding,
  type ElementFlag,
  type ElementView,
  type ProfileView,
  type TextChange,
} from "@igb/shared";
import { collapseToOriginal, type Adapter, type LoadedSource } from "./types.js";

/* ------------------------------------------------------------------ *
 * A deliberately small, offset-tracking FSH reader.
 *
 * We do NOT attempt to fully parse FSH. We locate entities and the subset
 * of rules we edit (cardinality, value-set bindings) precisely enough to
 * splice the source without disturbing anything else.
 * ------------------------------------------------------------------ */

const ENTITY_KEYWORDS = [
  "Alias",
  "Profile",
  "Extension",
  "Instance",
  "ValueSet",
  "CodeSystem",
  "Invariant",
  "Mapping",
  "Logical",
  "Resource",
  "RuleSet",
] as const;

const ENTITY_RE = new RegExp(`^(${ENTITY_KEYWORDS.join("|")})\\s*:\\s*(.*)$`);
const CARD_RE = /\b(\d+)\.\.(\d+|\*)/;
const STRENGTHS = ["required", "extensible", "preferred", "example"] as const;

/** FSH flag token for each editable boolean flag. */
const FLAG_TOKENS: Record<ElementFlag, string> = {
  mustSupport: "MS",
  isSummary: "SU",
  isModifier: "?!",
};

/** A matcher for a flag token — word-bounded for letters, literal for `?!`. */
function flagRegex(token: string): RegExp {
  if (/^[A-Za-z]/.test(token)) return new RegExp(`\\b${token}\\b`);
  return new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
const FLAG_RES: Record<ElementFlag, RegExp> = {
  mustSupport: flagRegex(FLAG_TOKENS.mustSupport),
  isSummary: flagRegex(FLAG_TOKENS.isSummary),
  isModifier: flagRegex(FLAG_TOKENS.isModifier),
};

interface Span {
  start: number;
  end: number;
}

interface SliceItem {
  /** The contained item: a slice name, or extension name/url. */
  item: string;
  /** The `named` alias (extension usages), if present. */
  named?: string;
  min?: number;
  max?: string;
}

interface FshRule {
  path: string;
  /** Offset of the line start. */
  lineStart: number;
  /** Offset just past the line content (before newline). */
  lineEnd: number;
  /** The text after the path token (the rule body). */
  rest: string;
  /** Span of the `min..max` token, if present. */
  card?: Span & { min: number; max: string };
  /** Span of the path token. */
  pathSpan: Span;
  /** Parsed `contains` slice/extension items, if this is a contains rule. */
  contains?: SliceItem[];
  /** Binding clause `from VS (strength)` if present. */
  binding?: {
    span: Span; // whole "from ... (strength)" clause
    valueSet: string;
    valueSetSpan: Span;
    strength?: (typeof STRENGTHS)[number];
    strengthSpan?: Span;
  };
}

interface FshEntity {
  kind: (typeof ENTITY_KEYWORDS)[number];
  name: string;
  declStart: number;
  declEnd: number; // end of declaration line
  bodyEnd: number; // offset where this entity's text ends
  header: Record<string, string>;
  rules: FshRule[];
}

/**
 * Strip a trailing `//` line comment, returning the safe length to scan.
 * Skips `://` so URLs (e.g. canonical value sets / extensions) are not mistaken
 * for the start of a comment.
 */
function contentLength(line: string): number {
  let from = 0;
  for (;;) {
    const i = line.indexOf("//", from);
    if (i === -1) return line.length;
    if (i > 0 && line[i - 1] === ":") {
      from = i + 2;
      continue;
    }
    return i;
  }
}

/** Parse the body of a `contains` rule (the text after the `contains` keyword). */
function parseContains(body: string): SliceItem[] {
  return body
    .split(/\band\b/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): SliceItem | null => {
      // <item> [named <name>] [min..max] [flags...]
      const named = /^(\S+)\s+named\s+(\S+)(.*)$/.exec(part);
      let item: string;
      let name: string | undefined;
      let tail: string;
      if (named) {
        item = named[1];
        name = named[2];
        tail = named[3];
      } else {
        const m = /^(\S+)(.*)$/.exec(part);
        if (!m) return null;
        item = m[1];
        tail = m[2];
      }
      const card = CARD_RE.exec(tail);
      return {
        item,
        named: name,
        min: card ? Number(card[1]) : undefined,
        max: card ? card[2] : undefined,
      };
    })
    .filter((x): x is SliceItem => x !== null);
}

function parseRule(line: string, lineStart: number): FshRule | null {
  const safeLen = contentLength(line);
  const content = line.slice(0, safeLen);
  // Match: optional ws, '*', ws, path token
  const m = /^(\s*)\*\s+(\S+)(.*)$/.exec(content);
  if (!m) return null;
  const pathStart = lineStart + m[1].length + 1 /* '*' */;
  // Recompute exact path offset by finding it after the '*'
  const afterStar = m[1].length + 1;
  const wsLen = content.slice(afterStar).match(/^\s*/)![0].length;
  const pStart = lineStart + afterStar + wsLen;
  const path = m[2];
  const rest = content.slice(afterStar + wsLen + path.length);
  const restStart = pStart + path.length;

  const rule: FshRule = {
    path,
    lineStart,
    lineEnd: lineStart + safeLen,
    rest,
    pathSpan: { start: pStart, end: pStart + path.length },
  };

  const containsMatch = /\bcontains\b/.exec(rest);
  if (containsMatch) {
    // A slicing/extension rule — cards here belong to the slices, not the path.
    rule.contains = parseContains(rest.slice(containsMatch.index + "contains".length));
    return rule;
  }

  const card = CARD_RE.exec(rest);
  if (card && card.index >= 0) {
    const cStart = restStart + card.index;
    rule.card = {
      start: cStart,
      end: cStart + card[0].length,
      min: Number(card[1]),
      max: card[2],
    };
  }

  const fromMatch = /\bfrom\s+(\S+)\s*(?:\(\s*(\w+)\s*\))?/.exec(rest);
  if (fromMatch) {
    const clauseStart = restStart + fromMatch.index;
    const vsStart = restStart + rest.indexOf(fromMatch[1], fromMatch.index + 4);
    const strength = STRENGTHS.includes(fromMatch[2] as any)
      ? (fromMatch[2] as (typeof STRENGTHS)[number])
      : undefined;
    rule.binding = {
      span: { start: clauseStart, end: clauseStart + fromMatch[0].length },
      valueSet: fromMatch[1],
      valueSetSpan: { start: vsStart, end: vsStart + fromMatch[1].length },
      strength,
    };
    if (strength) {
      const sIdx = rest.indexOf(fromMatch[2], fromMatch.index);
      rule.binding.strengthSpan = {
        start: restStart + sIdx,
        end: restStart + sIdx + fromMatch[2].length,
      };
    }
  }

  return rule;
}

function parseEntities(text: string): FshEntity[] {
  const entities: FshEntity[] = [];
  const lines = text.split(/(?<=\n)/); // keep line endings
  let offset = 0;
  let current: FshEntity | null = null;

  const closeCurrent = (end: number) => {
    if (current) {
      current.bodyEnd = end;
      entities.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    const lineStart = offset;
    const trimmedEnd = line.replace(/\r?\n$/, "");
    const decl = ENTITY_RE.exec(trimmedEnd);
    if (decl) {
      closeCurrent(lineStart);
      current = {
        kind: decl[1] as FshEntity["kind"],
        name: decl[2].trim(),
        declStart: lineStart,
        declEnd: lineStart + trimmedEnd.length,
        bodyEnd: lineStart + line.length,
        header: {},
        rules: [],
      };
    } else if (current) {
      const ruleMatch = /^\s*\*/.test(trimmedEnd);
      if (ruleMatch) {
        const rule = parseRule(trimmedEnd, lineStart);
        if (rule) current.rules.push(rule);
      } else {
        const kv = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(trimmedEnd);
        if (kv) current.header[kv[1]] = kv[2].trim().replace(/^"|"$/g, "");
      }
      current.bodyEnd = lineStart + line.length;
    }
    offset += line.length;
  }
  closeCurrent(offset);
  return entities;
}

function stripQuotes(v: string | undefined): string | undefined {
  return v?.replace(/^"|"$/g, "");
}

export const fshAdapter: Adapter = {
  language: "fsh",
  extensions: [".fsh"],

  describe(src: LoadedSource): Artifact | null {
    const entities = parseEntities(src.text);
    // Prefer a definitional entity; ignore Alias/RuleSet-only files.
    const primary =
      entities.find((e) => e.kind === "Profile") ??
      entities.find((e) => e.kind === "Extension") ??
      entities.find((e) => e.kind !== "Alias" && e.kind !== "RuleSet");
    if (!primary) return null;
    // An Instance's resourceType comes from its InstanceOf header.
    const resourceType =
      primary.kind === "Extension"
        ? "StructureDefinition"
        : primary.kind === "Instance"
          ? (primary.header.InstanceOf ?? "Instance")
          : mapKindToResourceType(primary.kind);
    const sdType = primary.kind === "Extension" ? "Extension" : undefined;
    const c = classify(resourceType, { sdType });
    return {
      id: src.id,
      filePath: src.filePath,
      language: "fsh",
      format: "fsh",
      resourceType,
      name: instanceName(primary, src.text) ?? primary.name,
      title: stripQuotes(primary.header.Title),
      url: undefined,
      ...c,
    };
  },

  toProfileView(src: LoadedSource, artifact: Artifact): ProfileView | null {
    const entities = parseEntities(src.text);
    const profile = entities.find((e) => e.kind === "Profile" || e.kind === "Extension");
    if (!profile) return null;

    // Aggregate rules per path (and per slice) into element rows.
    const type = profile.header.Parent ?? "?";
    const byKey = new Map<string, ElementView>();
    const order: string[] = [];
    const rowFor = (key: string, path: string, init?: Partial<ElementView>) => {
      let row = byKey.get(key);
      if (!row) {
        row = { id: path, path, inDifferential: true, ...init };
        byKey.set(key, row);
        order.push(key);
      }
      return row;
    };

    for (const rule of profile.rules) {
      const path = `${type}.${rule.path}`;

      if (rule.contains) {
        // Slicing/extension rule. Ensure the sliced base element has a row.
        const base = rowFor(rule.path, path);
        const isExtension = rule.path === "extension" || rule.path.endsWith(".extension");
        for (const slice of rule.contains) {
          const sliceName = slice.named ?? slice.item;
          const sliceRow = rowFor(`${rule.path}:${sliceName}`, path, {
            sliceName,
            min: slice.min,
            max: slice.max,
            extensionUrl: isExtension ? slice.item : undefined,
          });
          sliceRow.id = `${path}:${sliceName}`;
        }
        base.slicing = base.slicing ?? { rules: "open" };
        continue;
      }

      const row = rowFor(rule.path, path);
      if (rule.card) {
        row.min = rule.card.min;
        row.max = rule.card.max;
      }
      if (rule.binding) {
        row.binding = {
          valueSet: rule.binding.valueSet,
          strength: rule.binding.strength,
        };
      }
      if (FLAG_RES.mustSupport.test(rule.rest)) row.mustSupport = true;
      if (FLAG_RES.isSummary.test(rule.rest)) row.isSummary = true;
      if (FLAG_RES.isModifier.test(rule.rest)) row.isModifier = true;
    }

    return {
      artifactId: artifact.id,
      name: profile.name,
      title: stripQuotes(profile.header.Title),
      type: profile.header.Parent ?? "",
      baseDefinition: profile.header.Parent,
      derivation: "constraint",
      url: undefined,
      elements: order.map((k) => byKey.get(k)!),
    };
  },

  computeChanges(src: LoadedSource, edits: Edit[]): TextChange[] {
    // Generic value edits address an Instance's assignment rules.
    const GENERIC = new Set(["setValue", "addValue", "removeValue"]);
    if (edits.some((e) => GENERIC.has(e.kind))) {
      let working = src.text;
      const descs: string[] = [];
      for (const edit of edits) {
        if (!GENERIC.has(edit.kind)) continue;
        const r = applyInstanceEdit(working, edit);
        working = r.text;
        if (r.desc) descs.push(r.desc);
      }
      return collapseToOriginal(src.text, working, descs);
    }

    let working = src.text;
    const out: TextChange[] = [];

    for (const edit of edits) {
      const entities = parseEntities(working);
      const profile = entities.find((e) => e.kind === "Profile" || e.kind === "Extension");
      if (!profile) continue;
      const type = profile.header.Parent ?? "";
      // Edit.path is the fully-qualified path (Type or Type.element). FSH rules
      // use the element path relative to the resource, so strip the type prefix.
      let relPath: string;
      if (edit.path === type) relPath = "";
      else if (edit.path.startsWith(type + ".")) relPath = edit.path.slice(type.length + 1);
      else if (edit.path.includes(".")) relPath = edit.path.slice(edit.path.indexOf(".") + 1);
      else relPath = edit.path;
      // FSH addresses slices with [name] notation, not the id's ":name".
      relPath = relPath.replace(/:([A-Za-z0-9_-]+)/g, "[$1]");

      const change = computeRuleChange(working, profile, relPath, edit);
      if (change) {
        out.push(change);
        working = working.slice(0, change.start) + change.newText + working.slice(change.end);
      }
    }
    return out;
  },
};

function computeRuleChange(
  text: string,
  profile: FshEntity,
  relPath: string,
  edit: Edit,
): TextChange | null {
  const rulesForPath = profile.rules.filter((r) => r.path === relPath);

  if (edit.kind === "setCardinality") {
    const withCard = rulesForPath.find((r) => r.card);
    if (withCard?.card) {
      return {
        start: withCard.card.start,
        end: withCard.card.end,
        newText: `${edit.min}..${edit.max}`,
        description: `${edit.path} cardinality → ${edit.min}..${edit.max}`,
      };
    }
    const bare = rulesForPath[0];
    if (bare) {
      // Insert card right after the path token.
      return {
        start: bare.pathSpan.end,
        end: bare.pathSpan.end,
        newText: ` ${edit.min}..${edit.max}`,
        description: `${edit.path} cardinality → ${edit.min}..${edit.max}`,
      };
    }
    return appendRule(profile, `* ${relPath} ${edit.min}..${edit.max}`, edit.path,
      `cardinality → ${edit.min}..${edit.max}`);
  }

  if (edit.kind === "setBinding") {
    const withBinding = rulesForPath.find((r) => r.binding);
    if (withBinding?.binding) {
      const b = withBinding.binding;
      return {
        start: b.span.start,
        end: b.span.end,
        newText: `from ${edit.valueSet} (${edit.strength})`,
        description: `${edit.path} binding → ${edit.valueSet} (${edit.strength})`,
      };
    }
    return appendRule(profile, `* ${relPath} from ${edit.valueSet} (${edit.strength})`,
      edit.path, `binding → ${edit.valueSet} (${edit.strength})`);
  }

  if (edit.kind === "setFlag") {
    const token = FLAG_TOKENS[edit.flag];
    const re = FLAG_RES[edit.flag];
    const rules = rulesForPath.filter((r) => !r.contains);
    const flagRule = rules.find((r) => re.test(r.rest));
    if (edit.value) {
      if (flagRule) return null; // flag already present
      // Prefer the cardinality rule; avoid appending onto a `from` binding rule.
      const target = rules.find((r) => r.card) ?? rules.find((r) => !r.binding);
      if (target) {
        return {
          start: target.lineEnd,
          end: target.lineEnd,
          newText: ` ${token}`,
          description: `${edit.path} ${edit.flag} → true`,
        };
      }
      return appendRule(profile, `* ${relPath} ${token}`, edit.path, `${edit.flag} → true`);
    }
    // Clearing: delete the flag token (with a surrounding space) from its rule.
    if (!flagRule) return null;
    const m = re.exec(flagRule.rest);
    if (!m) return null;
    const tokenStart = flagRule.pathSpan.end + m.index;
    const removeStart = m.index > 0 ? tokenStart - 1 : tokenStart;
    return {
      start: removeStart,
      end: tokenStart + token.length,
      newText: "",
      description: `${edit.path} ${edit.flag} → false`,
    };
  }

  if (edit.kind === "addSlice") {
    const item = `${edit.sliceName} ${edit.min}..${edit.max}`;
    const existing = rulesForPath.find((r) => r.contains);
    if (existing) {
      return {
        start: existing.lineEnd,
        end: existing.lineEnd,
        newText: ` and ${item}`,
        description: `${edit.path} slice + ${edit.sliceName}`,
      };
    }
    const lines: string[] = [];
    if (edit.discriminator && !rulesForPath.some((r) => /\^slicing/.test(r.rest))) {
      lines.push(`* ${relPath} ^slicing.discriminator[0].type = #${edit.discriminator.type}`);
      lines.push(`* ${relPath} ^slicing.discriminator[0].path = "${edit.discriminator.path}"`);
      lines.push(`* ${relPath} ^slicing.rules = #open`);
    }
    lines.push(`* ${relPath} contains ${item}`);
    return appendRule(profile, lines.join("\n"), edit.path, `slice + ${edit.sliceName}`);
  }

  if (edit.kind === "addExtension") {
    const extPath = relPath ? `${relPath}.extension` : "extension";
    const ref = edit.extensionName ?? edit.extensionUrl;
    const item = `${ref} named ${edit.sliceName} ${edit.min}..${edit.max}`;
    const existing = profile.rules.find((r) => r.path === extPath && r.contains);
    if (existing) {
      return {
        start: existing.lineEnd,
        end: existing.lineEnd,
        newText: ` and ${item}`,
        description: `${extPath} + extension ${edit.sliceName}`,
      };
    }
    return appendRule(profile, `* ${extPath} contains ${item}`, extPath,
      `+ extension ${edit.sliceName}`);
  }
  return null;
}

/** Append a new rule line at the end of the profile body. */
function appendRule(
  profile: FshEntity,
  ruleText: string,
  fullPath: string,
  desc: string,
): TextChange {
  // Insert after the last rule line, or after the declaration/header block.
  const lastRule = profile.rules[profile.rules.length - 1];
  const anchor = lastRule ? lastRule.lineEnd : profile.declEnd;
  return {
    start: anchor,
    end: anchor,
    newText: `\n${ruleText}`,
    description: `${fullPath} ${desc}`,
  };
}

function mapKindToResourceType(kind: string): string {
  switch (kind) {
    case "Profile":
    case "Extension":
    case "Logical":
    case "Resource":
      return "StructureDefinition";
    case "Instance":
      return "Instance";
    default:
      return kind;
  }
}

/* ------------------------------------------------------------------ *
 * FSH Instance support — conformance resources (SearchParameter,
 * CapabilityStatement, …) are written as `Instance:` definitions whose
 * `* path = value` assignment rules use the same `[n]` path syntax as the
 * generic edit engine. We read them into an object and edit the rules.
 * ------------------------------------------------------------------ */

/** Leaf names whose FSH value is a code (`#x`) rather than a string. */
const CODE_LEAVES = new Set([
  "status",
  "code",
  "type",
  "mode",
  "base",
  "target",
  "valueCode",
  "kind",
  "fhirVersion",
  "format",
  "referencePolicy",
  "use",
  "gender",
]);

interface FshAssignment {
  path: string;
  valueStart: number;
  valueEnd: number;
  rawValue: string;
}

/** Interpret a rule as an assignment (`* path = value`), with value offsets. */
function asAssignment(rule: FshRule, text: string): FshAssignment | null {
  const m = /^\s*=\s*/.exec(rule.rest);
  if (!m) return null;
  const valueStart = rule.pathSpan.end + m[0].length;
  const raw = text.slice(valueStart, rule.lineEnd).replace(/\s+$/, "");
  return { path: rule.path, valueStart, valueEnd: valueStart + raw.length, rawValue: raw };
}

/** The `* name =` rule value if present, else the declared instance id. */
function instanceName(entity: FshEntity, text: string): string | undefined {
  if (entity.kind !== "Instance") return undefined;
  for (const rule of entity.rules) {
    if (rule.path !== "name") continue;
    const a = asAssignment(rule, text);
    if (a) return parseFshValue(a.rawValue) as string;
  }
  return entity.name;
}

function leafOf(path: string): string {
  const noIdx = path.replace(/\[\d+\]$/, "");
  const dot = noIdx.lastIndexOf(".");
  return (dot === -1 ? noIdx : noIdx.slice(dot + 1)).replace(/\[\d+\]/g, "");
}

function parseFshValue(raw: string): unknown {
  const v = raw.trim();
  if (v.startsWith("#")) {
    let c = v.slice(1);
    if (c.startsWith('"')) c = c.slice(1, c.lastIndexOf('"'));
    return c;
  }
  if (v.startsWith('"')) return v.slice(1, v.lastIndexOf('"')).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  const wrapped = /^(?:Canonical|Reference)\((.*)\)$/.exec(v);
  if (wrapped) return wrapped[1];
  return v;
}

function serializeFshValue(leaf: string, value: unknown, existingRaw?: string): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  const s = String(value);
  const asCode =
    existingRaw !== undefined ? existingRaw.trim().startsWith("#") : CODE_LEAVES.has(leaf);
  if (asCode) return /^[^\s"]+$/.test(s) ? `#${s}` : `#"${s}"`;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function setNested(obj: any, segs: (string | number)[], value: unknown): void {
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const wantArray = typeof segs[i + 1] === "number";
    if (cur[seg] === undefined) cur[seg] = wantArray ? [] : {};
    cur = cur[seg];
  }
  cur[segs[segs.length - 1]] = value;
}

/**
 * Resolve FSH soft array indices (`[+]` next, `[=]` current) in a path to
 * concrete numbers, using a running counter keyed by each array's resolved
 * prefix. Explicit numeric indices set the counter so later `[+]`/`[=]` follow.
 * Must be called over a file's assignment rules in document order.
 */
function resolveSoftPath(path: string, counters: Map<string, number>): string {
  let prefix = "";
  const out: string[] = [];
  for (const seg of path.split(".")) {
    const m = /^([^[]+)(\[.+\])?$/.exec(seg);
    if (!m) {
      out.push(seg);
      prefix = prefix ? `${prefix}.${seg}` : seg;
      continue;
    }
    const name = m[1];
    let outSeg = name;
    if (m[2]) {
      const inner = m[2].slice(1, -1);
      const key = prefix ? `${prefix}.${name}` : name;
      if (inner === "+") {
        const idx = (counters.get(key) ?? -1) + 1;
        counters.set(key, idx);
        outSeg = `${name}[${idx}]`;
      } else if (inner === "=") {
        outSeg = `${name}[${counters.get(key) ?? 0}]`;
      } else if (/^\d+$/.test(inner)) {
        counters.set(key, Number(inner));
        outSeg = `${name}[${inner}]`;
      } else {
        outSeg = seg; // slice name or other — leave as-is
      }
    }
    prefix = prefix ? `${prefix}.${outSeg}` : outSeg;
    out.push(outSeg);
  }
  return out.join(".");
}

/** Normalize a FSH Instance into a FHIR-JSON-ish object. */
export function instanceToObject(text: string): any {
  const inst = parseEntities(text).find((e) => e.kind === "Instance");
  if (!inst) return null;
  const obj: any = {};
  if (inst.header.InstanceOf) obj.resourceType = inst.header.InstanceOf;
  obj.id = inst.name;
  const counters = new Map<string, number>();
  for (const rule of inst.rules) {
    const a = asAssignment(rule, text);
    if (!a) continue;
    setNested(obj, parsePath(resolveSoftPath(a.path, counters)), parseFshValue(a.rawValue));
  }
  return obj;
}

/** Flatten an added object into [relativePath, primitive] pairs. */
function flattenValue(value: unknown, prefix = ""): [string, unknown][] {
  if (value === null || value === undefined || typeof value !== "object") {
    return [[prefix, value]];
  }
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      v.forEach((item, i) => out.push(...flattenValue(item, prefix ? `${prefix}.${k}[${i}]` : `${k}[${i}]`)));
    } else {
      out.push(...flattenValue(v, prefix ? `${prefix}.${k}` : k));
    }
  }
  return out;
}

interface ResolvedAssign {
  rule: FshRule;
  a: FshAssignment;
  /** Path with soft indices resolved to concrete numbers. */
  rp: string;
}

function instanceRules(text: string): { inst: FshEntity; assigns: ResolvedAssign[] } | null {
  const inst = parseEntities(text).find((e) => e.kind === "Instance");
  if (!inst) return null;
  const counters = new Map<string, number>();
  const assigns: ResolvedAssign[] = [];
  for (const rule of inst.rules) {
    const a = asAssignment(rule, text);
    if (!a) continue;
    assigns.push({ rule, a, rp: resolveSoftPath(a.path, counters) });
  }
  return { inst, assigns };
}

function lastInstanceAnchor(inst: FshEntity): number {
  const last = inst.rules[inst.rules.length - 1];
  return last ? last.lineEnd : inst.declEnd;
}

function arrayCount(assigns: ResolvedAssign[], arrPath: string): number {
  const re = new RegExp(`^${arrPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\[(\\d+)\\]`);
  let max = -1;
  for (const { rp } of assigns) {
    const m = re.exec(rp);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Apply a single generic value edit to an Instance, returning new text. */
function applyInstanceEdit(text: string, edit: Edit): { text: string; desc: string } {
  const parsed = instanceRules(text);
  if (!parsed) return { text, desc: "" };
  const { inst, assigns } = parsed;

  if (edit.kind === "setValue") {
    if (edit.value === null) return applyInstanceEdit(text, { ...edit, kind: "removeValue" } as Edit);
    const found = assigns.find((x) => x.rp === edit.path);
    const leaf = leafOf(edit.path);
    if (found) {
      const v = serializeFshValue(leaf, edit.value, found.a.rawValue);
      return { text: splice(text, found.a.valueStart, found.a.valueEnd, v), desc: `${edit.path} = ${edit.value}` };
    }
    const anchor = lastInstanceAnchor(inst);
    const rule = `\n* ${edit.path} = ${serializeFshValue(leaf, edit.value)}`;
    return { text: splice(text, anchor, anchor, rule), desc: `${edit.path} = ${edit.value}` };
  }

  if (edit.kind === "addValue") {
    const n = arrayCount(assigns, edit.path);
    const flat = flattenValue(edit.value);
    const lines = flat.map(([sub, val]) => {
      const path = sub ? `${edit.path}[${n}].${sub}` : `${edit.path}[${n}]`;
      return `* ${path} = ${serializeFshValue(leafOf(path), val)}`;
    });
    const anchor = lastInstanceAnchor(inst);
    return { text: splice(text, anchor, anchor, "\n" + lines.join("\n")), desc: `${edit.path} + item` };
  }

  if (edit.kind === "removeValue") {
    const removePath = edit.path;
    const m = /^(.*)\[(\d+)\]$/.exec(removePath);
    const arrayPrefix = m ? m[1] : undefined;
    const removedIdx = m ? Number(m[2]) : undefined;
    const edits: { start: number; end: number; newText: string }[] = [];

    for (const { rule, a, rp } of assigns) {
      // Match the target by resolved path (so soft-indexed source still matches).
      const isTarget =
        rp === removePath || rp.startsWith(removePath + ".") || rp.startsWith(removePath + "[");
      if (isTarget) {
        const nl = text.indexOf("\n", rule.lineStart);
        edits.push({ start: rule.lineStart, end: nl === -1 ? text.length : nl + 1, newText: "" });
        continue;
      }
      // Re-index sibling array elements after the removed one. Only rewrite raw
      // numeric indices; soft `[+]`/`[=]` siblings renumber themselves.
      if (arrayPrefix !== undefined && removedIdx !== undefined) {
        const sibR = new RegExp(`^${arrayPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\[(\\d+)\\]`).exec(rp);
        const sibRaw = new RegExp(`^${arrayPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\[(\\d+)\\]`).exec(a.path);
        if (sibR && sibRaw && Number(sibR[1]) > removedIdx) {
          const k = Number(sibRaw[1]);
          const newPath = `${arrayPrefix}[${k - 1}]` + a.path.slice(`${arrayPrefix}[${k}]`.length);
          edits.push({ start: rule.pathSpan.start, end: rule.pathSpan.end, newText: newPath });
        }
      }
    }
    let out = text;
    for (const e of edits.sort((x, y) => y.start - x.start)) {
      out = out.slice(0, e.start) + e.newText + out.slice(e.end);
    }
    return { text: out, desc: `remove ${edit.path}` };
  }

  return { text, desc: "" };
}

function splice(text: string, start: number, end: number, newText: string): string {
  return text.slice(0, start) + newText + text.slice(end);
}
