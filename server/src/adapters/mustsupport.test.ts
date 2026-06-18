import { describe, it, expect } from "vitest";
import { jsonAdapter } from "./json.js";
import { fshAdapter } from "./fsh.js";
import { xmlAdapter } from "./xml.js";
import { applyChanges, type LoadedSource } from "./types.js";
import type { Edit } from "@igb/shared";

function src(language: "json" | "fsh" | "xml", text: string): LoadedSource {
  return { id: "x." + language, filePath: "/x." + language, language, text };
}

const ms = (path: string, value: boolean): Edit => ({
  kind: "setMustSupport",
  artifactId: "x",
  path,
  value,
});

const FSH = `Profile: P
Parent: Patient
* identifier 1..* MS
* name 1..1
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
      { "id": "Patient.gender", "path": "Patient.gender", "mustSupport": true }
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
      <mustSupport value="true"/>
    </element>
  </differential>
</StructureDefinition>
`;

describe("fsh mustSupport", () => {
  it("reads MS flags", () => {
    const s = src("fsh", FSH);
    const view = fshAdapter.toProfileView(s, fshAdapter.describe(s)!)!;
    expect(view.elements.find((e) => e.path === "Patient.identifier")!.mustSupport).toBe(true);
    expect(view.elements.find((e) => e.path === "Patient.name")!.mustSupport).toBeFalsy();
  });

  it("adds MS onto the cardinality rule", () => {
    const out = applyChanges(FSH, fshAdapter.computeChanges(src("fsh", FSH), [ms("Patient.name", true)]));
    expect(out).toContain("* name 1..1 MS");
  });

  it("removes MS, leaving the rest of the rule intact", () => {
    const out = applyChanges(FSH, fshAdapter.computeChanges(src("fsh", FSH), [ms("Patient.identifier", false)]));
    expect(out).toContain("* identifier 1..*\n");
    expect(out).not.toContain("* identifier 1..* MS");
  });

  it("appends a new rule when the path has no rule yet", () => {
    const out = applyChanges(FSH, fshAdapter.computeChanges(src("fsh", FSH), [ms("Patient.birthDate", true)]));
    expect(out).toContain("* birthDate MS");
  });

  it("does not append onto a from-binding rule", () => {
    const out = applyChanges(FSH, fshAdapter.computeChanges(src("fsh", FSH), [ms("Patient.gender", true)]));
    expect(out).not.toContain("(required) MS");
    expect(out).toContain("* gender MS");
  });
});

describe("json mustSupport", () => {
  it("sets mustSupport true", () => {
    const out = applyChanges(JSON_SD, jsonAdapter.computeChanges(src("json", JSON_SD), [ms("Patient.name", true)]));
    expect(JSON.parse(out).differential.element[0].mustSupport).toBe(true);
  });

  it("removes mustSupport when cleared", () => {
    const out = applyChanges(JSON_SD, jsonAdapter.computeChanges(src("json", JSON_SD), [ms("Patient.gender", false)]));
    expect(JSON.parse(out).differential.element[1].mustSupport).toBeUndefined();
  });
});

describe("xml mustSupport", () => {
  it("inserts <mustSupport value=\"true\"/>", () => {
    const out = applyChanges(XML, xmlAdapter.computeChanges(src("xml", XML), [ms("Patient.name", true)]));
    expect(out).toContain('<mustSupport value="true"/>');
  });

  it("removes the <mustSupport> element when cleared", () => {
    const out = applyChanges(XML, xmlAdapter.computeChanges(src("xml", XML), [ms("Patient.gender", false)]));
    expect(out).not.toContain("<mustSupport");
    // Other content untouched and still well-formed.
    expect(out).toContain('<path value="Patient.gender"/>');
    expect(out).toContain("</StructureDefinition>");
  });
});
