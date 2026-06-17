import type { SourceLanguage } from "@igb/shared";
import type { Adapter } from "./types.js";
import { jsonAdapter } from "./json.js";
import { fshAdapter } from "./fsh.js";
import { xmlAdapter } from "./xml.js";

export const adapters: Adapter[] = [jsonAdapter, fshAdapter, xmlAdapter];

export function adapterForExtension(ext: string): Adapter | undefined {
  return adapters.find((a) => a.extensions.includes(ext.toLowerCase()));
}

export function adapterForLanguage(lang: SourceLanguage): Adapter | undefined {
  return adapters.find((a) => a.language === lang);
}

export * from "./types.js";
