import { useEffect, useMemo, useRef, useState } from "react";
import type { Artifact } from "@igb/shared";
import { getFile, saveFile } from "./api.js";
import { LayoutList } from "lucide-react";

/* ── Comment range finder ─────────────────────────────────────── */

/** Finds [start, end) byte ranges of all comments in `text` for a given format. */
function findCommentRanges(text: string, format: string): [number, number][] {
  if (format === "xml") {
    const ranges: [number, number][] = [];
    const re = /<!--[\s\S]*?-->/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) ranges.push([m.index, m.index + m[0].length]);
    return ranges;
  }

  if (format === "json" || format === "fsh") {
    const ranges: [number, number][] = [];
    let i = 0;
    let inString = false;
    while (i < text.length) {
      const c = text[i];
      if (inString) {
        if (c === "\\" && i + 1 < text.length) { i += 2; continue; }
        if (c === '"') inString = false;
        i++;
        continue;
      }
      if (c === '"') { inString = true; i++; continue; }
      if (c === "/" && i + 1 < text.length) {
        if (text[i + 1] === "/") {
          const start = i;
          while (i < text.length && text[i] !== "\n") i++;
          ranges.push([start, i]);
          continue;
        }
        if (text[i + 1] === "*") {
          const start = i;
          i += 2;
          while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) i++;
          if (i < text.length - 1) i += 2;
          ranges.push([start, i]);
          continue;
        }
      }
      i++;
    }
    return ranges;
  }

  return [];
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Returns HTML with comment spans injected; everything else is HTML-escaped. */
function highlightComments(text: string, format: string): string {
  const ranges = findCommentRanges(text, format);
  if (ranges.length === 0) return escHtml(text);
  let result = "";
  let pos = 0;
  for (const [start, end] of ranges) {
    result += escHtml(text.slice(pos, start));
    result += `<span class="hl-comment">${escHtml(text.slice(start, end))}</span>`;
    pos = end;
  }
  result += escHtml(text.slice(pos));
  return result;
}

/* ── Highlighted editor (pre + textarea overlay) ─────────────── */

function HighlightedEditor({
  text,
  format,
  onChange,
}: {
  text: string;
  format: string;
  onChange: (s: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const isWrap = format === "markdown";

  const highlighted = useMemo(() => highlightComments(text, format), [text, format]);

  function syncScroll() {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }

  return (
    <div className={"hl-wrap" + (isWrap ? " hl-wrap-soft" : "")}>
      <pre
        ref={preRef}
        className="hl-pre"
        aria-hidden="true"
        // trailing \n prevents height mismatch on last-line edits
        dangerouslySetInnerHTML={{ __html: highlighted + "\n" }}
      />
      <textarea
        ref={taRef}
        className="hl-ta"
        value={text}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
      />
    </div>
  );
}

/* ── Raw source editor ────────────────────────────────────────── */

export function TextEditor({
  artifact,
  onSaved,
  onError,
  onBackToStructured,
}: {
  artifact: Artifact;
  onSaved: () => void;
  onError: (msg: string) => void;
  onBackToStructured?: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setText(null);
    getFile(artifact.id)
      .then((r) => {
        if (!live) return;
        setText(r.text);
        setOriginal(r.text);
      })
      .catch((e) => onError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id]);

  const dirty = text !== null && text !== original;

  async function save() {
    if (text === null) return;
    setBusy(true);
    try {
      await saveFile(artifact.id, text);
      setOriginal(text);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="profile-head">
        <h2>{artifact.name}</h2>
        <div className="sub">
          {artifact.id} · {artifact.format}
        </div>
        {onBackToStructured && (
          <div className="head-actions">
            <button onClick={onBackToStructured} title="Return to the structured editor view">
              <LayoutList size={13} /> Structured editor
            </button>
          </div>
        )}
      </div>

      {text === null ? (
        <div className="empty">Loading…</div>
      ) : (
        <HighlightedEditor
          text={text}
          format={artifact.format}
          onChange={setText}
        />
      )}

      {dirty && (
        <div className="pending-bar">
          <span className="count">unsaved changes</span>
          <span className="spacer" />
          <button onClick={() => setText(original)} disabled={busy} title="Discard edits and revert to the last saved version">
            Revert
          </button>
          <button className="primary" onClick={save} disabled={busy} title="Write changes to disk">
            Save file
          </button>
        </div>
      )}
    </>
  );
}
