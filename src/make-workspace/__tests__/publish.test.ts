import { expect, test } from "bun:test";
import { publishWorkspace, type Runner, type OriginInspector } from "../publish";

const ranCommands: string[][] = [];

function fakeRunner(script: (cmd: string[]) => { code: number; stdout: string; stderr: string }): Runner {
  return async (cmd: string[], _cwd?: string) => script(cmd);
}

function alwaysOk(): { code: number; stdout: string; stderr: string } {
  return { code: 0, stdout: "", stderr: "" };
}

test("origin already exists → skipped, no gh repo create, no push", async () => {
  const commands: string[][] = [];
  const run: Runner = async (cmd) => {
    commands.push(cmd);
    return alwaysOk();
  };
  const hasOrigin: OriginInspector = async () => true;

  const result = await publishWorkspace("/tmp/ws", { name: "opvibes" }, { run, hasOrigin });

  expect(result.status).toBe("skipped");
  expect(commands.some((c) => c[0] === "gh" && c[1] === "repo" && c[2] === "create")).toBe(false);
  expect(commands.some((c) => c.includes("push"))).toBe(false);
});

test("fresh workspace → git init, commits only allowlist, gh repo create --private <slug>, then push", async () => {
  const commands: string[][] = [];
  const run: Runner = async (cmd) => {
    commands.push(cmd);
    return alwaysOk();
  };
  const hasOrigin: OriginInspector = async () => false;

  const result = await publishWorkspace("/tmp/ws2", { name: "opvibes" }, { run, hasOrigin });

  expect(result.status).toBe("published");

  const initCmd = commands.find((c) => c[0] === "git" && c[1] === "init");
  expect(initCmd).toBeDefined();

  const addCmd = commands.find((c) => c[0] === "git" && c[1] === "add");
  expect(addCmd).toBeDefined();
  expect(addCmd?.slice(2)).toEqual([".aipe", ".claude", ".gitignore", "README.md"]);
  // never a blanket add
  expect(commands.some((c) => c[0] === "git" && c[1] === "add" && c[2] === ".")).toBe(false);
  expect(commands.some((c) => c[0] === "git" && c[1] === "add" && c[2] === "-A")).toBe(false);

  const commitCmd = commands.find((c) => c[0] === "git" && c[1] === "commit");
  expect(commitCmd).toBeDefined();

  const createCmd = commands.find((c) => c[0] === "gh" && c[1] === "repo" && c[2] === "create");
  expect(createCmd).toBeDefined();
  expect(createCmd).toContain("--private");
  expect(createCmd).toContain("opvibes");

  const pushCmd = commands.find((c) => c[0] === "git" && c.includes("push"));
  expect(pushCmd).toBeDefined();
});

test("gh repo create command is always --private, never --public", async () => {
  const commands: string[][] = [];
  const run: Runner = async (cmd) => {
    commands.push(cmd);
    return alwaysOk();
  };
  const hasOrigin: OriginInspector = async () => false;

  await publishWorkspace("/tmp/ws3", { name: "myspace" }, { run, hasOrigin });

  const createCmd = commands.find((c) => c[0] === "gh" && c[1] === "repo" && c[2] === "create");
  expect(createCmd).toBeDefined();
  expect(createCmd).toContain("--private");
  expect(createCmd).not.toContain("--public");
});

test("runner failure (nonzero code) surfaces as failed result, not thrown", async () => {
  const run: Runner = async (cmd) => {
    if (cmd[0] === "gh") return { code: 1, stdout: "", stderr: "gh: not authenticated" };
    return alwaysOk();
  };
  const hasOrigin: OriginInspector = async () => false;

  const result = await publishWorkspace("/tmp/ws4", { name: "opvibes" }, { run, hasOrigin });

  expect(result.status).toBe("failed");
  if (result.status === "failed") {
    expect(result.message).toContain("gh: not authenticated");
  }
});

test("failure on git init is surfaced, not thrown", async () => {
  const run: Runner = async (cmd) => {
    if (cmd[0] === "git" && cmd[1] === "init") return { code: 128, stdout: "", stderr: "cannot init" };
    return alwaysOk();
  };
  const hasOrigin: OriginInspector = async () => false;

  const result = await publishWorkspace("/tmp/ws5", { name: "opvibes" }, { run, hasOrigin });

  expect(result.status).toBe("failed");
});
