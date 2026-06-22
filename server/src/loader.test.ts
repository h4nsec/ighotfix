import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadIg } from "./loader.js";

const dirs: string[] = [];
async function makeIg(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "igb-load-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

describe("loadIg surfaces all file types", () => {
  it("classifies FHIR resources and non-FHIR files", async () => {
    const root = await makeIg({
      "ig.ini": "[IG]\ntemplate = x\n",
      "sushi-config.yaml": "id: my.ig\n",
      "package-list.json": "{}\n",
      "input/pagecontent/index.md": "# Hello\n",
      "input/resources/profile.json": JSON.stringify({
        resourceType: "StructureDefinition",
        name: "MyProfile",
        type: "Patient",
        derivation: "constraint",
      }),
      "input/resources/sp.xml": `<?xml version="1.0"?>\n<SearchParameter xmlns="http://hl7.org/fhir"><name value="SP"/></SearchParameter>`,
      "notes.txt": "scratch\n",
    });

    const { artifacts } = await loadIg(root);
    const byId = new Map(artifacts.map((a) => [a.id, a]));

    expect(byId.get("ig.ini")?.category).toBe("Configuration");
    expect(byId.get("ig.ini")?.format).toBe("ini");
    expect(byId.get("ig.ini")?.resourceType).toBe("");
    expect(byId.get("sushi-config.yaml")?.format).toBe("yaml");
    expect(byId.get("package-list.json")?.category).toBe("Configuration");
    expect(byId.get("input/pagecontent/index.md")?.category).toBe("Pages");
    expect(byId.get("notes.txt")?.category).toBe("Other");

    // FHIR still recognised structurally.
    expect(byId.get("input/resources/profile.json")?.resourceType).toBe("StructureDefinition");
    expect(byId.get("input/resources/profile.json")?.category).toBe("Profiles");
    expect(byId.get("input/resources/sp.xml")?.resourceType).toBe("SearchParameter");
  });

  it("ignores build output and lockfiles", async () => {
    const root = await makeIg({
      "package-lock.json": "{}\n",
      "fsh-generated/resources/x.json": JSON.stringify({ resourceType: "ValueSet" }),
      "output/index.html": "<html></html>",
      "real.ini": "[x]\n",
    });
    const { artifacts } = await loadIg(root);
    const ids = artifacts.map((a) => a.id);
    expect(ids).toContain("real.ini");
    expect(ids).not.toContain("package-lock.json");
    expect(ids.some((i) => i.startsWith("fsh-generated/"))).toBe(false);
    expect(ids.some((i) => i.startsWith("output/"))).toBe(false);
  });
});
