# IG Builder

A local visual editor for [FHIR Implementation Guides](https://www.hl7.org/fhir/implementationguide.html) that writes changes back to your original source files — without regenerating them.

IG Publisher builds take 45 minutes. IG Builder lets you edit profiles, terminology, capability statements, and guide metadata in a browser UI and saves the result as a surgical splice of the source text, preserving comments, ordering, and whitespace.

---

## Features

### Profile & Extension Editing
- Browse every StructureDefinition (profile or extension) in the IG
- Edit element cardinality, value-set bindings, and boolean flags (MS / SU / ?!) per element
- Add elements from the base type that aren't yet in the differential
- Add named slices and extension usages with discriminators
- Snapshot-aware view — toggle between key elements, differential-only, or full snapshot

### Terminology
- Structured editor for **ValueSet** — metadata, compose includes, and explicit concept lists
- Structured editor for **CodeSystem** — metadata, content type, case sensitivity, and the full concept table (code / display / definition) with add and remove
- Filter-based includes show a read-only hint; switch to the raw source editor for those

### Capability Statements
- REST resource matrix: profile, interactions (toggles), and search parameters
- **SHALL / SHOULD / MAY / SHOULD-NOT** conformance on both interactions and search params via the `capabilitystatement-expectation` extension
- Per-interaction and per-search-param documentation fields

### Implementation Guide Metadata
- Metadata fields: id, version, FHIR version, publisher, license, description
- Dependency table (`dependsOn`), build parameters
- Filterable resource definition table (handles hundreds of entries)
- Recursive page tree with title and generation type

### Source Round-Trip — All Three Languages
Every edit is a precise text splice; the original file is never regenerated.

| Language | Mechanism |
|----------|-----------|
| **FSH** | Offset-tracking rule locator; surgical line splice; `://`-safe comment stripping; soft-index (`[+]` / `[=]`) resolution |
| **JSON** | `jsonc-parser` minimal-diff; comments and formatting preserved |
| **XML** | Dependency-free position-tracking scanner; canonical ElementDefinition child order; `url`-as-attribute extension convention |

FSH conformance resources (`Instance: … InstanceOf: SearchParameter`) are normalised to objects and edited through the same assignment-rule engine, preserving `#code` vs `"string"` value styles and reindexing sibling array elements on remove.

### All File Types
The sidebar surfaces every file in an IG folder — FSH, JSON, XML, Markdown pages, `sushi-config.yaml`, `ig.ini`, `package.json`, `menu.xml`. Every artifact has at least a raw source editor; FHIR resources with a structured editor offer a toggle between the two views.

### Git Integration
- Branch chip in the top bar — current branch name and dirty indicator
- **Git panel**: init repo, switch / create branches, selective file staging, commit staged changes, coloured unified diff, commit log
- **Clone from remote**: streams NDJSON progress to a progress bar; real cancel kills the process tree and removes the partial clone; public repos only (private repos that need a credential prompt fail fast rather than hanging)

### Folder Browser
Native-style folder picker with breadcrumb navigation, drive listing on Windows, and IG-marker highlighting (detects `sushi-config.yaml`, `ig.ini`, `package.json`).

---

## Getting Started

**Prerequisites:** Node.js 18+ and npm 8+.

```bash
git clone <repo-url>
cd ig-builder
npm install
npm run dev
```

| Service | URL |
|---------|-----|
| Client (Vite + React) | http://localhost:5173 |
| Server (Express API) | http://localhost:4000 |

Open the client, enter the path to your IG root folder (or use **Browse…**), and click **Load IG**. The last-used path is remembered in `localStorage`.

---

## Project Structure

```
ig-builder/
├── shared/              # @igb/shared — canonical model, Edit types, path parser
│   └── src/index.ts
├── server/              # Express API — file I/O, adapters, git wrapper
│   └── src/
│       ├── adapters/
│       │   ├── fsh.ts        # FSH adapter + Instance normaliser
│       │   ├── json.ts       # JSON adapter (jsonc-parser)
│       │   ├── xml.ts        # XML adapter (xml-scan.ts scanner)
│       │   └── *.test.ts     # 78 vitest round-trip tests
│       ├── loader.ts         # IG discovery & classification
│       ├── resource.ts       # ResourceView builder
│       ├── git.ts            # Git CLI wrapper
│       ├── create.ts         # New-artifact scaffolding (SP / CS skeletons)
│       └── browse.ts         # Folder browser API
└── client/              # Vite + React + TypeScript UI
    └── src/
        ├── App.tsx                       # Shell, sidebar, ProfileEditor
        ├── CapabilityStatementEditor.tsx
        ├── ImplementationGuideEditor.tsx
        ├── SearchParameterEditor.tsx
        ├── TerminologyEditor.tsx         # ValueSet + CodeSystem
        ├── TextEditor.tsx                # Raw source fallback
        ├── ResourceViewer.tsx            # Read-only resource sections
        ├── GitPanel.tsx
        ├── CloneDialog.tsx
        └── FolderPicker.tsx
```

---

## Architecture

### Edit Engine

The shared `Edit` union type is source-language agnostic. Each adapter implements three methods:

```typescript
describe(src)                → Artifact       // classify the file
toProfileView(src, artifact) → ProfileView    // StructureDefinition only
computeChanges(src, edits)   → TextChange[]  // precise text splices
```

Generic path-based edits (`setValue`, `addValue`, `removeValue`) address any FHIR element by a dot-path with `[n]` array indices — e.g. `rest[0].resource[2].interaction[1].code`. All three adapters implement this for arbitrary resource shapes. The structured editors are pure React UI over the same engine: they emit `Edit[]` objects; the server splices them into the source text.

### Pending Edit Flow

```
User action → Edit queued in client state
           → Pending bar shows "N unsaved change(s)"
           → POST /api/edits { edits, write: true }
           → Server applies batch to source text → writes to disk
           → Client reloads the artifact view
```

Repeated `setValue` edits to the same path are collapsed so only the latest value is sent. The UI reflects pending edits immediately via `valueOf` helpers that walk the pending queue before falling back to the base data.

---

## Commands

```bash
# Start both server and client in watch mode
npm run dev

# Run the server test suite (78 tests)
npm test

# Type-check the client
cd client && npx tsc --noEmit

# Production build (shared → server → client)
npm run build
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Client | React 18, TypeScript, Vite 6, Lucide React |
| Server | Node.js, Express 4, `jsonc-parser`, `fast-glob`, `tsx` |
| Tests | Vitest |
| Monorepo | npm workspaces (`shared`, `server`, `client`) |

---

## Limitations

- **No push / pull** — clone and local commits only; use your normal git client for remote operations.
- **Private repos** — clone inherits your system git credentials (Credential Manager, Keychain, SSH keys, stored PATs), so repos you've already authenticated will work. Repos with no stored credentials fail fast rather than hanging (`GIT_TERMINAL_PROMPT=0`).
- **Snapshot generation** — the snapshot view reads pre-built snapshot JSON if present alongside the source; it does not invoke IG Publisher to build one.
- **Terminology filters** — ValueSet includes that use `filter` rules are read-only in the structured editor; edit them in the raw source view.
- **FSH profiles** — generic path edits (`setValue` / `addValue` / `removeValue`) target `Instance:` entities. `Profile:` and `Extension:` FSH entities use the rule-based editor for cardinality, bindings, flags, slices, and extensions.
