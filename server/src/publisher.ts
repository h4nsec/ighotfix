import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import os from "node:os";

const execFileP = promisify(execFile);

export interface PublisherSetup {
  javaOk: boolean;
  javaVersion?: string;
  javaMajor?: number;
  javaCompatible?: boolean; // true when major >= 17
  javaExe?: string;         // explicit path to use (may differ from PATH java)
  rubyOk: boolean;
  rubyVersion?: string;
  jekyllOk: boolean;
  jekyllVersion?: string;
  jarPath?: string;
  searchedPaths: string[];
}

export interface BuildOptions {
  jarPath: string;
  mode: "full" | "fast" | "local-tx";
  txUrl?: string;
  root: string;
  javaExe?: string; // if set, use this instead of "java" from PATH
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

/** Run a command and return the first line of its output, or undefined on failure. */
async function probeTool(cmd: string, args: string[]): Promise<string | undefined> {
  try {
    // .bat and .cmd files require shell:true on Windows to execute.
    const shell = process.platform === "win32" && /\.(bat|cmd)$/i.test(cmd);
    const r = await execFileP(cmd, args, { timeout: 8_000, shell });
    const out = (r.stdout || r.stderr || "").toString().trim();
    return out.split(/\r?\n/)[0].trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Try to get the Java major version for a given executable. Returns undefined on failure. */
async function probeJava(exe: string): Promise<{ version: string; major: number } | undefined> {
  try {
    const r = await execFileP(exe, ["-version"], { timeout: 8_000 });
    const output = (r.stderr || r.stdout || "").toString();
    const m = /version "([^"]+)"/.exec(output);
    if (!m) return undefined;
    const version = m[1];
    const parts = version.split(".");
    const first = Number(parts[0]);
    const major = first === 1 ? Number(parts[1]) : first;
    if (isNaN(major)) return undefined;
    return { version, major };
  } catch {
    return undefined;
  }
}

/** Candidate java.exe paths to try beyond the system PATH. Windows-specific roots. */
function extraJavaCandidates(): string[] {
  if (process.platform !== "win32") return [];
  const roots = [
    process.env["JAVA_HOME"],
    process.env["JDK_HOME"],
    "C:\\Program Files\\Eclipse Adoptium",
    "C:\\Program Files\\Microsoft",
    "C:\\Program Files\\Java",
    "C:\\Program Files\\Amazon Corretto",
    "C:\\Program Files\\Azul Systems\\Zulu",
  ].filter(Boolean) as string[];

  const candidates: string[] = [];
  for (const root of roots) {
    // JAVA_HOME / JDK_HOME point directly to the JDK directory.
    if (root === process.env["JAVA_HOME"] || root === process.env["JDK_HOME"]) {
      candidates.push(path.join(root, "bin", "java.exe"));
      continue;
    }
    // Program Files vendors: each subdirectory is a JDK install.
    try {
      for (const entry of readdirSync(root, { withFileTypes: false })) {
        candidates.push(path.join(root, String(entry), "bin", "java.exe"));
      }
    } catch {
      // Directory doesn't exist — skip.
    }
  }
  return candidates;
}

export async function detectSetup(root: string): Promise<PublisherSetup> {
  // Try the PATH java first.
  let best = await probeJava("java");
  let javaExe: string | undefined;

  if (!best || best.major < 17) {
    // Search well-known install locations for a compatible version.
    for (const candidate of extraJavaCandidates()) {
      if (!existsSync(candidate)) continue;
      const info = await probeJava(candidate);
      if (info && info.major >= 17 && (!best || info.major > best.major)) {
        best = info;
        javaExe = candidate;
      }
    }
  }

  const javaOk = !!best;
  const javaVersion = best?.version;
  const javaMajor = best?.major;
  const javaCompatible = javaMajor !== undefined && javaMajor >= 17;

  // Probe Ruby — try PATH first, then well-known RubyInstaller locations on Windows.
  let rubyExe = "ruby";
  let rubyRaw = await probeTool("ruby", ["-v"]);
  if (!rubyRaw && process.platform === "win32") {
    const rubyCandidates: string[] = [];
    try {
      for (const entry of readdirSync("C:\\", { withFileTypes: false })) {
        const s = String(entry);
        if (/^ruby/i.test(s)) rubyCandidates.push(`C:\\${s}\\bin\\ruby.exe`);
      }
    } catch { /* C:\ not readable */ }
    for (const candidate of rubyCandidates) {
      if (!existsSync(candidate)) continue;
      const v = await probeTool(candidate, ["-v"]);
      if (v) { rubyRaw = v; rubyExe = candidate; break; }
    }
  }

  // Find jekyll: try PATH, then ruby -S (searches gem load path without needing a bat file),
  // then scan gem executable dir and known Windows locations.
  let jekyllRaw = await probeTool("jekyll", ["--version"]);

  if (!jekyllRaw && rubyRaw) {
    // ruby -S searches $LOAD_PATH and gem bin dirs for the script — most reliable fallback.
    jekyllRaw = await probeTool(rubyExe, ["-S", "jekyll", "--version"]);
  }

  if (!jekyllRaw) {
    const gemExe = rubyExe === "ruby" ? undefined :
      path.join(path.dirname(rubyExe), process.platform === "win32" ? "gem.cmd" : "gem");
    const gemDirs: string[] = [];

    if (gemExe && existsSync(gemExe)) {
      try {
        // gem.cmd/.bat also needs shell:true on Windows.
        const shell = process.platform === "win32" && /\.(bat|cmd)$/i.test(gemExe);
        const r = await execFileP(gemExe, ["environment"], { timeout: 12_000, shell });
        const out = (r.stdout || r.stderr || "").toString();
        const m = /EXECUTABLE DIRECTORY:\s*(.+)/i.exec(out);
        if (m) gemDirs.push(m[1].trim());
      } catch { /* gem failed */ }
    }
    // WindowsApps is a common gem --bindir override on Windows.
    if (process.platform === "win32") {
      gemDirs.push(path.join(os.homedir(), "AppData", "Local", "Microsoft", "WindowsApps"));
    }

    for (const dir of gemDirs) {
      for (const name of ["jekyll.bat", "jekyll"]) {
        const candidate = path.join(dir, name);
        if (existsSync(candidate)) {
          const v = await probeTool(candidate, ["--version"]);
          if (v) { jekyllRaw = v; break; }
        }
      }
      if (jekyllRaw) break;
    }
  }
  const rubyOk = !!rubyRaw;
  const jekyllOk = !!jekyllRaw;
  // Trim verbose ruby output: "ruby 3.3.0 (2024-01-18 revision ...) [x64-...]" → "ruby 3.3.0"
  const rubyVersion = rubyRaw ? rubyRaw.replace(/\s*\(.*/, "").trim() : undefined;
  const jekyllVersion = jekyllRaw;

  const home = os.homedir();
  const searchedPaths = [
    path.join(root, "input-cache", "publisher.jar"),
    path.join(root, "publisher.jar"),
    path.join(home, ".fhir", "ig-publisher", "publisher.jar"),
    path.join(home, ".fhir", "ig-publisher", "org.hl7.fhir.publisher.jar"),
    path.join(home, "publisher.jar"),
  ];

  const jarPath = searchedPaths.find((p) => existsSync(p));
  return {
    javaOk, javaVersion, javaMajor, javaCompatible, javaExe,
    rubyOk, rubyVersion, jekyllOk, jekyllVersion,
    jarPath, searchedPaths,
  };
}

// ── Output parsing ────────────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
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

    const javaExe = opts.javaExe ?? "java";
    const args = [
      "-Xmx4g",
      "-jar",
      opts.jarPath,
      "-ig",
      opts.root,
      ...txArgs(opts.mode, opts.txUrl),
    ];

    // Emit the exact command so the user can reproduce it in a terminal.
    onEvent({
      type: "output",
      line: `Running: "${javaExe}" ${args.join(" ")}`,
      isError: false,
      isWarning: false,
    });

    const child = spawn(javaExe, args, {
      cwd: opts.root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
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
      const t = line.replace(ANSI_RE, "").trim();
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
      const success = !cancelled && code === 0 && errors === 0;
      onEvent({
        type: "output",
        line: cancelled
          ? "Build cancelled."
          : `Process exited with code ${code ?? "null"}. ${success ? "Build succeeded." : "Build failed."}`,
        isError: !success && !cancelled,
        isWarning: false,
      });
      if (cancelled) {
        onEvent({ type: "done", success: false, cancelled: true });
      } else {
        onEvent({ type: "done", success });
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
