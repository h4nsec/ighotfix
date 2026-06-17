import type {
  Artifact,
  Edit,
  ElementBinding,
  ElementView,
  ProfileView,
  TextChange,
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

interface Span {
  start: number;
  end: number;
}

interface FshRule {
  path: string;
  /** Offset of the line start. */
  lineStart: number;
  /** Offset just past the line content (before newline). */
  lineEnd: number;
  /** Span of the `min..max` token, if present. */
  card?: Span & { min: number; max: string };
  /** Span of the path token. */
  pathSpan: Span;
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

/** Strip a trailing `//` line comment, returning the safe length to scan. */
function contentLength(line: string): number {
  const i = line.indexOf("//");
  return i === -1 ? line.length : i;
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
  const rule: FshRule = {
    path,
    lineStart,
    lineEnd: lineStart + safeLen,
    pathSpan: { start: pStart, end: pStart + path.length },
  };

  const rest = content.slice(afterStar + wsLen + path.length);
  const restStart = pStart + path.length;

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
    const profile = entities.find((e) => e.kind === "Profile");
    const any = profile ?? entities[0];
    if (!any) return null;
    const resourceType = profile
      ? "StructureDefinition"
      : mapKindToResourceType(any.kind);
    return {
      id: src.id,
      filePath: src.filePath,
      language: "fsh",
      resourceType,
      name: profile?.name ?? any.name,
      url: undefined,
      supported: !!profile,
    };
  },

  toProfileView(src: LoadedSource, artifact: Artifact): ProfileView | null {
    const entities = parseEntities(src.text);
    const profile = entities.find((e) => e.kind === "Profile");
    if (!profile) return null;

    // Aggregate rules per path into element rows.
    const byPath = new Map<string, ElementView>();
    const order: string[] = [];
    for (const rule of profile.rules) {
      const path = `${profile.header.Parent ?? "?"}.${rule.path}`;
      let row = byPath.get(rule.path);
      if (!row) {
        row = { id: path, path, inDifferential: true };
        byPath.set(rule.path, row);
        order.push(rule.path);
      }
      if (rule.card) {
        row.min = rule.card.min;
        row.max = rule.card.max;
      }
      if (rule.binding) {
        const binding: ElementBinding = {
          valueSet: rule.binding.valueSet,
          strength: rule.binding.strength,
        };
        row.binding = binding;
      }
    }

    return {
      artifactId: artifact.id,
      name: profile.name,
      title: stripQuotes(profile.header.Title),
      type: profile.header.Parent ?? "",
      baseDefinition: profile.header.Parent,
      derivation: "constraint",
      url: undefined,
      elements: order.map((p) => byPath.get(p)!),
    };
  },

  computeChanges(src: LoadedSource, edits: Edit[]): TextChange[] {
    let working = src.text;
    const out: TextChange[] = [];

    for (const edit of edits) {
      const entities = parseEntities(working);
      const profile = entities.find((e) => e.kind === "Profile");
      if (!profile) continue;
      // Edit.path is the fully-qualified path (Type.element). FSH rules use the
      // element path relative to the resource, so strip the leading type.
      const relPath = edit.path.includes(".")
        ? edit.path.slice(edit.path.indexOf(".") + 1)
        : edit.path;

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
