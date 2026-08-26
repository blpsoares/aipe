// Test isolation for machine-level state.
//
// `recordWorkspace` runs on every `aipe` dispatch, and without this the suite
// wrote into the DEVELOPER'S real `~/.aipe/workspaces.json`: 48 of the 50
// registry slots on this machine were `/tmp/aipe-ss-*` throwaways from
// session-hook tests, crowding out the actual workspaces the next
// `aipe upgrade` was supposed to rehydrate.
//
// Pointing AIPE_HOME at a temp dir for the whole suite fixes it once, for every
// test that exists now or later — the alternative is remembering to set it in
// each new test that happens to reach a dispatch path, which is the kind of
// thing nobody remembers.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `??=` so a test that deliberately sets its own AIPE_HOME still wins.
process.env.AIPE_HOME ??= mkdtempSync(join(tmpdir(), "aipe-test-home-"));
