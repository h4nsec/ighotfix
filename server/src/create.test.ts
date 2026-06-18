import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createArtifact } from "./create.js";
import { xmlAdapter } from "./adapters/xml.js";
import { jsonAdapter } from "./adapters/json.js";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "igb-"));
  dirs.push(d);
  return d;
}
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

describe("createArtifact", () => {
  it("scaffolds a valid XML SearchParameter the adapter recognises", async () => {
    const root = await tmp();
    const { artifactId } = await createArtifact(root, {
      resourceType: "SearchParameter",
      id: "my-sp",
      name: "MySP",
      language: "xml",
      canonicalBase: "http://example.org/fhir",
    });
    expect(artifactId).toBe("my-sp.xml");
    const text = await readFile(path.join(root, artifactId), "utf8");
    const art = xmlAdapter.describe({ id: artifactId, filePath: artifactId, language: "xml", text })!;
    expect(art.resourceType).toBe("SearchParameter");
    expect(art.name).toBe("MySP");
    expect(art.url).toBe("http://example.org/fhir/SearchParameter/my-sp");
    expect(art.category).toBe("Capabilities");
  });

  it("scaffolds a valid JSON CapabilityStatement", async () => {
    const root = await tmp();
    const { artifactId } = await createArtifact(root, {
      resourceType: "CapabilityStatement",
      id: "my-cap",
      name: "MyCap",
      language: "json",
    });
    const text = await readFile(path.join(root, artifactId), "utf8");
    const obj = JSON.parse(text);
    expect(obj.resourceType).toBe("CapabilityStatement");
    expect(obj.rest[0].mode).toBe("server");
    const art = jsonAdapter.describe({ id: artifactId, filePath: artifactId, language: "json", text })!;
    expect(art.category).toBe("Capabilities");
  });

  it("sanitises the id for the filename and rejects duplicates", async () => {
    const root = await tmp();
    const r1 = await createArtifact(root, { resourceType: "SearchParameter", id: "a b/c", name: "X", language: "json" });
    expect(r1.artifactId).toBe("a-b-c.json");
    await expect(
      createArtifact(root, { resourceType: "SearchParameter", id: "a-b-c", name: "X", language: "json" }),
    ).rejects.toThrow(/already exists/);
  });
});
