import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import os from "node:os";

const execFileP = promisify(execFile);

export interface PublisherSetup {
  javaOk: boolean;
  javaVersion?: string;
  jarPath?: string;
  searchedPaths: string[];
}

export interface BuildOptions {
  jarPath: string;
  mode: "full" | "fast" | "local-tx";
  txUrl?: string;
  root: string;
}

export type BuildEvent =
  | { type: "output"; line: string; isError: boolean; isWarning: boolean }
  | { type: "summary"; errors: number; warnings: number; durationMs: number }
  | { type: "done"; success: boolean; cancelled?: boolean }
  | { type: "changed"; file: string }
  | { type: "building"; run: number }
  | { type: "idle" }
  | { type: "stopped" };

// ── Setup detection ───────────────────────────────────────────

export async function detectSetup(root: string): Promise<PublisherSetup> {
  let javaOk = false;
  let javaVersion: string | undefined;
  try {
    // java -version writes to stderr
    const r = await execFileP("java", ["-version"], { timeout: 10_000 });
    const output = (r.stderr || r.stdout || "").toString();
    javaOk = true;
    const m = /version "([^"]+)"/.exec(output);
    javaVersion = m?.[1];
  } catch (e: any) {
    // java not on PATH or failed — javaOk stays false
  }

  const home = os.homedir();
  const searchedPaths = [
    path.join(root, "input-cache", "publisher.jar"),
    path.join(root, "publisher.jar"),
    path.join(home, ".fhir", "ig-publisher", "publisher.jar"),
    path.join(home, ".fhir", "ig-publisher", "org.hl7.fhir.publisher.jar"),
    path.join(home, "publisher.jar"),
  ];

  const jarPath = searchedPaths.find((p) => existsSync(p));
  return { javaOk, javaVersion, jarPath, searchedPaths };
}

// ── Output parsing ────────────────────────────────────────────

const SUMMARY_RE = /(\d+) errors?,\s*(\d+) warnings?/i;
// Match log-level markers as whole words, or leading "Error"/"Warning" at line start
const ERROR_RE = /\[ERROR\]|\bERROR:\s|^Error\s+@|^Error:/m;
const WARN_RE = /\[WARN\]|\bWARN(ING)?:\s|^Warning\s+@|^Warning:/im;

function parseLine(line: string) {
  const summaryMatch = SUMMARY_RE.exec(line);
  if (summaryMatch) {
    return {
      isSummary: true,
      errors: Number(summaryMatch[1]),
      warnings: Number(summaryMatch[2]),
      isError: false,
      isWarning: false,
    };
  }
  return {
    isSummary: false,
    isError: ERROR_RE.test(line),
    isWarning: WARN_RE.test(line),
  };
}

// ── Process helpers ───────────────────────────────────────────

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
      });
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

function txArgs(mode: BuildOptions["mode"], txUrl?: string): string[] {
  if (mode === "fast") return ["-tx", "n/a"];
  if (mode === "local-tx" && txUrl) return ["-tx", txUrl.trim()];
  return []; // full mode → IG Publisher uses tx.fhir.org by default
}

// ── Single build ──────────────────────────────────────────────

export function startBuild(
  opts: BuildOptions,
  onEvent: (e: BuildEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!existsSync(opts.jarPath)) {
      onEvent({
        type: "output",
        line: `publisher.jar not found at ${opts.jarPath}`,
        isError: true,
        isWarning: false,
      });
      onEvent({ type: "done", success: false });
      return resolve();
    }

    const args = [
      "-Xmx4g",
      "-jar",
      opts.jarPath,
      "-ig",
      opts.root,
      ...txArgs(opts.mode, opts.txUrl),
    ];

    const child = spawn("java", args, {
      cwd: opts.root,
      windowsHide: true,
    });

    let cancelled = false;
    const startTime = Date.now();
    let errors = 0;
    let warnings = 0;
    let sawSummary = false;
    let stdoutBuf = "";
    let stderrBuf = "";

    const onAbort = () => {
      cancelled = true;
      killTree(child);
    };
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }

    const handleLine = (line: string) => {
      const t = line.trim();
      if (!t) return;
      const parsed = parseLine(t);
      if (parsed.isSummary) {
        errors = parsed.errors ?? 0;
        warnings = parsed.warnings ?? 0;
        sawSummary = true;
      } else {
        if (parsed.isError) errors++;
        if (parsed.isWarning) warnings++;
      }
      onEvent({ type: "output", line: t, isError: parsed.isError, isWarning: parsed.isWarning });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? "";
      lines.forEach(handleLine);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split(/\r?\n/);
      stderrBuf = lines.pop() ?? "";
      lines.forEach(handleLine);
    });

    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      const msg =
        err.message.includes("ENOENT")
          ? "java not found — make sure Java is installed and on your PATH."
          : `Failed to start IG Publisher: ${err.message}`;
      onEvent({ type: "output", line: msg, isError: true, isWarning: false });
      onEvent({ type: "summary", errors: 1, warnings: 0, durationMs: Date.now() - startTime });
      onEvent({ type: "done", success: false });
      resolve();
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (stdoutBuf.trim()) handleLine(stdoutBuf);
      if (stderrBuf.trim()) handleLine(stderrBuf);
      const durationMs = Date.now() - startTime;
      // If publisher didn't print a summary line, synthesise one from running counts.
      if (!sawSummary || cancelled) {
        onEvent({ type: "summary", errors, warnings, durationMs });
      } else {
        onEvent({ type: "summary", errors, warnings, durationMs });
      }
      if (cancelled) {
        onEvent({ type: "done", success: false, cancelled: true });
      } else {
        onEvent({ type: "done", success: code === 0 && errors === 0 });
      }
      resolve();
    });
  });
}

// ── Watch mode ────────────────────────────────────────────────

/**
 * Watch `opts.root` for source file changes. Triggers a build immediately
 * then again 3 s after each batch of changes. Returns a stop function.
 */
export function startWatch(
  opts: BuildOptions,
  onEvent: (e: BuildEvent) => void,
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let buildAbort: AbortController | null = null;
  let runCount = 0;
  let stopped = false;

  const triggerBuild = () => {
    if (stopped) return;
    buildAbort?.abort();
    buildAbort = new AbortController();
    runCount++;
    onEvent({ type: "building", run: runCount });
    startBuild(opts, onEvent, buildAbort.signal).then(() => {
      if (!stopped) onEvent({ type: "idle" });
    });
  };

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(opts.root, { recursive: true }, (_ev, filename) => {
      if (!filename || stopped) return;
      const f = String(filename);
      if (!/\.(fsh|json|xml|yaml|yml|ini)$/.test(f)) return;
      // Ignore output directory churn produced by the build itself.
      if (/[/\\](output|temp|igs)[/\\]/.test(f)) return;
      onEvent({ type: "changed", file: f });
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(triggerBuild, 3000);
    });
  } catch {
    onEvent({
      type: "output",
      line: "Could not start file watcher — watch mode unavailable on this system.",
      isError: true,
      isWarning: false,
    });
  }

  // Run the first build immediately so the user gets output right away.
  triggerBuild();

  return () => {
    stopped = true;
    watcher?.close();
    if (debounceTimer) clearTimeout(debounceTimer);
    buildAbort?.abort();
    onEvent({ type: "stopped" });
  };
}
