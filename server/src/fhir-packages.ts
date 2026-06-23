import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

/** Session-level cache: `null` means resolved but not found. */
const memCache = new Map<string, any[] | null>();

/**
 * Return snapshot.element[] for a FHIR base type (e.g. "Endpoint").
 * Tries the local ~/.fhir/packages cache first, then fetches from the
 * HL7 FHIR R4 spec site. Returns null when unavailable (no crash).
 */
export async function resolveBaseSnapshot(type: string): Promise<any[] | null> {
  if (memCache.has(type)) return memCache.get(type)!;
  const result = (await tryPackageCache(type)) ?? (await tryFetch(type));
  memCache.set(type, result);
  return result;
}

async function tryPackageCache(type: string): Promise<any[] | null> {
  const cacheDir = join(os.homedir(), ".fhir", "packages");
  let dirs: string[];
  try {
    dirs = await readdir(cacheDir);
  } catch {
    return null;
  }
  const sorted = [...dirs].sort((a, b) => {
    const rank = (s: string) =>
      s.startsWith("hl7.fhir.r4.core") ? 0 : s.startsWith("hl7.fhir.r4b.core") ? 1 : 2;
    return rank(a) - rank(b);
  });
  for (const pkg of sorted) {
    try {
      const text = await readFile(
        join(cacheDir, pkg, "package", `StructureDefinition-${type}.json`),
        "utf8",
      );
      const sd = JSON.parse(text);
      if (Array.isArray(sd.snapshot?.element)) return sd.snapshot.element;
    } catch { /* try next package */ }
  }
  return null;
}

async function tryFetch(type: string): Promise<any[] | null> {
  // Try HL7 FHIR R4 spec; fall back to the HAPI public test server.
  const urls = [
    `https://hl7.org/fhir/R4/${type}.profile.json`,
    `https://hapi.fhir.org/baseR4/StructureDefinition/${type}`,
  ];
  for (const url of urls) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { Accept: "application/fhir+json, application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const sd = (await res.json()) as any;
      if (Array.isArray(sd.snapshot?.element)) return sd.snapshot.element;
    } catch { /* try next URL */ }
  }
  return null;
}
