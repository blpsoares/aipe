import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { Avatar } from "../components/Avatar";
import { Chip } from "../components/Chip";
import { ConnBadge } from "../components/ConnBadge";
import { ActivityFeed, EventRow } from "../components/ActivityFeed";
import { CompChips } from "../components/CompChips";
import { conn } from "../runtime/store";
import { setLang } from "../runtime/i18n";

afterEach(() => {
  cleanup();
  setLang("en");
  conn.value = "wait";
});

test("Avatar shows initials", () => {
  const { container } = render(<Avatar name="Ada Lovelace" />);
  const el = container.querySelector(".avatar");
  expect(el).toBeTruthy();
  expect(el!.textContent).toBe("AL");
});

test("Chip shows stt(status) text and status class", () => {
  const { container } = render(<Chip status="delivered" />);
  const el = container.querySelector(".chip");
  expect(el).toBeTruthy();
  expect(el!.classList.contains("delivered")).toBe(true);
  expect(el!.textContent).toBe("delivered");
});

test("EventRow with unknown status falls back to d-active", () => {
  const { container } = render(<EventRow event={{ w: "Ada", status: "unknown-status", m: "did a thing", at: Date.now() }} />);
  expect(container.querySelector(".d-active")).toBeTruthy();
});

test("EventRow escapes e.w and e.m (JSX text, not HTML)", () => {
  const { container } = render(
    <EventRow event={{ w: "<script>alert(1)</script>", status: "delivered", m: "<img>injected</img>", at: Date.now() }} />,
  );
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".tx > b")!.textContent).toBe("<script>alert(1)</script>");
  expect(container.querySelector(".m")!.textContent).toBe("<img>injected</img>");
});

test("EventRow uses reltime for e.at, rel_now under 8s", () => {
  const { container } = render(<EventRow event={{ w: "Ada", status: "delivered", m: "x", at: Date.now() }} />);
  const ts = container.querySelector(".ts");
  expect(ts!.textContent).toBe("now");
});

test("ActivityFeed renders one EventRow per event", () => {
  const { container } = render(
    <ActivityFeed
      events={[
        { w: "Ada", status: "delivered", m: "a", at: Date.now() },
        { w: "Grace", status: "escalated", m: "b", at: Date.now() },
      ]}
    />,
  );
  expect(container.querySelectorAll(".ev").length).toBe(2);
});

test("CompChips renders up to max then a +N chip", () => {
  const { container } = render(<CompChips list={["a", "b", "c", "d"]} max={2} />);
  const comps = container.querySelectorAll(".comp");
  expect(comps.length).toBe(3); // 2 shown + 1 "more"
  expect(container.querySelector(".comp.more")!.textContent).toBe("+2");
});

test("CompChips with empty list falls back to t('none')", () => {
  const { container, getByText } = render(<CompChips list={[]} />);
  expect(container.querySelectorAll(".comp").length).toBe(0);
  expect(getByText("none")).toBeTruthy();
});

test("ConnBadge reflects the conn signal — live", () => {
  conn.value = "live";
  const { container } = render(<ConnBadge />);
  const el = container.querySelector(".conn");
  expect(el!.classList.contains("down")).toBe(false);
  expect(el!.classList.contains("wait")).toBe(false);
  expect(el!.textContent).toBe("live");
});

test("ConnBadge reflects the conn signal — wait", () => {
  conn.value = "wait";
  const { container } = render(<ConnBadge />);
  const el = container.querySelector(".conn");
  expect(el!.classList.contains("wait")).toBe(true);
  expect(el!.textContent).toBe("connecting");
});

test("ConnBadge reflects the conn signal — down", () => {
  conn.value = "down";
  const { container } = render(<ConnBadge />);
  const el = container.querySelector(".conn");
  expect(el!.classList.contains("down")).toBe(true);
  expect(el!.textContent).toBe("offline");
});
