import express from "express";
import cors from "cors";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import type {
  ApplyEditsRequest,
  EditResult,
  LoadRequest,
  ProfileView,
} from "@igb/shared";
import { loadIg, loadSource, readRaw } from "./loader.js";
import { browse } from "./browse.js";
import { buildResourceView } from "./resource.js";
import { createArtifact, type CreateRequest } from "./create.js";
import * as gitOps from "./git.js";
import * as publisherOps from "./publisher.js";
import { sendErr, friendlyMessage } from "./errors.js";
import { stat } from "node:fs/promises";
import {
  adapterForExtension,
  applyChanges,
} from "./adapters/index.js";
import { resolveBaseSnapshot } from "./fhir-packages.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "16mb" }));

/** Currently loaded IG root, so artifact ids resolve to disk paths. */
let currentRoot: string | null = null;

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, root: currentRoot });
});

app.get("/api/browse", async (req, res) => {
  const dir = String(req.query.path ?? "");
  try {
    res.json(await browse(dir));
  } catch (err) {
    sendErr(res, 400, err);
  }
});

app.get("/api/home", (_req, res) => {
  res.json({ home: process.env.USERPROFILE ?? process.env.HOME ?? process.cwd() });
});

app.post("/api/load", async (req, res) => {
  const { root } = req.body as LoadRequest;
  if (!root) return res.status(400).json({ error: "Enter a path to an IG folder." });
  const resolved = path.resolve(root);
  try {
    const info = await stat(resolved).catch(() => null);
    if (!info) {
      return res.status(400).json({ error: `Folder not found: ${resolved}` });
    }
    if (!info.isDirectory()) {
      return res.status(400).json({ error: `Not a folder: ${resolved}. Pick the IG directory, not a file.` });
    }
    const summary = await loadIg(resolved);
    currentRoot = resolved;
    if (summary.artifacts.length === 0) {
      return res.json({ ...summary, warning: "No FHIR artifacts (.fsh, .json, .xml) found in this folder." });
    }
    res.json(summary);
  } catch (err) {
    sendErr(res, 500, err);
  }
});

app.get("/api/profile", async (req, res) => {
  const artifactId = String(req.query.artifactId ?? "");
  if (!currentRoot) return res.status(409).json({ error: "Load an IG first." });
  try {
    let src = await loadSource(currentRoot, idToRel(artifactId));
    if (!src) return res.status(404).json({ error: `Artifact not found: ${artifactId}` });
    const adapter = adapterForExtension(path.extname(src.filePath));
    const artifact = adapter?.describe(src);
    if (!adapter || !artifact)
      return res.status(404).json({ error: `${artifactId} isn't a recognised FHIR resource.` });

    // For editable profiles that have no snapshot, look up the base type so the
    // editor can show the full element landscape, not just the differential.
    if (artifact.editable) {
      const hasSnapshot =
        src.language === "json"
          ? src.text.includes('"snapshot"')
          : src.language === "xml"
            ? src.text.includes("<snapshot>")
            : false; // FSH never has a snapshot
      if (!hasSnapshot) {
        let baseType: string | undefined;
        if (src.language === "json") {
          try { baseType = (JSON.parse(src.text) as any)?.type; } catch { /* ignore */ }
        } else if (src.language === "xml") {
          baseType = /<type\s+value="([^"]+)"/.exec(src.text)?.[1];
        } else if (src.language === "fsh") {
          // Extract `Parent: <value>` from FSH; strip URL prefix and quotes.
          const raw = /^\s*Parent:\s*(\S+)/m.exec(src.text)?.[1];
          baseType = raw?.replace(/^["']|["']$/g, "").split("/").pop();
        }
        if (baseType) {
          const baseSnapshotJson = await resolveBaseSnapshot(baseType);
          if (baseSnapshotJson) src = { ...src, baseSnapshotJson };
        }
      }
    }

    const view: ProfileView | null = adapter.toProfileView(src, artifact);
    if (!view)
      return res.status(422).json({
        error: `${artifact.name} is a ${artifact.resourceType}, not an editable profile.`,
      });
    res.json(view);
  } catch (err) {
    sendErr(res, 500, err);
  }
});

