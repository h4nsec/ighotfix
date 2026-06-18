import { describe, it, expect } from "vitest";
import { jsonAdapter } from "./json.js";
import { xmlAdapter } from "./xml.js";
import { applyChanges, type LoadedSource } from "./types.js";
import type { Edit } from "@igb/shared";

function src(language: "json" | "xml", text: string): LoadedSource {
  return { id: "x." + language, filePath: "/x." + language, language, text };
}

const setV = (path: string, value: any): Edit => ({ kind: "setValue", artifactId: "x", path, value });
const addV = (path: string, value: any): Edit => ({ kind: "addValue", artifactId: "x", path, value });
const rmV = (path: string): Edit => ({ kind: "removeValue", artifactId: "x", path });

const JSON_SP = `{
  "resourceType": "SearchParameter",
  "name": "MySP",
  "status": "draft",
  "code": "patient",
  "base": [
    "Observation",
    "Condition"
  ],
  "type": "reference",
  "expression": "Observation.subject"
}
`;

const XML_SP = `<?xml version="1.0" encoding="UTF-8"?>
<SearchParameter xmlns="http://hl7.org/fhir">
  <name value="MySP"/>
  <status value="draft"/>
  <code value="patient"/>
  <base value="Observation"/>
  <base value="Condition"/>
  <type value="reference"/>
  <expression value="Observation.subject"/>
</SearchParameter>
`;

describe("json generic value edits", () => {
  it("sets a scalar in place", () => {
    const out = applyChanges(JSON_SP, jsonAdapter.computeChanges(src("json", JSON_SP), [setV("status", "active")]));
    expect(JSON.parse(out).status).toBe("active");
    expect(out).toContain('  "name": "MySP"'); // formatting preserved
  });

  it("appends to an array", () => {
    const out = applyChanges(JSON_SP, jsonAdapter.computeChanges(src("json", JSON_SP), [addV("base", "Patient")]));
    expect(JSON.parse(out).base).toEqual(["Observation", "Condition", "Patient"]);
  });

  it("removes an array element by index", () => {
    const out = applyChanges(JSON_SP, jsonAdapter.computeChanges(src("json", JSON_SP), [rmV("base[0]")]));
    expect(JSON.parse(out).base).toEqual(["Condition"]);
  });

  it("removes a scalar property", () => {
    const out = applyChanges(JSON_SP, jsonAdapter.computeChanges(src("json", JSON_SP), [rmV("expression")]));
    expect(JSON.parse(out).expression).toBeUndefined();
  });
});

describe("xml generic value edits", () => {
  it("sets a scalar value attribute in place", () => {
    const out = applyChanges(XML_SP, xmlAdapter.computeChanges(src("xml", XML_SP), [setV("status", "active")]));
    expect(out).toContain('<status value="active"/>');
    expect(out).toContain('<name value="MySP"/>');
  });

  it("appends a repeated element", () => {
    const out = applyChanges(XML_SP, xmlAdapter.computeChanges(src("xml", XML_SP), [addV("base", "Patient")]));
    expect((out.match(/<base /g) ?? []).length).toBe(3);
    expect(out).toContain('<base value="Patient"/>');
    // New base lands after the existing bases.
    expect(out.indexOf('value="Patient"')).toBeGreaterThan(out.indexOf('value="Condition"'));
  });

  it("removes a repeated element by index", () => {
    const out = applyChanges(XML_SP, xmlAdapter.computeChanges(src("xml", XML_SP), [rmV("base[0]")]));
    expect((out.match(/<base /g) ?? []).length).toBe(1);
    expect(out).not.toContain('<base value="Observation"/>');
    expect(out).toContain('<base value="Condition"/>');
  });

  it("removes a scalar element", () => {
    const out = applyChanges(XML_SP, xmlAdapter.computeChanges(src("xml", XML_SP), [rmV("expression")]));
    expect(out).not.toContain("<expression");
    expect(out).toContain("</SearchParameter>");
  });

  it("adds a nested object item", () => {
    const out = applyChanges(
      XML_SP,
      xmlAdapter.computeChanges(src("xml", XML_SP), [addV("comparator", "eq")]),
    );
    expect(out).toContain('<comparator value="eq"/>');
  });
});

const XML_CS = `<?xml version="1.0" encoding="UTF-8"?>
<CapabilityStatement xmlns="http://hl7.org/fhir">
  <status value="draft"/>
  <rest>
    <mode value="server"/>
    <resource>
      <type value="Patient"/>
      <interaction>
        <code value="read"/>
      </interaction>
    </resource>
  </rest>
</CapabilityStatement>
`;

const JSON_CS = `{
  "resourceType": "CapabilityStatement",
  "status": "draft",
  "rest": [
    {
      "mode": "server",
      "resource": [
        { "type": "Patient", "interaction": [ { "code": "read" } ] }
      ]
    }
  ]
}
`;

describe("deep-path nested edits (CapabilityStatement shape)", () => {
  it("xml: adds a nested interaction object", () => {
    const out = applyChanges(
      XML_CS,
      xmlAdapter.computeChanges(src("xml", XML_CS), [addV("rest[0].resource[0].interaction", { code: "create" })]),
    );
    expect(out).toContain("<interaction>");
    expect(out).toContain('<code value="create"/>');
    expect((out.match(/<interaction>/g) ?? []).length).toBe(2);
  });

  it("xml: removes a nested interaction by index", () => {
    const out = applyChanges(
      XML_CS,
      xmlAdapter.computeChanges(src("xml", XML_CS), [rmV("rest[0].resource[0].interaction[0]")]),
    );
    expect(out).not.toContain('<code value="read"/>');
    expect(out).toContain("<type value=\"Patient\"/>");
  });

  it("xml: sets a deep scalar", () => {
    const out = applyChanges(
      XML_CS,
      xmlAdapter.computeChanges(src("xml", XML_CS), [setV("rest[0].resource[0].profile", "http://x/p")]),
    );
    expect(out).toContain('<profile value="http://x/p"/>');
  });

  it("json: adds and removes nested interactions", () => {
    const added = applyChanges(
      JSON_CS,
      jsonAdapter.computeChanges(src("json", JSON_CS), [addV("rest[0].resource[0].interaction", { code: "create" })]),
    );
    expect(JSON.parse(added).rest[0].resource[0].interaction.map((i: any) => i.code)).toEqual(["read", "create"]);
    const removed = applyChanges(
      JSON_CS,
      jsonAdapter.computeChanges(src("json", JSON_CS), [rmV("rest[0].resource[0].interaction[0]")]),
    );
    expect(JSON.parse(removed).rest[0].resource[0].interaction).toEqual([]);
  });
});
