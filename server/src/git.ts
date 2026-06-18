import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run a git command in `root`. Never throws; returns captured output + code. */
async function git(root: string, args: string[], timeout = 30_000): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileP("git", args, {
      cwd: root,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      // Never block on an interactive credential/passphrase prompt.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      windowsHide: true,
    });
    return { stdout, stderr, code: 0 };
  } catch (e: any) {
    return {
      stdout: e?.stdout ?? "",
      stderr: e?.stderr ?? (e?.message ?? String(e)),
      code: typeof e?.code === "number" ? e.code : 1,
    };
  }
}

export interface GitFile {
  path: string;
  /** Two-letter porcelain status code, e.g. " M", "??", "A ". */
  code: string;
  staged: boolean;
  label: string;
}

export interface GitStatus {
  isRepo: boolean;
  root?: string;
  branch?: string;
  ahead?: number;
  behind?: number;
  hasRemote?: boolean;
  clean?: boolean;
  files?: GitFile[];
  detached?: boolean;
  /** True when git itself is unavailable. */
  gitMissing?: boolean;
}

export async function isRepo(root: string): Promise<boolean> {
  const r = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  return r.code === 0 && r.stdout.trim() === "true";
}

const STATUS_LABELS: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "unmerged",
  "?": "untracked",
  "!": "ignored",
};

function labelFor(code: string): string {
  const x = code.trim()[0] ?? "";
  return STATUS_LABELS[x] ?? "changed";
}

export async function status(root: string): Promise<GitStatus> {
  const check = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (check.code !== 0) {
    // Distinguish "git not installed" from "not a repo".
    if (/not recognized|command not found|ENOENT/i.test(check.stderr)) {
      return { isRepo: false, gitMissing: true };
    }
    return { isRepo: false };
  }

  const top = (await git(root, ["rev-parse", "--show-toplevel"])).stdout.trim();
  const r = await git(root, ["status", "--porcelain=v1", "--branch"]);
  const lines = r.stdout.split("\n").filter((l) => l.length > 0);

  let branch = "HEAD";
  let ahead = 0;
  let behind = 0;
  let hasRemote = false;
  let detached = false;

  if (lines[0]?.startsWith("## ")) {
    const rest = lines[0].slice(3);
    const noCommit = /^No commits yet on (.+)$/.exec(rest);
    if (noCommit) {
      branch = noCommit[1].trim();
    } else if (rest.startsWith("HEAD (no branch)")) {
      detached = true;
      branch = "HEAD";
    } else {
      const dots = rest.indexOf("...");
      if (dots >= 0) {
        hasRemote = true;
        branch = rest.slice(0, dots).trim();
        const ab = /\[(.*)\]/.exec(rest);
        if (ab) {
          ahead = Number(/ahead (\d+)/.exec(ab[1])?.[1] ?? 0);
          behind = Number(/behind (\d+)/.exec(ab[1])?.[1] ?? 0);
        }
      } else {
        branch = rest.split(" ")[0].trim();
      }
    }
  }

  const files: GitFile[] = lines.slice(1).map((line) => {
    const code = line.slice(0, 2);
    let path = line.slice(3);
    if (path.includes(" -> ")) path = path.split(" -> ")[1];
    return { path, code, staged: code[0] !== " " && code[0] !== "?", label: labelFor(code) };
  });

  return {
    isRepo: true,
    root: top,
    branch,
    ahead,
    behind,
    hasRemote,
    detached,
    clean: files.length === 0,
    files,
  };
}

export interface GitBranches {
  current: string;
  branches: string[];
}

export async function branches(root: string): Promise<GitBranches> {
  const current = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  const list = (await git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { current, branches: list };
}

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

export async function log(root: string, n = 25): Promise<GitCommit[]> {
  const r = await git(root, [
    "log",
    `-n`,
    String(n),
    "--pretty=format:%H%x1f%an%x1f%ad%x1f%s",
    "--date=short",
  ]);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, subject] = line.split("\x1f");
      return { hash: hash.slice(0, 8), author, date, subject };
    });
}

export async function diff(root: string, file?: string): Promise<string> {
  const args = ["diff", "HEAD"];
  if (file) args.push("--", file);
  const r = await git(root, args);
  return r.stdout || r.stderr;
}

/* ---------------- mutating operations ---------------- */

export interface GitOpResult {
  ok: boolean;
  output: string;
}

function ok(r: GitResult): GitOpResult {
  return { ok: r.code === 0, output: (r.stdout + (r.stderr ? "\n" + r.stderr : "")).trim() };
}

export async function init(root: string): Promise<GitOpResult> {
  // git >= 2.28 supports -b for the initial branch.
  const r = await git(root, ["init", "-b", "main"]);
  if (r.code !== 0) return ok(await git(root, ["init"]));
  return ok(r);
}

const VALID_BRANCH = /^[A-Za-z0-9._/-]+$/;

export async function commit(root: string, message: string): Promise<GitOpResult> {
  if (!message.trim()) return { ok: false, output: "Commit message is required." };
  const add = await git(root, ["add", "-A"]);
  if (add.code !== 0) return ok(add);
  return ok(await git(root, ["commit", "-m", message]));
}

export async function createBranch(
  root: string,
  name: string,
  checkout: boolean,
): Promise<GitOpResult> {
  if (!VALID_BRANCH.test(name)) return { ok: false, output: `Invalid branch name: ${name}` };
  return ok(await git(root, checkout ? ["checkout", "-b", name] : ["branch", name]));
}

export async function checkout(root: string, name: string): Promise<GitOpResult> {
  if (!VALID_BRANCH.test(name)) return { ok: false, output: `Invalid branch name: ${name}` };
  return ok(await git(root, ["checkout", name]));
}

export async function push(root: string): Promise<GitOpResult> {
  return ok(await git(root, ["push"], 60_000));
}

export async function pull(root: string): Promise<GitOpResult> {
  return ok(await git(root, ["pull", "--ff-only"], 60_000));
}
