import type {
  ApplyEditsRequest,
  Edit,
  EditResult,
  IgSummary,
  ProfileView,
  ResourceView,
} from "@igb/shared";

async function jpost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.json();
}

export function loadIg(root: string): Promise<IgSummary> {
  return jpost<IgSummary>("/api/load", { root });
}

export interface BrowseDir {
  name: string;
  path: string;
  igMarkers: string[];
}
export interface BrowseResult {
  path: string;
  parent: string | null;
  sep: string;
  dirs: BrowseDir[];
  fileCounts: { fsh: number; json: number; xml: number };
  igMarkers: string[];
}

export async function browse(path: string): Promise<BrowseResult> {
  const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.json();
}

export async function getHome(): Promise<string> {
  const res = await fetch("/api/home");
  return (await res.json()).home;
}

export interface CreateArtifactRequest {
  resourceType: "SearchParameter" | "CapabilityStatement";
  id: string;
  name: string;
  language: "json" | "xml" | "fsh";
  dir?: string;
  canonicalBase?: string;
}

export function createArtifact(req: CreateArtifactRequest): Promise<{ artifactId: string }> {
  return jpost<{ artifactId: string }>("/api/create", req);
}

/* ---------------- git ---------------- */

export interface GitFile {
  path: string;
  code: string;
  staged: boolean;
  label: string;
}
export interface GitStatus {
  isRepo: boolean;
  root?: string;
  branch?: string;
  ahead?: number;
  behind?: number;
  hasRemote?: boolean;
  clean?: boolean;
  files?: GitFile[];
  detached?: boolean;
  gitMissing?: boolean;
}
export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}
export interface GitOpResult {
  ok: boolean;
  output: string;
}

async function jget<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.json();
}

export const gitStatus = () => jget<GitStatus>("/api/git/status");
export const gitBranches = () => jget<{ current: string; branches: string[] }>("/api/git/branches");
export const gitLog = (n = 25) => jget<GitCommit[]>(`/api/git/log?n=${n}`);
export const gitDiff = (file?: string) =>
  jget<{ diff: string }>(`/api/git/diff${file ? `?file=${encodeURIComponent(file)}` : ""}`);

export const gitInit = () => jpost<GitOpResult>("/api/git/init", {});
export const gitCommit = (message: string) => jpost<GitOpResult>("/api/git/commit", { message });
export const gitCreateBranch = (name: string, checkout: boolean) =>
  jpost<GitOpResult>("/api/git/branch", { name, checkout });
export const gitCheckout = (name: string) => jpost<GitOpResult>("/api/git/checkout", { name });
export const gitStage = (paths: string[]) => jpost<GitOpResult>("/api/git/stage", { paths });
export const gitUnstage = (paths: string[]) => jpost<GitOpResult>("/api/git/unstage", { paths });
export const gitStageAll = () => jpost<GitOpResult>("/api/git/stageAll", {});
export const gitUnstageAll = () => jpost<GitOpResult>("/api/git/unstageAll", {});
export const gitClone = (url: string, parent: string) =>
  jpost<GitOpResult & { path?: string }>("/api/git/clone", { url, parent });

export async function getProfile(artifactId: string): Promise<ProfileView> {
  const res = await fetch(`/api/profile?artifactId=${encodeURIComponent(artifactId)}`);
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.json();
}

export async function getResource(artifactId: string): Promise<ResourceView> {
  const res = await fetch(`/api/resource?artifactId=${encodeURIComponent(artifactId)}`);
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.json();
}

export function applyEdits(
  artifactId: string,
  edits: Edit[],
  write: boolean,
): Promise<EditResult> {
  const body: ApplyEditsRequest = { artifactId, edits, write };
  return jpost<EditResult>("/api/edits", body);
}
