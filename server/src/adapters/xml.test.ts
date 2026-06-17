import { describe, it, expect } from "vitest";
import { xmlAdapter } from "./xml.js";
import { applyChanges, type LoadedSource } from "./types.js";
import type { Edit } from "@igb/shared";

function src(text: string): LoadedSource {
  return { id: "x.xml", filePath: "/x.xml", language: "xml", text };
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<StructureDefinition xmlns="http://hl7.org/fhir">
  <id value="my-encounter"/>
  <name value="MyEncounter"/>
  <type value="Encounter"/>
  <derivation value="constraint"/>
  <differential>
    <element id="Encounter.status">
      <path value="Encounter.status"/>
      <min value="1"/>
      <max value="1"/>
    </element>
    <element id="Encounter.class">
      <path value="Encounter.class"/>
      <short value="Classification of patient encounter"/>
    </element>
  </differential>
</StructureDefinition>
`;

describe("xml adapter", () => {
  it("describes a StructureDefinition", () => {
    const art = xmlAdapter.describe(src(XML))!;
    expect(art.resourceType).toBe("StructureDefinition");
    expect(art.name).toBe("MyEncounter");
    expect(art.supported).toBe(true);
  });

  it("projects a profile view", () => {
    const s = src(XML);
    const art = xmlAdapter.describe(s)!;
    const view = xmlAdapter.toProfileView(s, art)!;
    expect(view.type).toBe("Encounter");
    const status = view.elements.find((e) => e.path === "Encounter.status")!;
    expect(status.min).toBe(1);
    expect(status.max).toBe("1");
  });

  it("edits an existing min in place, preserving formatting", () => {
    const s = src(XML);
    const edit: Edit = {
      kind: "setCardinality",
      artifactId: s.id,
      path: "Encounter.status",
      min: 0,
      max: "1",
    };
    const out = applyChanges(XML, xmlAdapter.computeChanges(s, [edit]));
    expect(out).toContain('<min value="0"/>');
    expect(out).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(out.split("\n").length).toBe(XML.split("\n").length);
  });

  it("inserts min/max on an element that lacks them, in canonical order", () => {
    const s = src(XML);
    const edit: Edit = {
      kind: "setCardinality",
      artifactId: s.id,
      path: "Encounter.class",
      min: 1,
      max: "1",
    };
    const out = applyChanges(XML, xmlAdapter.computeChanges(s, [edit]));
    // Canonical ElementDefinition order is path, short, …, min, max — so the
    // new min/max land after the existing <short>, and min before max.
    const classBlock = out.slice(out.indexOf("Encounter.class"));
    const pathIdx = classBlock.indexOf("<path");
    const shortIdx = classBlock.indexOf("<short");
    const minIdx = classBlock.indexOf("<min");
    const maxIdx = classBlock.indexOf("<max");
    expect(pathIdx).toBeLessThan(shortIdx);
    expect(shortIdx).toBeLessThan(minIdx);
    expect(minIdx).toBeLessThan(maxIdx);
    expect(out).toContain('<min value="1"/>');
  });

  it("inserts a binding block when none exists", () => {
    const s = src(XML);
    const edit: Edit = {
      kind: "setBinding",
      artifactId: s.id,
      path: "Encounter.class",
      valueSet: "http://example.org/ValueSet/enc-class",
      strength: "extensible",
    };
    const out = applyChanges(XML, xmlAdapter.computeChanges(s, [edit]));
    expect(out).toContain("<binding>");
    expect(out).toContain('<strength value="extensible"/>');
    expect(out).toContain('<valueSet value="http://example.org/ValueSet/enc-class"/>');
  });

  it("creates a new differential element when the path is absent", () => {
    const s = src(XML);
    const edit: Edit = {
      kind: "setCardinality",
      artifactId: s.id,
      path: "Encounter.period",
      min: 1,
      max: "1",
    };
    const out = applyChanges(XML, xmlAdapter.computeChanges(s, [edit]));
    expect(out).toContain('<element id="Encounter.period">');
    expect(out).toContain('<path value="Encounter.period"/>');
    expect(out).toContain('<min value="1"/>');
    // Still well-formed: differential close tag intact and after the new element.
    expect(out.indexOf("Encounter.period")).toBeLessThan(out.indexOf("</differential>"));
  });
});
