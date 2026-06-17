# IG Builder

A visual editor for FHIR Implementation Guides. Load an IG written in **FSH**, **JSON**, or **XML**, edit profiles, extensions, slices, cardinality, bindings, terminology, capability statements and search parameters in a visual UI, and write changes **back to the original source language** — without running a 45-minute IG Publisher build.

## Design principles

- **Format-preserving round-trip.** Edits are applied as surgical, minimal-diff splices to the original source text. Comments, ordering and whitespace are preserved. We never blindly regenerate the source.
- **Canonical model in the middle.** Each source language has an *adapter* that loads source → a canonical `ProfileView`/artifact model, and applies structured `Edit`s back to the precise text span in the source.
- **Local-first.** A small Node server provides filesystem access and parsing; a React client is the visual editor.

## Architecture

```
shared/   Canonical model + API contract types (shared by client & server)
server/   Express API: loads an IG directory, builds the model, applies edits
  src/adapters/   per-language load + edit (json, fsh, xml)
client/   Vite + React visual editor
fixtures/ Sample IG artifacts for development & tests
```

## v1 scope (current)

Load IG → parse StructureDefinitions (profiles) → edit element **cardinality** and **bindings** → write back to source, preserving formatting. JSON and FSH adapters first; XML next.

## Running

```
npm install
npm run dev        # starts server (4000) + client (5173)
```

Point the app at an IG folder (a directory of `.fsh`, `.json`, `.xml` artifacts).
