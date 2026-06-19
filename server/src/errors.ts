import type { Response } from "express";

/** Map a thrown error (Node fs errors, JSON parse, etc.) to a human message. */
export function friendlyMessage(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { message?: string };
  const code = e?.code;
  const target = e?.path ? `: ${e.path}` : "";
  switch (code) {
    case "ENOENT":
      return `Not found${target}. Check the path is correct and exists.`;
    case "EACCES":
    case "EPERM":
      return `Permission denied${target}. The file or folder can't be accessed.`;
    case "EISDIR":
      return `Expected a file but found a directory${target}.`;
    case "ENOTDIR":
      return `Expected a directory but found a file${target}.`;
    case "EBUSY":
      return `The file is in use by another program${target}.`;
    case "ENOSPC":
      return "No space left on disk.";
    default:
      break;
  }
  if (e instanceof SyntaxError) return `Invalid JSON: ${e.message}`;
  const msg = e?.message ?? String(err);
  // Strip a leading "Error: " that String(err) tends to add.
  return msg.replace(/^Error:\s*/, "");
}

/** Send a JSON error response with a friendly message. */
export function sendErr(res: Response, status: number, err: unknown): void {
  res.status(status).json({ error: friendlyMessage(err) });
}
