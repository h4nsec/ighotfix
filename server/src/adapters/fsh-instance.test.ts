import { describe, it, expect } from "vitest";
import { fshAdapter } from "./fsh.js";
import { instanceToObject } from "./fsh.js";
import { applyChanges, type LoadedSource } from "./types.js";
import type { Edit } from "@igb/shared";

function src(text: string): LoadedSource {
  return { id: "x.fsh", filePath: "/x.fsh", language: "fsh", text };
}
const setV = (path: string, value: any): Edit => ({ kind: "setValue", artifactId: "x", path, value });
const addV = (path: string, value: any): Edit => ({ kind: "addValue", artifactId: "x", path, value });
const rmV = (path: string): Edit => ({ kind: "removeValue", artifactId: "x", path });

const SP = `Instance: my-sp
InstanceOf: SearchParameter
Usage: #definition
* url = "http://example.org/SearchParameter/my-sp"
* name = "MySP"
* status = #draft
* code = #patient
* base[0] = #Observation
* base[1] = #Condition
* type = #reference
* expression = "Observation.subject"
`;

const CS = `Instance: my-cap
InstanceOf: CapabilityStatement
Usage: #definition
* status = #draft
* kind = #requirements
* rest[0].mode = #server
* rest[0].resource[0].type = #Patient
* rest[0].resource[0].interaction[0].code = #read
* rest[0].resource[0].searchParam[0].name = "identifier"
`;

describe("fsh instance classification + normalization", () => {
  it("classifies a SearchParameter instance via InstanceOf", () => {
    const art = fshAdapter.describe(src(SP))!;
    expect(art.resourceType).toBe("SearchParameter");
    expect(art.category).toBe("Capabilities");
    expect(art.name).toBe("MySP");
    expect(art.editable).toBe(false); // edited via the resource editor, not getProfile
  });

  it("normalizes assignment rules into an object", () => {
    const obj = instanceToObject(SP);
    expect(obj.resourceType).toBe("SearchParameter");
    expect(obj.status).toBe("draft");
    expect(obj.code).toBe("patient");
    expect(obj.base).toEqual(["Observation", "Condition"]);
    expect(obj.expression).toBe("Observation.subject");
  });

  it("normalizes nested CapabilityStatement rules", () => {
    const obj = instanceToObject(CS);
    expect(obj.rest[0].mode).toBe("server");
    expect(obj.rest[0].resource[0].type).toBe("Patient");
    expect(obj.rest[0].resource[0].interaction[0].code).toBe("read");
    expect(obj.rest[0].resource[0].searchParam[0].name).toBe("identifier");
  });
});

describe("fsh instance edits", () => {
  it("setValue replaces a code value preserving the # style", () => {
    const out = applyChanges(SP, fshAdapter.computeChanges(src(SP), [setV("status", "active")]));
    expect(out).toContain("* status = #active");
    expect(out).not.toContain("#draft");
  });

  it("setValue replaces a string value preserving quotes", () => {
    const out = applyChanges(SP, fshAdapter.computeChanges(src(SP), [setV("expression", "Observation.code")]));
    expect(out).toContain('* expression = "Observation.code"');
  });

  it("setValue appends a new rule when the field is absent", () => {
    const out = applyChanges(SP, fshAdapter.computeChanges(src(SP), [setV("derivedFrom", "http://x/sp")]));
    expect(out).toContain('* derivedFrom = "http://x/sp"');
  });

  it("addValue appends the next array index", () => {
    const out = applyChanges(SP, fshAdapter.computeChanges(src(SP), [addV("base", "Patient")]));
    expect(out).toContain("* base[2] = #Patient");
  });

  it("removeValue deletes an array element and re-indexes the rest", () => {
    const out = applyChanges(SP, fshAdapter.computeChanges(src(SP), [rmV("base[0]")]));
    expect(out).not.toContain("#Observation");
    expect(out).toContain("* base[0] = #Condition");
    expect(out).not.toContain("base[1]");
  });

  it("adds a nested object as flattened assignment rules", () => {
    const out = applyChanges(CS, fshAdapter.computeChanges(src(CS), [
      addV("rest[0].resource[0].interaction", { code: "create" }),
    ]));
    expect(out).toContain("* rest[0].resource[0].interaction[1].code = #create");
  });

  it("resolves soft indices ([+]/[=]) when normalizing", () => {
    const text = `Instance: c
InstanceOf: CapabilityStatement
* rest[0].mode = #server
* rest[0].resource[+].type = #Patient
* rest[0].resource[=].interaction[+].code = #read
* rest[0].resource[=].interaction[+].code = #search-type
* rest[0].resource[+].type = #Observation
`;
    const obj = instanceToObject(text);
    expect(obj.rest[0].resource[0].type).toBe("Patient");
    expect(obj.rest[0].resource[0].interaction.map((i: any) => i.code)).toEqual(["read", "search-type"]);
    expect(obj.rest[0].resource[1].type).toBe("Observation");
  });

  it("edits a soft-indexed array correctly (count + reindex)", () => {
    const text = `Instance: s
InstanceOf: SearchParameter
* base[+] = #Observation
* base[+] = #Condition
`;
    // addValue must append index 2 even though the source uses [+]
    const added = applyChanges(text, fshAdapter.computeChanges(src(text), [addV("base", "Patient")]));
    expect(added).toContain("* base[2] = #Patient");
    // removeValue targets the resolved index; soft-indexed siblings stay [+]
    const removed = applyChanges(text, fshAdapter.computeChanges(src(text), [rmV("base[0]")]));
    expect(removed).not.toContain("#Observation");
    expect(removed).toContain("* base[+] = #Condition"); // unchanged, auto-renumbers to 0
    expect(instanceToObject(removed).base).toEqual(["Condition"]);
  });

  it("removes a nested array element with its children", () => {
    const text = `Instance: c
InstanceOf: CapabilityStatement
* rest[0].resource[0].searchParam[0].name = "a"
* rest[0].resource[0].searchParam[1].name = "b"
* rest[0].resource[0].searchParam[1].type = #token
`;
    const out = applyChanges(text, fshAdapter.computeChanges(src(text), [rmV("rest[0].resource[0].searchParam[0]")]));
    expect(out).not.toContain('searchParam[0].name = "a"');
    expect(out).toContain('* rest[0].resource[0].searchParam[0].name = "b"');
    expect(out).toContain("* rest[0].resource[0].searchParam[0].type = #token");
  });
});
