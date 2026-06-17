import { describe, it, expect } from "vitest";
import { jsonAdapter } from "./json.js";
import { fshAdapter } from "./fsh.js";
import { xmlAdapter } from "./xml.js";
import { applyChanges, type LoadedSource } from "./types.js";
import type { Edit } from "@igb/shared";

function src(language: "json" | "fsh" | "xml", text: string): LoadedSource {
  return { id: "x." + language, filePath: "/x." + language, language, text };
}

const FSH = `Profile: MyPatient
Parent: Patient
Id: my-patient

* identifier 1..* MS
* identifier contains mrn 1..1
* name MS
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
      }
    ]
  }
}
`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<StructureDefinition xmlns="http://hl7.org/fhir">
  <name value="MyPatient"/>
  <type value="Patient"/>
  <derivation value="constraint"/>
  <differential>
    <element id="Patient.identifier">
      <path value="Patient.identifier"/>
      <min value="1"/>
      <max value="*"/>
    </element>
  </differential>
</StructureDefinition>
`;

describe("fsh slices & extensions", () => {
  it("renders existing slices from a contains rule", () => {
    const s = src("fsh", FSH);
    const view = fshAdapter.toProfileView(s, fshAdapter.describe(s)!)!;
    const base = view.elements.find((e) => e.path === "Patient.identifier" && !e.sliceName)!;
    expect(base.min).toBe(1); // base card not clobbered by the slice card
    const slice = view.elements.find((e) => e.sliceName === "mrn")!;
    expect(slice.min).toBe(1);
    expect(slice.max).toBe("1");
  });

  it("merges a new slice into an existing contains rule", () => {
    const s = src("fsh", FSH);
    const edit: Edit = {
      kind: "addSlice",
      artifactId: s.id,
      path: "Patient.identifier",
      sliceName: "ssn",
      min: 0,
      max: "1",
    };
    const out = applyChanges(FSH, fshAdapter.computeChanges(s, [edit]));
    expect(out).toContain("* identifier contains mrn 1..1 and ssn 0..1");
  });

  it("adds slicing setup + contains when none exists", () => {
    const s = src("fsh", FSH);
    const edit: Edit = {
      kind: "addSlice",
      artifactId: s.id,
      path: "Patient.name",
      sliceName: "official",
      min: 1,
      max: "1",
      discriminator: { type: "value", path: "use" },
    };
    const out = applyChanges(FSH, fshAdapter.computeChanges(s, [edit]));
    expect(out).toContain("^slicing.discriminator[0].type = #value");
    expect(out).toContain("* name contains official 1..1");
  });

  it("parses a contains rule whose extension is a bare URL (// not a comment)", () => {
    const text = `Profile: P
Parent: Patient
* extension contains http://example.org/StructureDefinition/bp named bp 0..1
`;
    const s = src("fsh", text);
    const view = fshAdapter.toProfileView(s, fshAdapter.describe(s)!)!;
    const slice = view.elements.find((e) => e.sliceName === "bp")!;
    expect(slice).toBeTruthy();
    expect(slice.extensionUrl).toBe("http://example.org/StructureDefinition/bp");
  });

  it("adds an extension usage", () => {
    const s = src("fsh", FSH);
    const edit: Edit = {
      kind: "addExtension",
      artifactId: s.id,
      path: "Patient",
      sliceName: "birthPlace",
      extensionName: "BirthPlaceExtension",
      extensionUrl: "http://hl7.org/fhir/StructureDefinition/patient-birthPlace",
      min: 0,
      max: "1",
    };
    const out = applyChanges(FSH, fshAdapter.computeChanges(s, [edit]));
    expect(out).toContain("* extension contains BirthPlaceExtension named birthPlace 0..1");
  });
});

describe("json slices & extensions", () => {
  it("adds a slice element and slicing header", () => {
    const s = src("json", JSON_SD);
    const edit: Edit = {
      kind: "addSlice",
      artifactId: s.id,
      path: "Patient.identifier",
      sliceName: "mrn",
      min: 1,
      max: "1",
      discriminator: { type: "pattern", path: "system" },
    };
    const out = applyChanges(JSON_SD, jsonAdapter.computeChanges(s, [edit]));
    const sd = JSON.parse(out);
    const els = sd.differential.element;
    const base = els.find((e: any) => e.path === "Patient.identifier" && !e.sliceName);
    expect(base.slicing.discriminator[0].path).toBe("system");
    const slice = els.find((e: any) => e.sliceName === "mrn");
    expect(slice.min).toBe(1);
    expect(slice.id).toBe("Patient.identifier:mrn");
  });

  it("adds an extension element with Extension type profile", () => {
    const s = src("json", JSON_SD);
    const edit: Edit = {
      kind: "addExtension",
      artifactId: s.id,
      path: "Patient",
      sliceName: "race",
      extensionUrl: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race",
      min: 0,
      max: "1",
    };
    const out = applyChanges(JSON_SD, jsonAdapter.computeChanges(s, [edit]));
    const sd = JSON.parse(out);
    const ext = sd.differential.element.find((e: any) => e.sliceName === "race");
    expect(ext.path).toBe("Patient.extension");
    expect(ext.type[0].code).toBe("Extension");
    expect(ext.type[0].profile[0]).toContain("us-core-race");
  });
});

describe("xml slices & extensions", () => {
  it("adds a slice element and slicing header", () => {
    const s = src("xml", XML);
    const edit: Edit = {
      kind: "addSlice",
      artifactId: s.id,
      path: "Patient.identifier",
      sliceName: "mrn",
      min: 1,
      max: "1",
      discriminator: { type: "pattern", path: "system" },
    };
    const out = applyChanges(XML, xmlAdapter.computeChanges(s, [edit]));
    expect(out).toContain("<slicing>");
    expect(out).toContain('<type value="pattern"/>');
    expect(out).toContain('<element id="Patient.identifier:mrn">');
    expect(out).toContain('<sliceName value="mrn"/>');
  });

  it("adds an extension element with Extension type profile", () => {
    const s = src("xml", XML);
    const edit: Edit = {
      kind: "addExtension",
      artifactId: s.id,
      path: "Patient",
      sliceName: "race",
      extensionUrl: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race",
      min: 0,
      max: "1",
    };
    const out = applyChanges(XML, xmlAdapter.computeChanges(s, [edit]));
    expect(out).toContain('<element id="Patient.extension:race">');
    expect(out).toContain('<code value="Extension"/>');
    expect(out).toContain("us-core-race");
    // differential remains closed and the new element precedes it
    expect(out.indexOf("Patient.extension:race")).toBeLessThan(out.indexOf("</differential>"));
  });
});
