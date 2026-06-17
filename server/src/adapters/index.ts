import type { SourceLanguage } from "@igb/shared";
import type { Adapter } from "./types.js";
import { jsonAdapter } from "./json.js";
import { fshAdapter } from "./fsh.js";

export const adapters: Adapter[] = [jsonAdapter, fshAdapter];

export function adapterForExtension(ext: string): Adapter | undefined {
  return adapters.find((a) => a.extensions.includes(ext.toLowerCase()));
}

export function adapterForLanguage(lang: SourceLanguage): Adapter | undefined {
  return adapters.find((a) => a.language === lang);
}

export * from "./types.js";
