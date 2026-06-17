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
import { loadIg, loadSource } from "./loader.js";
import { browse } from "./browse.js";
import {
  adapterForExtension,
  applyChanges,
} from "./adapters/index.js";

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
    res.status(400).json({ error: String(err) });
  }
});

app.get("/api/home", (_req, res) => {
  res.json({ home: process.env.USERPROFILE ?? process.env.HOME ?? process.cwd() });
});

app.post("/api/load", async (req, res) => {
  const { root } = req.body as LoadRequest;
  if (!root) return res.status(400).json({ error: "root is required" });
  try {
    const summary = await loadIg(path.resolve(root));
    currentRoot = path.resolve(root);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/profile", async (req, res) => {
  const artifactId = String(req.query.artifactId ?? "");
  if (!currentRoot) return res.status(409).json({ error: "no IG loaded" });
  try {
    const src = await loadSource(currentRoot, idToRel(artifactId));
    if (!src) return res.status(404).json({ error: "not found" });
    const adapter = adapterForExtension(path.extname(src.filePath));
    const artifact = adapter?.describe(src);
    if (!adapter || !artifact) return res.status(404).json({ error: "not FHIR" });
    const view: ProfileView | null = adapter.toProfileView(src, artifact);
    if (!view) return res.status(422).json({ error: "not a profile" });
    res.json(view);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/edits", async (req, res) => {
  const { artifactId, edits, write } = req.body as ApplyEditsRequest;
  if (!currentRoot) return res.status(409).json({ error: "no IG loaded" });
  try {
    const src = await loadSource(currentRoot, idToRel(artifactId));
    if (!src) return res.status(404).json({ error: "not found" });
    const adapter = adapterForExtension(path.extname(src.filePath));
    if (!adapter) return res.status(404).json({ error: "no adapter" });

    const changes = adapter.computeChanges(src, edits);
    const text = applyChanges(src.text, changes);

    if (write && changes.length > 0) {
      await writeFile(src.filePath, text, "utf8");
    }

    const result: EditResult = { artifactId, text, changes };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

function idToRel(id: string): string {
  return id.split("/").join(path.sep);
}

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`IG Builder server listening on http://localhost:${PORT}`);
});
