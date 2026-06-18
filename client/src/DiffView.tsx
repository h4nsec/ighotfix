/** Render a unified git diff with per-line colouring. */
export function DiffView({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <pre className="diff-view">
      {lines.map((line, i) => {
        let cls = "diff-ctx";
        if (line.startsWith("+++") || line.startsWith("---")) cls = "diff-file";
        else if (line.startsWith("diff ") || line.startsWith("index ")) cls = "diff-file";
        else if (line.startsWith("@@")) cls = "diff-hunk";
        else if (line.startsWith("+")) cls = "diff-add";
        else if (line.startsWith("-")) cls = "diff-del";
        return (
          <span key={i} className={"diff-line " + cls}>
            {line || " "}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}
