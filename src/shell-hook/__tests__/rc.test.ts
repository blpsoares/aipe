import { describe, expect, it } from "bun:test";
import {
  BEGIN,
  END,
  HOOK_LINE,
  block,
  fileState,
  planInstall,
  planUninstall,
  scan,
} from "../rc";

// The guard is the whole safety story: `command -v aipe` fails cleanly when the
// binary is gone, and `&&` short-circuits so nothing else on the line runs.
describe("the hook line", () => {
  it("is guarded by `command -v` so an absent binary never runs check-update", () => {
    expect(HOOK_LINE.startsWith("command -v aipe >/dev/null 2>&1 &&")).toBe(true);
    expect(HOOK_LINE).toContain("aipe check-update");
  });

  it("wraps the line in matched markers on their own lines", () => {
    expect(block()).toBe(`${BEGIN}\n${HOOK_LINE}\n${END}`);
  });
});

describe("scan", () => {
  it("finds no block in unrelated rc content", () => {
    const s = scan("export PATH=$PATH:/x\nalias ll='ls -l'\n");
    expect(s).toEqual({ ok: true, blocks: [] });
  });

  it("locates a single well-formed block", () => {
    const content = `export PATH=x\n${block()}\n`;
    const s = scan(content);
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.blocks).toHaveLength(1);
      expect(s.blocks[0]!.text).toBe(block());
    }
  });

  it("refuses an opening marker with no closing marker", () => {
    const s = scan(`foo\n${BEGIN}\n${HOOK_LINE}\n`);
    expect(s.ok).toBe(false);
  });

  it("refuses a closing marker with no opening marker", () => {
    const s = scan(`foo\n${HOOK_LINE}\n${END}\n`);
    expect(s.ok).toBe(false);
  });

  it("refuses a second opening marker before the first closes", () => {
    const s = scan(`${BEGIN}\n${BEGIN}\n${HOOK_LINE}\n${END}\n`);
    expect(s.ok).toBe(false);
  });

  it("refuses two complete blocks (ambiguous to edit)", () => {
    const s = scan(`${block()}\n${block()}\n`);
    expect(s.ok).toBe(false);
  });

  it("does not mistake the marker inside a quoted echo for a real marker", () => {
    const s = scan(`echo "${BEGIN}"\n`);
    expect(s).toEqual({ ok: true, blocks: [] });
  });
});

describe("planInstall", () => {
  it("appends the block to a non-empty rc, preserving what was there", () => {
    const plan = planInstall("export PATH=x\n");
    expect(plan.action).toBe("insert");
    if (plan.action === "insert") {
      expect(plan.next.startsWith("export PATH=x\n")).toBe(true);
      expect(plan.next).toContain(block());
      expect(plan.next.endsWith("\n")).toBe(true);
    }
  });

  it("seeds a clean block into an empty rc with no leading blank line", () => {
    const plan = planInstall("");
    expect(plan).toEqual({ action: "insert", next: `${block()}\n` });
  });

  it("is idempotent — a second install is a no-op", () => {
    const once = planInstall("export PATH=x\n");
    expect(once.action).toBe("insert");
    if (once.action !== "insert") return;
    const twice = planInstall(once.next);
    expect(twice).toEqual({ action: "unchanged" });
  });

  it("updates in place when the marked line has drifted", () => {
    const stale = `pre\n${BEGIN}\ncommand -v aipe >/dev/null 2>&1 && aipe check-update --old\n${END}\npost\n`;
    const plan = planInstall(stale);
    expect(plan.action).toBe("update");
    if (plan.action === "update") {
      expect(plan.next).toContain(block());
      expect(plan.next.startsWith("pre\n")).toBe(true);
      expect(plan.next.endsWith("post\n")).toBe(true);
      expect(plan.next).not.toContain("--old");
    }
  });

  it("refuses strange content (a truncated block) without proposing a write", () => {
    const plan = planInstall(`foo\n${BEGIN}\n${HOOK_LINE}\n`);
    expect(plan.action).toBe("refuse");
  });
});

describe("planUninstall is the exact inverse of install", () => {
  it("restores a non-empty rc byte-for-byte", () => {
    const original = "export PATH=x\nalias g=git\n";
    const installed = planInstall(original);
    expect(installed.action).toBe("insert");
    if (installed.action !== "insert") return;
    const removed = planUninstall(installed.next);
    expect(removed).toEqual({ action: "remove", next: original });
  });

  it("restores an empty rc byte-for-byte", () => {
    const installed = planInstall("");
    if (installed.action !== "insert") throw new Error("expected insert");
    const removed = planUninstall(installed.next);
    expect(removed).toEqual({ action: "remove", next: "" });
  });

  it("removes only the marked block, leaving user content around it intact", () => {
    const content = `before\n\n${block()}\n\nafter\n`;
    const removed = planUninstall(content);
    expect(removed.action).toBe("remove");
    if (removed.action === "remove") {
      expect(removed.next).toContain("before");
      expect(removed.next).toContain("after");
      expect(removed.next).not.toContain(BEGIN);
    }
  });

  it("reports absent when there is no block", () => {
    expect(planUninstall("export PATH=x\n")).toEqual({ action: "absent" });
  });

  it("refuses to touch a file whose block is corrupt", () => {
    const plan = planUninstall(`foo\n${BEGIN}\n${HOOK_LINE}\n`);
    expect(plan.action).toBe("refuse");
  });
});

describe("fileState", () => {
  it("reports installed, absent, stale and malformed", () => {
    expect(fileState(`x\n${block()}\n`)).toBe("installed");
    expect(fileState("x\n")).toBe("absent");
    expect(fileState(`${BEGIN}\ncommand -v aipe >/dev/null 2>&1 && aipe old\n${END}\n`)).toBe("stale");
    expect(fileState(`${BEGIN}\nno close`)).toBe("malformed");
  });
});
