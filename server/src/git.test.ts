import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as git from "./git.js";

const exec = promisify(execFile);
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "igb-git-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("git module", () => {
  it("reports a non-repo before init", async () => {
    const st = await git.status(dir);
    expect(st.isRepo).toBe(false);
  });

  it("init → status → commit → branch lifecycle", async () => {
    expect((await git.init(dir)).ok).toBe(true);
    // Identity for the throwaway repo so commit works in any environment.
    await exec("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    await exec("git", ["config", "user.name", "Test"], { cwd: dir });

    await writeFile(path.join(dir, "MyPatient.json"), '{"resourceType":"StructureDefinition"}\n');

    let st = await git.status(dir);
    expect(st.isRepo).toBe(true);
    expect(st.branch).toBe("main");
    expect(st.clean).toBe(false);
    expect(st.files?.[0].path).toBe("MyPatient.json");
    expect(st.files?.[0].label).toBe("untracked");
    expect(st.files?.[0].staged).toBe(false);

    // Commit only commits staged content; nothing is staged yet.
    expect((await git.commit(dir, "nope")).ok).toBe(false);

    // Stage the file, then it shows as staged.
    expect((await git.stage(dir, ["MyPatient.json"])).ok).toBe(true);
    st = await git.status(dir);
    expect(st.files?.[0].staged).toBe(true);

    // Unstage and re-check, then stage again and commit.
    expect((await git.unstage(dir, ["MyPatient.json"])).ok).toBe(true);
    expect((await git.status(dir)).files?.[0].staged).toBe(false);

    await git.stageAll(dir);
    const c = await git.commit(dir, "Initial import");
    expect(c.ok).toBe(true);

    st = await git.status(dir);
    expect(st.clean).toBe(true);

    const log = await git.log(dir, 5);
    expect(log[0].subject).toBe("Initial import");

    expect((await git.createBranch(dir, "feature/x", true)).ok).toBe(true);
    const br = await git.branches(dir);
    expect(br.current).toBe("feature/x");
    expect(br.branches.sort()).toEqual(["feature/x", "main"]);

    expect((await git.checkout(dir, "main")).ok).toBe(true);
    expect((await git.branches(dir)).current).toBe("main");
  });

  it("rejects invalid branch names", async () => {
    const r = await git.createBranch(dir, "bad name!", false);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/Invalid branch/);
  });

  it("requires a commit message", async () => {
    const r = await git.commit(dir, "   ");
    expect(r.ok).toBe(false);
  });
});
