import { describe, it, expect } from "vitest";
import { jsonAdapter } from "./json.js";
import { fshAdapter } from "./fsh.js";
import { xmlAdapter } from "./xml.js";
import { applyChanges, type LoadedSource } from "./types.js";
import type { Edit, ElementFlag } from "@igb/shared";

function src(language: "json" | "fsh" | "xml", text: string): LoadedSource {
  return { id: "x." + language, filePath: "/x." + language, language, text };
}

const flag = (path: string, f: ElementFlag, value: boolean): Edit => ({
  kind: "setFlag",
  artifactId: "x",
  path,
  flag: f,
  value,
});

const FSH = `Profile: P
Parent: Patient
* identifier 1..* MS
* name 1..1 SU
* active ?!
* gender from G (required)
`;

const JSON_SD = `{
  "resourceType": "StructureDefinition",
  "name": "P",
  "type": "Patient",
  "derivation": "constraint",
  "differential": {
    "element": [
      { "id": "Patient.name", "path": "Patient.name", "min": 1, "max": "1" },
      { "id": "Patient.gender", "path": "Patient.gender", "mustSupport": true, "isSummary": true }
    ]
  }
}
`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<StructureDefinition xmlns="http://hl7.org/fhir">
  <name value="P"/>
  <type value="Patient"/>
  <derivation value="constraint"/>
  <differential>
    <element id="Patient.name">
      <path value="Patient.name"/>
      <min value="1"/>
      <max value="1"/>
    </element>
    <element id="Patient.gender">
      <path value="Patient.gender"/>
      <isSummary value="true"/>
    </element>
  </differential>
</StructureDefinition>
`;

describe("fsh flags", () => {
  it("reads MS / SU / ?! flags", () => {
    const s = src("fsh", FSH);
    const view = fshAdapter.toProfileView(s, fshAdapter.describe(s)!)!;
    const ident = view.elements.find((e) => e.path === "Patient.identifier")!;
    const name = view.elements.find((e) => e.path === "Patient.name")!;
    const active = view.elements.find((e) => e.path === "Patient.active")!;
    expect(ident.mustSupport).toBe(true);
    expect(name.isSummary).toBe(true);
    expect(active.isModifier).toBe(true);
  });

  it("adds SU as a new rule when only a from-binding rule exists", () => {
    const out = applyChanges(FSH, fshAdapter.computeChanges(src("fsh", FSH), [flag("Patient.gender", "isSummary", true)]));
    expect(out).toContain("* gender SU");
    expect(out).not.toContain("(required) SU");
  });

  it("adds ?! (isModifier) onto an existing rule", () => {
    const out = applyChanges(FSH, fshAdapter.computeChanges(src("fsh", FSH), [flag("Patient.name", "isModifier", true)]));
    expect(out).toContain("* name 1..1 SU ?!");
  });

  it("removes a flag, leaving the rest of the rule intact", () => {
    const out = applyChanges(FSH, fshAdapter.computeChanges(src("fsh", FSH), [flag("Patient.identifier", "mustSupport", false)]));
    expect(out).toContain("* identifier 1..*\n");
    expect(out).not.toContain("1..* MS");
  });

  it("removes ?! cleanly", () => {
    const out = applyChanges(FSH, fshAdapter.computeChanges(src("fsh", FSH), [flag("Patient.active", "isModifier", false)]));
    expect(out).toContain("* active\n");
    expect(out).not.toContain("active ?!");
  });
});

describe("json flags", () => {
  it("sets isSummary true", () => {
    const out = applyChanges(JSON_SD, jsonAdapter.computeChanges(src("json", JSON_SD), [flag("Patient.name", "isSummary", true)]));
    expect(JSON.parse(out).differential.element[0].isSummary).toBe(true);
  });

  it("clears one flag without touching the other", () => {
    const out = applyChanges(JSON_SD, jsonAdapter.computeChanges(src("json", JSON_SD), [flag("Patient.gender", "mustSupport", false)]));
    const gender = JSON.parse(out).differential.element[1];
    expect(gender.mustSupport).toBeUndefined();
    expect(gender.isSummary).toBe(true);
  });

  it("reads flags into the view", () => {
    const s = src("json", JSON_SD);
    const view = jsonAdapter.toProfileView(s, jsonAdapter.describe(s)!)!;
    const gender = view.elements.find((e) => e.path === "Patient.gender")!;
    expect(gender.mustSupport).toBe(true);
    expect(gender.isSummary).toBe(true);
  });
});

describe("xml flags", () => {
  it("inserts isModifier in canonical order (before isSummary)", () => {
    const out = applyChanges(XML, xmlAdapter.computeChanges(src("xml", XML), [flag("Patient.gender", "isModifier", true)]));
    const g = out.slice(out.indexOf("Patient.gender"));
    expect(g.indexOf("<isModifier")).toBeGreaterThan(-1);
    expect(g.indexOf("<isModifier")).toBeLessThan(g.indexOf("<isSummary"));
  });

  it("removes a flag element when cleared", () => {
    const out = applyChanges(XML, xmlAdapter.computeChanges(src("xml", XML), [flag("Patient.gender", "isSummary", false)]));
    expect(out).not.toContain("<isSummary");
    expect(out).toContain('<path value="Patient.gender"/>');
  });
});
