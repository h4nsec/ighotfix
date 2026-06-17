import type {
  ApplyEditsRequest,
  Edit,
  EditResult,
  IgSummary,
  ProfileView,
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

export async function getProfile(artifactId: string): Promise<ProfileView> {
  const res = await fetch(`/api/profile?artifactId=${encodeURIComponent(artifactId)}`);
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
