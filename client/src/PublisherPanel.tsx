import { useEffect, useRef, useState } from "react";
import {
  publisherDetect,
  publisherBuild,
  publisherWatch,
  type PublisherEvent,
  type PublisherSetup,
  type PublisherBuildOpts,
} from "./api.js";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  Clock,
  Eye,
  EyeOff,
  Play,
  RotateCcw,
  Square,
  X,
} from "lucide-react";

const PUBLISHER_JAR_KEY = "igb-publisher-jar";
const PUBLISHER_MODE_KEY = "igb-publisher-mode";
const PUBLISHER_TX_URL_KEY = "igb-publisher-tx-url";

type Mode = "full" | "fast" | "local-tx";
type Tab = "build" | "setup";

interface LogLine {
  id: number;
  text: string;
  kind: "output" | "error" | "warning" | "changed" | "phase" | "meta";
}

let lineId = 0;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

export function PublisherPanel({
  root,
  onClose,
}: {
  root: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("build");
  const [setup, setSetup] = useState<PublisherSetup | null>(null);
  const [detecting, setDetecting] = useState(false);

  const [jarPath, setJarPath] = useState(() => localStorage.getItem(PUBLISHER_JAR_KEY) ?? "");
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem(PUBLISHER_MODE_KEY) as Mode | null) ?? "fast",
  );
  const [txUrl, setTxUrl] = useState(
    () => localStorage.getItem(PUBLISHER_TX_URL_KEY) ?? "http://localhost:8080/fhir",
  );

  const [log, setLog] = useState<LogLine[]>([]);
  const [summary, setSummary] = useState<{ errors: number; warnings: number; durationMs: number } | null>(null);
  const [building, setBuilding] = useState(false);
  const [watching, setWatching] = useState(false);
  const [watchRun, setWatchRun] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Persist settings
  useEffect(() => { localStorage.setItem(PUBLISHER_JAR_KEY, jarPath); }, [jarPath]);
  useEffect(() => { localStorage.setItem(PUBLISHER_MODE_KEY, mode); }, [mode]);
  useEffect(() => { localStorage.setItem(PUBLISHER_TX_URL_KEY, txUrl); }, [txUrl]);

  // Auto-detect on open
  useEffect(() => {
    detect();
  }, []);

  // Auto-scroll log
  useEffect(() => {
    if (autoScrollRef.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  async function detect() {
    setDetecting(true);
    try {
      const s = await publisherDetect(root);
      setSetup(s);
      if (s.jarPath && !jarPath) setJarPath(s.jarPath);
    } catch {
      // Silently ignore detect failures
    } finally {
      setDetecting(false);
    }
  }

  function pushLine(text: string, kind: LogLine["kind"]) {
    setLog((prev) => [...prev.slice(-2000), { id: lineId++, text, kind }]);
  }

  function handleEvent(e: PublisherEvent) {
    switch (e.type) {
      case "output":
        pushLine(e.line, e.isError ? "error" : e.isWarning ? "warning" : "output");
        break;
      case "summary":
        setSummary({ errors: e.errors, warnings: e.warnings, durationMs: e.durationMs });
        break;
      case "done":
        setBuilding(false);
        if (!e.cancelled && !e.success) {
          pushLine("Build failed — check output above for details.", "error");
        }
        break;
      case "changed":
        pushLine(`↻  ${e.file} changed`, "changed");
        break;
      case "building":
        setSummary(null);
        setWatchRun(e.run);
        pushLine(`── Build #${e.run} ──`, "phase");
        break;
      case "idle":
        pushLine("Watching for changes…", "meta");
        break;
      case "stopped":
        setWatching(false);
        setBuilding(false);
        pushLine("Watch stopped.", "meta");
        break;
    }
  }

  const opts: PublisherBuildOpts = {
    jarPath,
    mode,
    txUrl: mode === "local-tx" ? txUrl : undefined,
  };

  function canBuild() {
    return !!jarPath && !!root && !building;
  }

  async function runBuild() {
    if (!canBuild()) return;
    setBuilding(true);
    setSummary(null);
    setLog([]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await publisherBuild(root, opts, handleEvent, ac.signal);
    } catch (e: any) {
      if (e?.name !== "AbortError") pushLine(`Error: ${e?.message ?? String(e)}`, "error");
    } finally {
      setBuilding(false);
      abortRef.current = null;
    }
  }

  async function startWatch() {
    if (!canBuild()) return;
    setWatching(true);
    setBuilding(true);
    setSummary(null);
    setLog([]);
    setWatchRun(0);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await publisherWatch(root, opts, handleEvent, ac.signal);
    } catch (e: any) {
      if (e?.name !== "AbortError") pushLine(`Error: ${e?.message ?? String(e)}`, "error");
    } finally {
      setWatching(false);
      setBuilding(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  const effectiveJar = jarPath || setup?.jarPath || "";
  const javaDetected = setup !== null;
  const javaCompatible = !javaDetected || (setup?.javaOk && setup?.javaCompatible !== false);
  const ready = !!effectiveJar && !!setup?.javaOk && (setup?.javaCompatible ?? true);

  return (
    <div className="modal-backdrop" onClick={() => !building && onClose()}>
      <div className="modal publisher-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-head">
          <h3>
            IG Publisher
            {building && !watching && <span className="working">building…</span>}
            {watching && <span className="working">watching{watchRun > 0 ? ` · build #${watchRun}` : "…"}</span>}
          </h3>
          <button
            onClick={onClose}
            disabled={building}
            title={building ? "Build in progress" : "Close"}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="pub-tabs">
          <button
            className={"pub-tab" + (tab === "build" ? " active" : "")}
            onClick={() => setTab("build")}
          >
            Build
          </button>
          <button
            className={"pub-tab" + (tab === "setup" ? " active" : "")}
            onClick={() => setTab("setup")}
          >
            Setup
          </button>
        </div>

        {tab === "build" && (
          <BuildTab
            jarPath={jarPath}
            setJarPath={setJarPath}
            mode={mode}
            setMode={setMode}
            txUrl={txUrl}
            setTxUrl={setTxUrl}
            log={log}
            logRef={logRef}
            autoScrollRef={autoScrollRef}
            summary={summary}
            building={building}
            watching={watching}
            ready={ready}
            javaCompatible={javaCompatible}
            onBuild={runBuild}
            onWatch={startWatch}
            onCancel={cancel}
            onClearLog={() => setLog([])}
            setup={setup}
          />
        )}

        {tab === "setup" && (
          <SetupTab
            setup={setup}
            detecting={detecting}
            onRedetect={detect}
          />
        )}
      </div>
    </div>
  );
}

// ── Build tab ─────────────────────────────────────────────────

function BuildTab({
  jarPath, setJarPath, mode, setMode, txUrl, setTxUrl,
  log, logRef, autoScrollRef, summary,
  building, watching, ready, javaCompatible,
  onBuild, onWatch, onCancel, onClearLog, setup,
}: {
  jarPath: string; setJarPath: (v: string) => void;
  mode: Mode; setMode: (v: Mode) => void;
  txUrl: string; setTxUrl: (v: string) => void;
  log: LogLine[]; logRef: React.RefObject<HTMLDivElement>;
  autoScrollRef: React.MutableRefObject<boolean>;
  summary: { errors: number; warnings: number; durationMs: number } | null;
  building: boolean; watching: boolean; ready: boolean; javaCompatible: boolean;
  onBuild: () => void; onWatch: () => void; onCancel: () => void;
  onClearLog: () => void;
  setup: PublisherSetup | null;
}) {
  const effectiveJar = jarPath || setup?.jarPath || "";

  return (
    <div className="pub-body">
      {/* Jar path */}
      <div className="pub-field">
        <label>Publisher jar</label>
        <input
          value={jarPath}
          placeholder={setup?.jarPath ?? "Path to publisher.jar…"}
          onChange={(e) => setJarPath(e.target.value)}
          spellCheck={false}
        />
      </div>

      {/* Mode */}
      <div className="pub-field">
        <label>Mode</label>
        <div className="seg">
          {(["fast", "full", "local-tx"] as Mode[]).map((m) => (
            <button
              key={m}
              className={"seg-btn" + (mode === m ? " active" : "")}
              onClick={() => setMode(m)}
            >
              {m === "fast" ? "Fast (no terminology)" : m === "full" ? "Full" : "Local TX server"}
            </button>
          ))}
        </div>
        <div className="pub-mode-hint">
          {mode === "fast" && "Skips terminology server calls. Structural + profile validation only. ~2–3 min."}
          {mode === "full" && "Validates against tx.fhir.org. Full validation. ~35–45 min cold, ~8–15 min with warm cache."}
          {mode === "local-tx" && "Validates against a local terminology server. ~5–8 min cold, ~3–5 min warm. See Setup tab."}
        </div>
      </div>

      {mode === "local-tx" && (
        <div className="pub-field">
          <label>TX server URL</label>
          <input
            value={txUrl}
            placeholder="http://localhost:8080/fhir"
            onChange={(e) => setTxUrl(e.target.value)}
            spellCheck={false}
          />
        </div>
      )}

      {/* Java version warning */}
      {setup && setup.javaOk && !setup.javaCompatible && (
        <div className="pub-callout pub-callout-error">
          <strong>Java {setup.javaMajor ?? setup.javaVersion} detected — Java 17 or later is required.</strong>
          {" "}IG Publisher will not run on older versions. Install{" "}
          <a href="https://adoptium.net" target="_blank" rel="noreferrer">Temurin JDK 17+</a>
          {" "}and restart the app.
        </div>
      )}

      {/* Actions */}
      <div className="pub-actions">
        {!building ? (
          <>
            <button
              className="primary"
              onClick={onBuild}
              disabled={!effectiveJar || !ready}
              title={
                !setup?.javaOk ? "Java not found — see Setup tab" :
                !setup?.javaCompatible ? `Java ${setup?.javaMajor ?? setup?.javaVersion} is too old — Java 17+ required` :
                !effectiveJar ? "publisher.jar path required" : ""
              }
            >
              <Play size={13} /> Build
            </button>
            <button
              onClick={onWatch}
              disabled={!effectiveJar || !ready}
              title="Start watching for file changes and rebuild automatically"
            >
              <Eye size={13} /> Watch
            </button>
          </>
        ) : (
          <button onClick={onCancel}>
            <Square size={13} /> {watching ? "Stop watching" : "Cancel build"}
          </button>
        )}
        {log.length > 0 && !building && (
          <button onClick={onClearLog} title="Clear output">
            <RotateCcw size={13} /> Clear
          </button>
        )}
      </div>

      {/* Summary bar */}
      {summary && (
        <div className={"pub-summary" + (summary.errors > 0 ? " has-errors" : summary.warnings > 0 ? " has-warnings" : " success")}>
          <span className="pub-summary-stat">
            {summary.errors > 0 ? <AlertTriangle size={13} /> : <Check size={13} />}
            {summary.errors} {summary.errors === 1 ? "error" : "errors"}
          </span>
          <span className="pub-summary-stat">
            <Circle size={11} />
            {summary.warnings} {summary.warnings === 1 ? "warning" : "warnings"}
          </span>
          <span className="pub-summary-stat">
            <Clock size={11} />
            {formatDuration(summary.durationMs)}
          </span>
        </div>
      )}

      {/* Log */}
      <div
        className="pub-log"
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          autoScrollRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
        }}
      >
        {log.length === 0 && !building && (
          <div className="pub-log-empty">
            {!effectiveJar
              ? "Set the publisher.jar path above, then click Build."
              : "Click Build to run IG Publisher, or Watch to rebuild automatically on file changes."}
          </div>
        )}
        {log.map((l) => (
          <div key={l.id} className={`pub-line pub-line-${l.kind}`}>
            {l.text}
          </div>
        ))}
        {building && log.length === 0 && (
          <div className="pub-line pub-line-meta">Starting…</div>
        )}
      </div>
    </div>
  );
}

// ── Setup tab ─────────────────────────────────────────────────

function SetupTab({
  setup,
  detecting,
  onRedetect,
}: {
  setup: PublisherSetup | null;
  detecting: boolean;
  onRedetect: () => void;
}) {
  return (
    <div className="pub-body pub-setup">
      {/* Environment checks */}
      <div className="pub-section-title">Environment</div>
      <table className="kv">
        <tbody>
          <tr>
            <th>Java</th>
            <td>
              {detecting ? (
                <span className="muted">Detecting…</span>
              ) : !setup?.javaOk ? (
                <span className="bad">
                  <AlertTriangle size={13} /> Not found —{" "}
                  <a href="https://adoptium.net" target="_blank" rel="noreferrer">
                    Download Temurin (JDK 17+)
                  </a>
                </span>
              ) : setup.javaCompatible ? (
                <span className="good"><Check size={13} /> Java {setup.javaVersion ?? "detected"}</span>
              ) : (
                <span className="bad">
                  <AlertTriangle size={13} /> Java {setup.javaVersion ?? setup.javaMajor} — too old (need 17+).{" "}
                  <a href="https://adoptium.net" target="_blank" rel="noreferrer">
                    Download Temurin JDK 17+
                  </a>
                </span>
              )}
            </td>
          </tr>
          <tr>
            <th>Publisher jar</th>
            <td>
              {detecting ? (
                <span className="muted">Detecting…</span>
              ) : setup?.jarPath ? (
                <span className="good"><Check size={13} /> {setup.jarPath}</span>
              ) : (
                <span className="bad">
                  <AlertTriangle size={13} /> Not found in standard locations
                </span>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {!setup?.jarPath && !detecting && (
        <div className="pub-callout">
          <div className="pub-callout-title">Getting publisher.jar</div>
          <p>
            The standard way is to run your IG's <code>_updatePublisher</code> script — it
            downloads the jar to <code>input-cache/publisher.jar</code> automatically.
          </p>
          <p>
            Or download it manually from the latest release and place it anywhere:
          </p>
          <CopyBlock value="https://github.com/HL7/fhir-ig-publisher/releases/latest/download/publisher.jar" />
        </div>
      )}

      <button style={{ marginTop: 8 }} onClick={onRedetect} disabled={detecting}>
        <RotateCcw size={13} /> Re-detect
      </button>

      {/* Local TX server guide */}
      <div className="pub-section-title" style={{ marginTop: 24 }}>Local Terminology Server</div>

      <div className="pub-callout info">
        <div className="pub-callout-title">Why this matters</div>
        <p>
          The biggest factor in build time isn't Java or HTML generation — it's terminology
          validation. For every value set binding in your IG, IG Publisher makes an HTTP call
          to <code>tx.fhir.org</code> to validate codes. A medium-sized IG can make thousands of
          these calls to an external server over the internet.
        </p>
        <p>
          A local FHIR terminology server eliminates the network latency entirely.
        </p>

        <div className="pub-time-table">
          <div className="pub-time-row header">
            <span>Mode</span><span>Cold build</span><span>Warm cache</span>
          </div>
          <div className="pub-time-row">
            <span>Full (tx.fhir.org)</span><span>35–45 min</span><span>8–15 min</span>
          </div>
          <div className="pub-time-row good-row">
            <span>Local TX server</span><span>5–8 min</span><span>3–5 min</span>
          </div>
          <div className="pub-time-row best-row">
            <span>Fast (no terminology)</span><span>2–3 min</span><span>2–3 min</span>
          </div>
        </div>
      </div>

      <div className="pub-section-title" style={{ marginTop: 20 }}>Option 1 — Docker (recommended)</div>
      <p className="pub-para">
        If you have Docker installed, this starts a HAPI FHIR server with one command:
      </p>
      <CopyBlock value="docker run -p 8080:8080 hapiproject/hapi:latest" />
      <p className="pub-para">
        Wait about 60 seconds for it to start, then set the Build tab mode to{" "}
        <strong>Local TX server</strong> and use:
      </p>
      <CopyBlock value="http://localhost:8080/fhir" />
      <p className="pub-para muted">
        The server needs to download terminology packages on first use, so the very first
        build may still be slow. Subsequent builds will be fast.
      </p>

      <div className="pub-section-title" style={{ marginTop: 20 }}>Option 2 — matchbox (lighter)</div>
      <p className="pub-para">
        matchbox is a lighter alternative that starts faster and uses less memory:
      </p>
      <CopyBlock value="docker run -p 8080:8080 ghcr.io/ahdis/matchbox:latest" />
      <p className="pub-para">Then use the same URL: <code>http://localhost:8080/fhir</code></p>

      <div className="pub-section-title" style={{ marginTop: 20 }}>About Watch mode</div>
      <p className="pub-para">
        IG Publisher's built-in <code>-gencontinuous</code> flag is broken in current versions
        — it runs once and stops regardless of environment. Watch mode in IG Builder replaces
        it: a file watcher detects changes to <code>.fsh</code>, <code>.json</code>, and{" "}
        <code>.xml</code> files, waits 3 seconds for edits to settle, then respawns IG
        Publisher automatically. The tx-cache accumulates between runs on disk, so each
        successive build is faster than the last.
      </p>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="pub-copy-block">
      <code>{value}</code>
      <button onClick={copy} title="Copy" className="copy-btn">
        {copied ? <Check size={12} /> : <ChevronRight size={12} />}
      </button>
    </div>
  );
}