app.get("/api/resource", async (req, res) => {
  const artifactId = String(req.query.artifactId ?? "");
  if (!currentRoot) return res.status(409).json({ error: "Load an IG first." });
  try {
    const src = await loadSource(currentRoot, idToRel(artifactId));
    if (!src) return res.status(404).json({ error: `Artifact not found: ${artifactId}` });
    const adapter = adapterForExtension(path.extname(src.filePath));
    const artifact = adapter?.describe(src);
    if (!artifact)
      return res.status(404).json({ error: `${artifactId} isn't a recognised FHIR resource.` });
    res.json(buildResourceView(src, artifact));
  } catch (err) {
    sendErr(res, 500, err);
  }
});

app.get("/api/file", async (req, res) => {
  const artifactId = String(req.query.artifactId ?? "");
  if (!currentRoot) return res.status(409).json({ error: "Load an IG first." });
  try {
    const text = await readRaw(currentRoot, idToRel(artifactId));
    res.json({ artifactId, text });
  } catch (err) {
    sendErr(res, 404, err);
  }
});

app.post("/api/file", async (req, res) => {
  const { artifactId, text } = req.body as { artifactId: string; text: string };
  if (!currentRoot) return res.status(409).json({ error: "Load an IG first." });
  if (typeof text !== "string") return res.status(400).json({ error: "Missing file text." });
  try {
    const src = await loadSource(currentRoot, idToRel(artifactId)).catch(() => null);
    const filePath = src?.filePath ?? path.join(currentRoot, idToRel(artifactId));
    await writeFile(filePath, text, "utf8");
    res.json({ ok: true });
  } catch (err) {
    sendErr(res, 500, err);
  }
});

/* ---------------- git ---------------- */

function requireRoot(res: express.Response): string | null {
  if (!currentRoot) {
    res.status(409).json({ error: "Load an IG first." });
    return null;
  }
  return currentRoot;
}

app.get("/api/git/status", async (_req, res) => {
  const root = requireRoot(res);
  if (!root) return;
  res.json(await gitOps.status(root));
});

app.get("/api/git/branches", async (_req, res) => {
  const root = requireRoot(res);
  if (!root) return;
  res.json(await gitOps.branches(root));
});

app.get("/api/git/log", async (req, res) => {
  const root = requireRoot(res);
  if (!root) return;
  res.json(await gitOps.log(root, Number(req.query.n ?? 25)));
});

app.get("/api/git/diff", async (req, res) => {
  const root = requireRoot(res);
  if (!root) return;
  res.json({ diff: await gitOps.diff(root, req.query.file ? String(req.query.file) : undefined) });
});

app.post("/api/git/clone", async (req, res) => {
  // Clone does not require a loaded IG — it is how you obtain one.
  const { url, parent } = req.body ?? {};
  if (!url) return res.status(400).json({ error: "Enter a repository URL." });
  if (!parent) return res.status(400).json({ error: "Choose a destination folder." });
  // Stream progress to the client as newline-delimited JSON.
  res.setHeader("Content-Type", "application/x-ndjson");
  res.flushHeaders();
  // If the client disconnects (cancel), abort the clone and kill git.
  const ac = new AbortController();
  let finished = false;
  res.on("close", () => {
    if (!finished) ac.abort();
  });
  const write = (obj: unknown) => {
    if (res.writableEnded) return;
    try {
      res.write(JSON.stringify(obj) + "\n");
    } catch {
      /* client went away mid-write */
    }
  };
  try {
    const result = await gitOps.clone(
      String(url),
      path.resolve(String(parent)),
      (p) => write({ type: "progress", ...p }),
      ac.signal,
    );
    finished = true;
    write({ type: "done", ...result });
  } catch (err) {
    finished = true;
    write({ type: "done", ok: false, output: friendlyMessage(err) });
  }
  if (!res.writableEnded) res.end();
});

app.post("/api/git/:action", async (req, res) => {
  const root = requireRoot(res);
  if (!root) return;
  const { action } = req.params;
  const body = req.body ?? {};
  const paths: string[] = Array.isArray(body.paths) ? body.paths.map(String) : [];
  try {
    switch (action) {
      case "init":
        return res.json(await gitOps.init(root));
      case "commit":
        return res.json(await gitOps.commit(root, String(body.message ?? "")));
      case "branch":
        return res.json(await gitOps.createBranch(root, String(body.name ?? ""), !!body.checkout));
      case "checkout":
        return res.json(await gitOps.checkout(root, String(body.name ?? "")));
      case "stage":
        return res.json(await gitOps.stage(root, paths));
      case "unstage":
        return res.json(await gitOps.unstage(root, paths));
      case "stageAll":
        return res.json(await gitOps.stageAll(root));
      case "unstageAll":
        return res.json(await gitOps.unstageAll(root));
      default:
        return res.status(404).json({ error: `Unknown git action: ${action}` });
    }
  } catch (err) {
    sendErr(res, 500, err);
  }
});

