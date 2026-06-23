import type {
  Artifact,
  Edit,
  ProfileView,
  SourceLanguage,
  TextChange,
} from "@igb/shared";

/** A source file loaded from disk, before/independent of FHIR projection. */
export interface LoadedSource {
  id: string;
  filePath: string;
  language: SourceLanguage;
  text: string;
  /** Pre-resolved base type snapshot elements (JSON) for profiles that lack their own snapshot. */
  baseSnapshotJson?: any[];
}

/**
 * A source-language adapter. Each adapter knows how to:
 *  - recognise its files,
 *  - read the FHIR metadata needed for the {@link Artifact} summary,
 *  - project a StructureDefinition into a {@link ProfileView},
 *  - translate {@link Edit}s into format-preserving {@link TextChange}s.
 */
export interface Adapter {
  language: SourceLanguage;
  /** File extensions handled, lower-case incl. dot, e.g. [".json"]. */
  extensions: string[];

  /** Parse just enough to build an artifact summary. Returns null if not FHIR. */
  describe(src: LoadedSource): Artifact | null;

  /** Project a StructureDefinition source into the editable profile view. */
  toProfileView(src: LoadedSource, artifact: Artifact): ProfileView | null;

  /**
   * Compute the minimal text changes that apply `edits` to `src.text`.
   * Must preserve all surrounding formatting, comments and ordering.
   */
  computeChanges(src: LoadedSource, edits: Edit[]): TextChange[];
}

/** Apply a set of changes to text. Changes are sorted and applied right-to-left. */
export function applyChanges(text: string, changes: TextChange[]): string {
  const sorted = [...changes].sort((a, b) => b.start - a.start);
  let out = text;
  for (const c of sorted) {
    out = out.slice(0, c.start) + c.newText + out.slice(c.end);
  }
  return out;
}

/**
 * Given the original text and a fully-edited working copy, produce a single
 * minimal {@link TextChange} by trimming the common prefix and suffix. This
 * lets adapters apply edits against successive working copies (simple) while
 * still reporting one clean, offset-correct, format-preserving splice.
 */
export function collapseToOriginal(
  original: string,
  final: string,
  descriptions: string[] = [],
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
  return [
    {
      start,
      end: endO,
      newText: final.slice(start, endF),
      description: [...new Set(descriptions.filter(Boolean))].join("; "),
    },
  ];
}
