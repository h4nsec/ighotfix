import { describe, it, expect } from "vitest";
import { jsonAdapter } from "./json.js";
import type { LoadedSource } from "./types.js";

function src(text: string, baseSnapshotJson?: any[]): LoadedSource {
  return { id: "x.json", filePath: "/x.json", language: "json", text, baseSnapshotJson };
}

const DIFF_ONLY = JSON.stringify({
  resourceType: "StructureDefinition",
  name: "MyPatient",
  type: "Patient",
  derivation: "constraint",
  differential: {
    element: [
      { id: "Patient", path: "Patient", short: "AU patient" },
      { id: "Patient.birthDate", path: "Patient.birthDate", min: 1, max: "1" },
    ],
  },
});

const WITH_SNAPSHOT = JSON.stringify({
  resourceType: "StructureDefinition",
  name: "MyPatient",
  type: "Patient",
  derivation: "constraint",
  differential: {
    element: [
      { id: "Patient.birthDate", path: "Patient.birthDate", min: 1, max: "1" },
    ],
  },
  snapshot: {
    element: [
      { id: "Patient", path: "Patient", short: "Information about an individual" },
      { id: "Patient.id", path: "Patient.id", min: 0, max: "1" },
      { id: "Patient.name", path: "Patient.name", min: 0, max: "*", isSummary: true },
      { id: "Patient.birthDate", path: "Patient.birthDate", min: 0, max: "1", isSummary: true },
      { id: "Patient.address", path: "Patient.address", min: 0, max: "*" },
      // Deep element — must not appear at depth-1
      { id: "Patient.name.family", path: "Patient.name.family", min: 0, max: "1" },
      // Snapshot-generated slice copy — must not appear at depth-1
      { id: "Patient.identifier:medicare", path: "Patient.identifier", sliceName: "medicare" },
    ],
  },
});

const BASE_SNAP = [
  { id: "Patient", path: "Patient", short: "Information about an individual" },
  { id: "Patient.id", path: "Patient.id", min: 0, max: "1" },
  { id: "Patient.name", path: "Patient.name", isSummary: true, type: [{ code: "HumanName" }] },
  { id: "Patient.birthDate", path: "Patient.birthDate", isSummary: true, type: [{ code: "date" }] },
  { id: "Patient.address", path: "Patient.address", type: [{ code: "Address" }] },
  // Deep — filtered
  { id: "Patient.name.family", path: "Patient.name.family" },
  // Snapshot slice copy — filtered (has ':' in id)
  { id: "Patient.identifier:mrn", path: "Patient.identifier", sliceName: "mrn" },
];

describe("json adapter – toProfileView", () => {
  it("differential-only: all elements marked inDifferential, no fromSnapshot", () => {
    const art = jsonAdapter.describe(src(DIFF_ONLY))!;
    const view = jsonAdapter.toProfileView(src(DIFF_ONLY), art)!;
    expect(view.elements).toHaveLength(2);
    expect(view.elements.every((e) => e.inDifferential)).toBe(true);
    expect(view.elements.every((e) => !e.fromSnapshot)).toBe(true);
  });

  it("own snapshot: differential overrides snapshot entry; snapshot-only elements get fromSnapshot", () => {
    const s = src(WITH_SNAPSHOT);
    const art = jsonAdapter.describe(s)!;
    const view = jsonAdapter.toProfileView(s, art)!;

    // birthDate is in both diff and snapshot — diff wins
    const bd = view.elements.find((e) => e.path === "Patient.birthDate")!;
    expect(bd.inDifferential).toBe(true);
    expect(bd.fromSnapshot).toBeUndefined();
    expect(bd.min).toBe(1); // differential value

    // name is snapshot-only
    const name = view.elements.find((e) => e.path === "Patient.name")!;
    expect(name.inDifferential).toBe(false);
    expect(name.fromSnapshot).toBe(true);

    // Deep element must not appear
    expect(view.elements.find((e) => e.path === "Patient.name.family")).toBeUndefined();
    // Snapshot slice copy must not appear
    expect(view.elements.find((e) => e.id === "Patient.identifier:medicare")).toBeUndefined();
  });

  it("baseSnapshotJson fallback: same merge when source has no snapshot", () => {
    const s = src(DIFF_ONLY, BASE_SNAP);
    const art = jsonAdapter.describe(s)!;
    const view = jsonAdapter.toProfileView(s, art)!;

    // Patient root from snapshot appears first
    const root = view.elements.find((e) => e.id === "Patient")!;
    expect(root.inDifferential).toBe(true); // diff has it
    expect(view.elements[0].id).toBe("Patient");

    // birthDate: in diff — inDifferential true
    const bd = view.elements.find((e) => e.path === "Patient.birthDate")!;
    expect(bd.inDifferential).toBe(true);
    expect(bd.fromSnapshot).toBeUndefined();
    expect(bd.min).toBe(1);

    // address: snapshot-only
    const addr = view.elements.find((e) => e.path === "Patient.address")!;
    expect(addr.inDifferential).toBe(false);
    expect(addr.fromSnapshot).toBe(true);
    expect(addr.types).toEqual(["Address"]);

    // Deep and slice-copy must not appear
    expect(view.elements.find((e) => e.path === "Patient.name.family")).toBeUndefined();
    expect(view.elements.find((e) => e.id === "Patient.identifier:mrn")).toBeUndefined();
  });

  it("uncovered differential slices are appended after snapshot entries", () => {
    const WITH_SLICE = JSON.stringify({
      resourceType: "StructureDefinition",
      name: "MyP",
      type: "Patient",
      derivation: "constraint",
      differential: {
        element: [
          { id: "Patient.identifier:mrn", path: "Patient.identifier", sliceName: "mrn", min: 1, max: "1" },
        ],
      },
    });
    const s = src(WITH_SLICE, BASE_SNAP);
    const art = jsonAdapter.describe(s)!;
    const view = jsonAdapter.toProfileView(s, art)!;

    const addrIdx = view.elements.findIndex((e) => e.path === "Patient.address");
    const sliceIdx = view.elements.findIndex((e) => e.id === "Patient.identifier:mrn");
    expect(sliceIdx).toBeGreaterThan(addrIdx);
    expect(view.elements[sliceIdx].inDifferential).toBe(true);
    expect(view.elements[sliceIdx].sliceName).toBe("mrn");
  });
});
