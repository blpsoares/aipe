import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { OrgChart } from "../components/OrgChart";
import { OrgTree } from "../components/OrgTree";
import { snapshot, applySnapshot, openWorkerName } from "../runtime/store";
import { orgQuery } from "../runtime/org";

const EMPTY = snapshot.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  orgQuery.value = "";
  openWorkerName.value = null;
});

// #6 — a monorepo must list ALL its packages, even the ones with no worker yet.
function loadMonorepoWithOrphanPackage() {
  applySnapshot(
    {
      ok: true,
      context: { coordinator: "Coord" },
      repos: ["core"],
      repoInfos: [{ name: "core", stack: ["ts"], kind: "monorepo" }],
      packages: [
        { repo: "core", package: "api", implicit: false, stack: ["ts"], kind: "service" },
        { repo: "core", package: "orphan", implicit: false, stack: ["ts"], kind: "lib" },
      ],
      workers: [{ name: "Bruno", role: "dev-fullstack", repo: "core", package: "api", status: "active" }],
      relations: [],
      journeys: [],
      counts: {},
    } as unknown as Parameters<typeof applySnapshot>[0],
    1000,
  );
}

test("OrgChart: package sem worker ('orphan') ainda aparece como cluster no monorepo", () => {
  loadMonorepoWithOrphanPackage();
  const { container } = render(<OrgChart />);
  const titles = [...container.querySelectorAll(".orgwrap svg .onode .otitle")].map((n) => n.textContent);
  expect(titles).toContain("api"); // package com worker
  expect(titles).toContain("orphan"); // package SEM worker — o fix do #6
});

test("OrgTree: monorepo lista todos os packages, inclusive os sem worker", () => {
  loadMonorepoWithOrphanPackage();
  const { container } = render(<OrgTree />);
  const text = container.textContent || "";
  expect(text).toContain("api");
  expect(text).toContain("orphan");
});
