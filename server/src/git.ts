import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

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
    // Prefer git's stderr, but fall back to the spawn error message when git
    // never ran (e.g. a non-existent cwd produces empty stdout/stderr).
    return {
      stdout: e?.stdout ?? "",
      stderr: e?.stderr || e?.message || String(e),
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
  // Commit whatever is currently staged (selective staging is done separately).
  return ok(await git(root, ["commit", "-m", message]));
}

export async function stage(root: string, paths: string[]): Promise<GitOpResult> {
  if (paths.length === 0) return { ok: true, output: "" };
  return ok(await git(root, ["add", "--", ...paths]));
}

export async function unstage(root: string, paths: string[]): Promise<GitOpResult> {
  if (paths.length === 0) return { ok: true, output: "" };
  // `restore --staged` needs a commit; fall back to removing from the index.
  const r = await git(root, ["restore", "--staged", "--", ...paths]);
  if (r.code === 0) return ok(r);
  return ok(await git(root, ["rm", "--cached", "-q", "--", ...paths]));
}

export async function stageAll(root: string): Promise<GitOpResult> {
  return ok(await git(root, ["add", "-A"]));
}

export async function unstageAll(root: string): Promise<GitOpResult> {
  const r = await git(root, ["reset", "-q"]);
  return ok(r);
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

/** Derive a repo folder name from a clone URL. */
function repoNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  const seg = cleaned.split(/[/:]/).pop() ?? "repo";
  return seg.replace(/[^A-Za-z0-9._-]/g, "-") || "repo";
}

export interface CloneResult extends GitOpResult {
  /** Absolute path of the cloned working tree, when successful. */
  path?: string;
  /** True when the clone was cancelled by the caller. */
  cancelled?: boolean;
}

/** Kill a child process and its descendants (git spawns helper subprocesses). */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
    } catch {
      child.kill();
    }
  } else {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/** Best-effort removal of a partial clone so a retry isn't blocked. */
function removePartial(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    /* leave it; the next clone will report "destination already exists" */
  }
}

/** A clone progress update parsed from git's --progress output. */
export interface CloneProgress {
  /** e.g. "Receiving objects", "Resolving deltas", "Updating files". */
  phase?: string;
  /** 0–100 for the current phase, when git reports it. */
  percent?: number;
  /** The raw progress line. */
  raw: string;
}

/**
 * Clone `url` into `parentDir` (full history). Streams progress via `onProgress`.
 * Prompts are disabled so a private repo fails cleanly instead of hanging.
 */
export function clone(
  url: string,
  parentDir: string,
  onProgress?: (p: CloneProgress) => void,
  signal?: AbortSignal,
): Promise<CloneResult> {
  if (!url.trim()) return Promise.resolve({ ok: false, output: "A repository URL is required." });
  const name = repoNameFromUrl(url);
  const target = path.join(parentDir, name);
  if (existsSync(target)) {
    return Promise.resolve({ ok: false, output: `Destination already exists: ${target}` });
  }
  try {
    mkdirSync(parentDir, { recursive: true });
  } catch (e: any) {
    return Promise.resolve({
      ok: false,
      output: `Can't create destination folder: ${e?.message ?? String(e)}`,
    });
  }

  return new Promise<CloneResult>((resolve) => {
    const child = spawn("git", ["clone", "--progress", "--", url.trim(), name], {
      cwd: parentDir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      windowsHide: true,
    });

    let buf = "";
    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      killTree(child);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    // Activity-aware idle timeout: kill only if git goes silent for 90 s.
    // Resets on every chunk of output so large active clones are never killed.
    const HANG_MS = 90_000;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => killTree(child), HANG_MS);
    };
    const clearIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
    };
    resetIdle(); // start the clock; first output will reset it

    child.stderr.on("data", (chunk: Buffer) => {
      resetIdle(); // still alive — push the deadline back
      const s = chunk.toString();
      buf += s;
      // git emits progress on stderr, updating a line with \r.
      for (const line of s.split(/[\r\n]+/)) {
        const t = line.trim();
        if (!t) continue;
        const m = /([A-Za-z][A-Za-z ]+):\s+(\d+)%/.exec(t);
        onProgress?.(m ? { phase: m[1].trim(), percent: Number(m[2]), raw: t } : { raw: t });
      }
    });
    child.on("error", (err) => {
      clearIdle();
      signal?.removeEventListener("abort", onAbort);
      resolve({ ok: false, output: err.message });
    });
    child.on("close", (code) => {
      clearIdle();
      signal?.removeEventListener("abort", onAbort);
      const output = buf.trim();
      if (cancelled) {
        removePartial(target);
        return resolve({ ok: false, cancelled: true, output: "Clone cancelled." });
      }
      if (code === 0) return resolve({ ok: true, output: output || "Cloned.", path: target });
      removePartial(target); // git usually self-cleans, but ensure retries aren't blocked
      resolve({
        ok: false,
        output:
          output ||
          `git clone failed (exit code ${code}). Check the URL is correct, reachable, and public ` +
            `(private repos that need a login aren't supported here).`,
      });
    });
  });
}
