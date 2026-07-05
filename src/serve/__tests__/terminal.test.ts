import { expect, test } from "bun:test";
import { frame, createTerminalSession } from "../terminal";

test("frame extracts turn exit codes and strips the sentinel", () => {
  const r = frame("hello\n\x01AIPE_DONE:0\x01\nworld");
  expect(r.clean).toBe("hello\n\nworld");
  expect(r.turns).toEqual([0]);
  expect(r.rest).toBe("");
});

test("frame holds back a partial trailing sentinel", () => {
  const r = frame("output\x01AIPE_DONE:");
  expect(r.clean).toBe("output");
  expect(r.turns).toEqual([]);
  expect(r.rest).toBe("\x01AIPE_DONE:");
  // completing it in the next chunk yields the turn
  const r2 = frame(r.rest + "3\x01\n");
  expect(r2.turns).toEqual([3]);
});

test("a persistent shell streams output, frames the turn, and keeps cwd", async () => {
  if (process.platform === "win32") return; // bash-shaped test
  let out = "";
  const turns: number[] = [];
  const queue: Array<() => void> = [];
  const session = createTerminalSession({
    cwd: "/",
    shell: "bash",
    onData: (c) => {
      out += c;
    },
    onTurnEnd: (code) => {
      turns.push(code);
      queue.shift()?.();
    },
    onExit: () => {},
  });
  const nextTurn = () => new Promise<void>((res) => queue.push(res));

  const t1 = nextTurn();
  session.run("echo hello-aipe");
  await t1;
  expect(out).toContain("hello-aipe");
  expect(turns[0]).toBe(0);

  const t2 = nextTurn();
  session.run("cd /tmp && pwd");
  await t2;

  out = "";
  const t3 = nextTurn();
  session.run("pwd"); // cwd persisted from the previous command
  await t3;
  expect(out).toContain("/tmp");

  session.close();
});
