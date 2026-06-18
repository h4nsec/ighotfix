import {
  classify,
  type Artifact,
  type Edit,
  type ElementBinding,
  type ElementFlag,
  type ElementView,
  type ProfileView,
  type TextChange,
} from "@igb/shared";
import type { Adapter, LoadedSource } from "./types.js";

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
    const resourceType =
      primary.kind === "Extension" ? "StructureDefinition" : mapKindToResourceType(primary.kind);
    const sdType = primary.kind === "Extension" ? "Extension" : undefined;
    const c = classify(resourceType, { sdType });
    return {
      id: src.id,
      filePath: src.filePath,
      language: "fsh",
      resourceType,
      name: primary.name,
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