app.post("/api/create", async (req, res) => {
  if (!currentRoot) return res.status(409).json({ error: "Load an IG first." });
  try {
    const result = await createArtifact(currentRoot, req.body as CreateRequest);
    res.json(result);
  } catch (err) {
    sendErr(res, 400, err);
  }
});

app.post("/api/edits", async (req, res) => {
  const { artifactId, edits, write } = req.body as ApplyEditsRequest;
  if (!currentRoot) return res.status(409).json({ error: "Load an IG first." });
  try {
    const src = await loadSource(currentRoot, idToRel(artifactId));
    if (!src) return res.status(404).json({ error: `Artifact not found: ${artifactId}` });
    const adapter = adapterForExtension(path.extname(src.filePath));
    if (!adapter)
      return res.status(404).json({ error: `No editor for ${path.extname(src.filePath)} files.` });

    const changes = adapter.computeChanges(src, edits);
    const text = applyChanges(src.text, changes);

    if (write && changes.length > 0) {
      await writeFile(src.filePath, text, "utf8");
    }

    const result: EditResult = { artifactId, text, changes, applied: changes.length };
    res.json(result);
  } catch (err) {
    sendErr(res, 500, err);
  }
});

/* ---------------- publisher ---------------- */

app.post("/api/publisher/detect", async (req, res) => {
  const root = (req.body?.root as string | undefined) ?? currentRoot ?? process.cwd();
  try {
    res.json(await publisherOps.detectSetup(path.resolve(root)));
  } catch (err) {
    sendErr(res, 500, err);
  }
});

function streamPublisher(
  res: express.Response,
  run: (onEvent: (e: publisherOps.BuildEvent) => void, signal: AbortSignal) => Promise<void>,
) {
  res.setHeader("Content-Type", "application/x-ndjson");
  res.flushHeaders();
  const ac = new AbortController();
  let finished = false;
  // Use res.on("close") — fires on premature disconnect, same as the clone route.
  // req.on("close") can fire as soon as the request body is consumed, which is too early.
  res.on("close", () => { if (!finished) ac.abort(); });
  const write = (obj: unknown) => {
    if (res.writableEnded) return;
    try { res.write(JSON.stringify(obj) + "\n"); } catch { /* client gone */ }
  };
  run(write, ac.signal)
    .catch(() => { /* errors are surfaced as output events by the run function */ })
    .finally(() => {
      finished = true;
      if (!res.writableEnded) res.end();
    });
}

app.post("/api/publisher/build", (req, res) => {
  const root = requireRoot(res);
  if (!root) return;
  const { jarPath, mode, txUrl } = req.body ?? {};
  if (!jarPath) return res.status(400).json({ error: "jarPath is required." });

  streamPublisher(res, (onEvent, signal) =>
    publisherOps.startBuild({ root, jarPath, mode: mode ?? "full", txUrl }, onEvent, signal),
  );
});

app.post("/api/publisher/watch", (req, res) => {
  const root = requireRoot(res);
  if (!root) return;
  const { jarPath, mode, txUrl } = req.body ?? {};
  if (!jarPath) return res.status(400).json({ error: "jarPath is required." });

  res.setHeader("Content-Type", "application/x-ndjson");
  res.flushHeaders();

  const write = (obj: unknown) => {
    if (res.writableEnded) return;
    try { res.write(JSON.stringify(obj) + "\n"); } catch { /* client gone */ }
  };

  const stop = publisherOps.startWatch(
    { root, jarPath, mode: mode ?? "full", txUrl },
    (e) => {
      write(e);
      if (e.type === "stopped" && !res.writableEnded) res.end();
    },
  );

  res.on("close", stop);
});

function idToRel(id: string): string {
  return id.split("/").join(path.sep);
}

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`IG Builder server listening on http://localhost:${PORT}`);
});
