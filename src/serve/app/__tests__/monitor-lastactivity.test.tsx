import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { MonLane } from "../components/MonLane";
import { monPush, monMeta, summarizeEvent, __resetMonitorStore } from "../runtime/monitor-store";

afterEach(() => {
  cleanup();
  __resetMonitorStore();
});

// #7a — track each agent's last activity so an idle/quiet lane shows what the
// agent was last doing instead of a bare "—".
test("summarizeEvent: file/tool/say", () => {
  expect(summarizeEvent({ agent: "a", kind: "file", tool: "Edit", file: "src/x.ts" })).toBe("Edit src/x.ts");
  expect(summarizeEvent({ agent: "a", kind: "tool", cmd: "bun test" })).toBe("$ bun test");
  expect(summarizeEvent({ agent: "a", kind: "tool", tool: "Grep", text: "foo" })).toBe("Grep · foo");
  expect(summarizeEvent({ agent: "a", text: "thinking about it" })).toBe("thinking about it");
});

test("monPush records lastActivity on content events", () => {
  monPush({ agent: "a", kind: "agent", persona: "Ana", active: true });
  expect(monMeta("a").lastActivity).toBeUndefined(); // roster event isn't activity
  monPush({ agent: "a", kind: "file", tool: "Write", file: "src/y.ts" });
  expect(monMeta("a").lastActivity).toBe("Write src/y.ts");
  monPush({ agent: "a", kind: "tool", cmd: "bun test" });
  expect(monMeta("a").lastActivity).toBe("$ bun test");
});

test("MonLane shows the last activity hint when the agent is idle", () => {
  monPush({ agent: "a", kind: "agent", persona: "Ana", active: true });
  monPush({ agent: "a", kind: "file", tool: "Edit", file: "src/z.ts" });
  monPush({ agent: "a", kind: "agent", persona: "Ana", active: false }); // went idle
  const { container } = render(<MonLane id="a" />);
  const last = container.querySelector(".mon-last");
  expect(last).not.toBeNull();
  expect(last!.textContent).toContain("Edit src/z.ts");
});
