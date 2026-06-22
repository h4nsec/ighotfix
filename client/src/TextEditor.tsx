import { useEffect, useState } from "react";
import type { Artifact } from "@igb/shared";
import { getFile, saveFile } from "./api.js";

/** Raw source editor for any file — config, pages, or FHIR source. */
export function TextEditor({
  artifact,
  onSaved,
  onError,
}: {
  artifact: Artifact;
  onSaved: () => void;
  onError: (msg: string) => void;
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
    return () => {
      live = false;
    };
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
      </div>

      {text === null ? (
        <div className="empty">Loading…</div>
      ) : (
        <textarea
          className={"file-editor" + (artifact.format === "markdown" ? " wrap" : "")}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}

      {dirty && (
        <div className="pending-bar">
          <span className="count">unsaved changes</span>
          <span className="spacer" />
          <button onClick={() => setText(original)} disabled={busy}>
            Revert
          </button>
          <button className="primary" onClick={save} disabled={busy}>
            Save file
          </button>
        </div>
      )}
    </>
  );
}
