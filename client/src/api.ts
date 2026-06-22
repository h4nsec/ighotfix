import type {
  ApplyEditsRequest,
  Edit,
  EditResult,
  IgSummary,
  ProfileView,
  ResourceView,
} from "@igb/shared";

/** Extract a human-readable error message from a failed response. */
async function errorFrom(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error) return String(data.error);
  } catch {
    // Not JSON (e.g. a proxy error page) — fall through.
  }
  if (res.status === 0 || res.status >= 500) {
    return `Server error (${res.status}). Is the backend running?`;
  }
  return res.statusText || `Request failed (${res.status}).`;
}

async function jpost<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the server. Make sure the backend is running.");
  }
  if (!res.ok) throw new Error(await errorFrom(res));
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

export function browse(path: string): Promise<BrowseResult> {
  return jget<BrowseResult>(`/api/browse?path=${encodeURIComponent(path)}`);
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
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("Can't reach the server. Make sure the backend is running.");
  }
  if (!res.ok) throw new Error(await errorFrom(res));
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
export interface CloneProgress {
  phase?: string;
  percent?: number;
  raw: string;
}

/**
 * Clone a repository, streaming progress to `onProgress`. Resolves with the
 * final result once the clone finishes.
 */
export async function gitClone(
  url: string,
  parent: string,
  onProgress?: (p: CloneProgress) => void,
): Promise<GitOpResult & { path?: string }> {
  let res: Response;
  try {
    res = await fetch("/api/git/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, parent }),
    });
  } catch {
    throw new Error("Can't reach the server. Make sure the backend is running.");
  }
  if (!res.ok || !res.body) throw new Error(await errorFrom(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: (GitOpResult & { path?: string }) | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === "progress") onProgress?.(msg);
      else if (msg.type === "done") final = msg;
    }
  }
  if (!final) throw new Error("The clone ended unexpectedly.");
  return final;
}

export function getProfile(artifactId: string): Promise<ProfileView> {
  return jget<ProfileView>(`/api/profile?artifactId=${encodeURIComponent(artifactId)}`);
}

export function getResource(artifactId: string): Promise<ResourceView> {
  return jget<ResourceView>(`/api/resource?artifactId=${encodeURIComponent(artifactId)}`);
}

export function applyEdits(
  artifactId: string,
  edits: Edit[],
  write: boolean,
): Promise<EditResult> {
  const body: ApplyEditsRequest = { artifactId, edits, write };
  return jpost<EditResult>("/api/edits", body);
}
