import { describe, it, expect } from "vitest";
import { jsonAdapter } from "./json.js";
import { fshAdapter } from "./fsh.js";
import { applyChanges, type LoadedSource } from "./types.js";
import type { Edit } from "@igb/shared";

function src(language: "json" | "fsh", text: string): LoadedSource {
  return { id: "x." + language, filePath: "/x." + language, language, text };
}

const FSH = `// header comment
Profile: MyObservation
Parent: Observation
Id: my-observation
Title: "My Observation Profile"

* status 1..1 MS
* code 1..1
* code from MyObservationCodes (preferred)
* subject MS
`;

const JSON_SD = `{
  "resourceType": "StructureDefinition",
  "name": "MyPatient",
  "type": "Patient",
  "derivation": "constraint",
  "differential": {
    "element": [
      {
        "id": "Patient.identifier",
        "path": "Patient.identifier",
        "min": 1,
        "max": "*"
      },
      {
        "id": "Patient.gender",
        "path": "Patient.gender"
      }
    ]
  }
}
`;

describe("fsh adapter", () => {
  it("projects a profile view", () => {
    const s = src("fsh", FSH);
    const art = fshAdapter.describe(s)!;
    expect(art.editable).toBe(true);
    const view = fshAdapter.toProfileView(s, art)!;
    expect(view.name).toBe("MyObservation");
    expect(view.type).toBe("Observation");
    const status = view.elements.find((e) => e.path.endsWith("status"))!;
    expect(status.min).toBe(1);
    expect(status.max).toBe("1");
    const code = view.elements.find((e) => e.path.endsWith("code"))!;
    expect(code.binding?.valueSet).toBe("MyObservationCodes");
    expect(code.binding?.strength).toBe("preferred");
  });

  it("edits cardinality in place, preserving everything else", () => {
    const s = src("fsh", FSH);
    const edit: Edit = {
      kind: "setCardinality",
      artifactId: s.id,
      path: "Observation.status",
      min: 0,
      max: "1",
    };
    const changes = fshAdapter.computeChanges(s, [edit]);
    const out = applyChanges(FSH, changes);
    expect(out).toContain("* status 0..1 MS");
    // Comment + other lines untouched.
    expect(out).toContain("// header comment");
    expect(out).toContain("* code from MyObservationCodes (preferred)");
    expect(out.split("\n").length).toBe(FSH.split("\n").length);
  });

  it("inserts cardinality on a flags-only rule", () => {
    const s = src("fsh", FSH);
    const edit: Edit = {
      kind: "setCardinality",
      artifactId: s.id,
      path: "Observation.subject",
      min: 1,
      max: "1",
    };
    const out = applyChanges(FSH, fshAdapter.computeChanges(s, [edit]));
    expect(out).toContain("* subject 1..1 MS");
  });

  it("appends a new rule when the path has no rule yet", () => {
    const s = src("fsh", FSH);
    const edit: Edit = {
      kind: "setCardinality",
      artifactId: s.id,
      path: "Observation.value[x]",
      min: 1,
      max: "1",
    };
    const out = applyChanges(FSH, fshAdapter.computeChanges(s, [edit]));
    expect(out).toContain("* value[x] 1..1");
  });

  it("replaces a binding strength and value set", () => {
    const s = src("fsh", FSH);
    const edit: Edit = {
      kind: "setBinding",
      artifactId: s.id,
      path: "Observation.code",
      valueSet: "OtherCodes",
      strength: "required",
    };
    const out = applyChanges(FSH, fshAdapter.computeChanges(s, [edit]));
    expect(out).toContain("* code from OtherCodes (required)");
    expect(out).not.toContain("MyObservationCodes");
  });
});

describe("json adapter", () => {
  it("projects a profile view", () => {
    const s = src("json", JSON_SD);
    const art = jsonAdapter.describe(s)!;
    const view = jsonAdapter.toProfileView(s, art)!;
    expect(view.type).toBe("Patient");
    expect(view.elements[0].min).toBe(1);
  });

  it("edits cardinality preserving JSON formatting", () => {
    const s = src("json", JSON_SD);
    const edit: Edit = {
      kind: "setCardinality",
      artifactId: s.id,
      path: "Patient.identifier",
      min: 0,
      max: "1",
    };
    const out = applyChanges(JSON_SD, jsonAdapter.computeChanges(s, [edit]));
    const parsed = JSON.parse(out);
    expect(parsed.differential.element[0].min).toBe(0);
    expect(parsed.differential.element[0].max).toBe("1");
    // 2-space indentation preserved.
    expect(out).toContain('  "resourceType": "StructureDefinition"');
  });

  it("adds a binding object to an existing element", () => {
    const s = src("json", JSON_SD);
    const edit: Edit = {
      kind: "setBinding",
      artifactId: s.id,
      path: "Patient.gender",
      valueSet: "http://hl7.org/fhir/ValueSet/administrative-gender",
      strength: "required",
    };
    const out = applyChanges(JSON_SD, jsonAdapter.computeChanges(s, [edit]));
    const parsed = JSON.parse(out);
    expect(parsed.differential.element[1].binding.strength).toBe("required");
  });
});
