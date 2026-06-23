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
    expect(art.editable).toBe(true);
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
    // The closing tag keeps its own line (no glued </element></differential>).
    expect(out).not.toContain("</element></differential>");
    expect(out).toContain("</element>\n  </differential>");
  });

  // ── Snapshot merge ────────────────────────────────────────────────

  const BASE_SNAP = [
    { id: "Encounter", path: "Encounter", short: "An interaction during which services are provided" },
    { id: "Encounter.id", path: "Encounter.id", short: "Logical id", min: 0, max: "1" },
    { id: "Encounter.status", path: "Encounter.status", short: "Base status", min: 1, max: "1",
      isSummary: true, isModifier: true, type: [{ code: "code" }] },
    { id: "Encounter.class", path: "Encounter.class", short: "Base class", min: 1, max: "1",
      isSummary: true, type: [{ code: "Coding" }] },
    { id: "Encounter.period", path: "Encounter.period", short: "The start and end time", min: 0, max: "1" },
    // Snapshot-generated slice copy — must be filtered out of depth-1 display
    { id: "Encounter.identifier:mySlice", path: "Encounter.identifier", sliceName: "mySlice" },
    // Deep element — must be filtered out
    { id: "Encounter.participant.individual", path: "Encounter.participant.individual" },
  ];

  it("merges baseSnapshotJson with the differential (XML source, no snapshot section)", () => {
    const s: LoadedSource = { ...src(XML), baseSnapshotJson: BASE_SNAP };
    const art = xmlAdapter.describe(s)!;
    const view = xmlAdapter.toProfileView(s, art)!;

    // Root element (depth-0) from snapshot should appear
    const root = view.elements.find((e) => e.path === "Encounter");
    expect(root).toBeDefined();

    // Differential element Encounter.status should override snapshot entry
    const status = view.elements.find((e) => e.path === "Encounter.status" && !e.sliceName)!;
    expect(status.inDifferential).toBe(true);
    expect(status.fromSnapshot).toBeUndefined();
    expect(status.min).toBe(1); // from the differential
    expect(status.max).toBe("1"); // from the differential

    // Snapshot-only element (Encounter.period) — inherited baseline
    const period = view.elements.find((e) => e.path === "Encounter.period")!;
    expect(period.inDifferential).toBe(false);
    expect(period.fromSnapshot).toBe(true);
    expect(period.short).toBe("The start and end time");

    // Encounter.id from snapshot — depth-1, no colon, should appear
    const id = view.elements.find((e) => e.id === "Encounter.id");
    expect(id).toBeDefined();
    expect(id!.fromSnapshot).toBe(true);

    // Snapshot-generated slice copy must NOT appear as a depth-1 row
    const sliceCopy = view.elements.find((e) => e.id === "Encounter.identifier:mySlice");
    expect(sliceCopy).toBeUndefined();

    // Deep element must NOT appear
    const deep = view.elements.find((e) => e.path === "Encounter.participant.individual");
    expect(deep).toBeUndefined();
  });

  it("differential elements not covered by depth-1 snapshot are appended (slices, nested)", () => {
    const XML_WITH_SLICE = `<StructureDefinition xmlns="http://hl7.org/fhir">
  <type value="Encounter"/>
  <name value="MyEnc"/>
  <differential>
    <element id="Encounter.identifier:mrn">
      <path value="Encounter.identifier"/>
      <sliceName value="mrn"/>
      <min value="1"/>
      <max value="1"/>
    </element>
  </differential>
</StructureDefinition>`;
    const s: LoadedSource = { ...src(XML_WITH_SLICE), baseSnapshotJson: BASE_SNAP };
    const art = xmlAdapter.describe(s)!;
    const view = xmlAdapter.toProfileView(s, art)!;

    // Slice (has colon in id) is NOT a depth-1 snapshot entry — appended as differential
    const slice = view.elements.find((e) => e.id === "Encounter.identifier:mrn")!;
    expect(slice).toBeDefined();
    expect(slice.inDifferential).toBe(true);
    expect(slice.sliceName).toBe("mrn");
    // It must come after the depth-1 snapshot entries
    const periodIdx = view.elements.findIndex((e) => e.path === "Encounter.period");
    const sliceIdx = view.elements.findIndex((e) => e.id === "Encounter.identifier:mrn");
    expect(sliceIdx).toBeGreaterThan(periodIdx);
  });

  it("falls back to differential-only when no snapshot and no baseSnapshotJson", () => {
    const s = src(XML);
    const art = xmlAdapter.describe(s)!;
    const view = xmlAdapter.toProfileView(s, art)!;

    expect(view.elements.every((e) => e.inDifferential)).toBe(true);
    expect(view.elements.every((e) => !e.fromSnapshot)).toBe(true);
    expect(view.elements).toHaveLength(2); // only the two differential elements
  });
});
