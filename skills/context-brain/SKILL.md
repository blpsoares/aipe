---
name: context-brain
description: Use during onboarding of an AIPe context/team to map the repositories (URLs, paths, stacks) and write .aipe/brain.yaml + .aipe/state.yaml. Does not clone or analyze code — only records factual knowledge.
---

# /context-brain

**Announce on entry:** "Using context-brain to map the repos into the brain file."

Interactive collection of a team's context and deterministic writing of the brain file.
You (coordinator) do NOT write the YAML by hand — collect the data from the PE and delegate
the writing to the typed CLI, which validates and serializes it.

## When to use / when NOT

**Use it when:** onboarding step 1 — the workspace exists (`aipe-<name>/`) but there is
no `.aipe/brain.yaml` yet, and you need to record the repos (URLs, paths, stacks).

**Do NOT use it when:** a brain already exists and you only want to **add one repo** —
use `/aipe-add-repo` (it preserves existing personas). Also not for cloning or
analyzing code — this skill records **factual knowledge only**; it never reads source.

## Flow

1. **The workspace already exists.** `aipe start` created this `aipe-<name>/`
   folder and installed the integration here — the current directory **is** the
   workspace. The **context name is already decided**: it's this folder's name
   with the `aipe-` prefix removed. Do not ask the PE for it; do not create
   another folder.

2. **Collect only what's missing, one question at a time:**
   - **Coordinator** name — the name the PE gives to **you, the AI coordinator**
     (it is injected at SessionStart as "You ARE <name>" and is reserved so no
     hired persona reuses it). This is *your* name as the AI, **not** the PE's own
     name: the PE is the human running the session; the coordinator is you.
   - The **repositories**: for each one, `name`, `url` (git@, https with `.git`
     optional, **or a local filesystem path** for a local-only repo) and a relative `path`
     (starting with `./`). `stack` is optional — only fill it in if the PE knows it;
     otherwise leave it out (it will be filled in during later phases). The PE may paste a
     whole list at once. `kind` is also optional — the functional category of the
     unit (`api`, `web`, `lib`, `service`), shown as the "type" in the web console;
     when omitted it is inferred from the stack/name, so only set it to override.

3. **Assemble the JSON** in `ContextInput` format (`name` = the folder name
   minus `aipe-`):
   ```json
   {
     "context": { "name": "<folder-name-without-aipe->", "coordinator": "<name>" },
     "repos": [ { "name": "...", "url": "...", "path": "./...", "stack": ["..."] } ]
   }
   ```

   **Monorepos.** If a repo is a monorepo, give it `packages` — the units of work
   below the repo (each gets its own specialists, worktree, PR and dispatch, and
   distinct packages run in parallel):
   ```json
   { "name": "platform", "url": "...", "path": "./platform", "kind": "web", "packages": [
       { "name": "core",    "path": "packages/core",    "stack": ["TypeScript"], "kind": "lib" },
       { "name": "billing", "path": "services/billing", "stack": ["Go"], "group": "backend", "kind": "api" }
   ] }
   ```
   A repo with no `packages` is one implicit package (the whole repo) — flat repos
   are unchanged. Packages sharing a `group` share one specialist pair (use it to
   keep a big monorepo's roster small). Don't fold **separate** products into one
   monorepo entry — genuinely separate git repos stay separate repo entries.
   After the clone, `aipe detect-packages --repo <name>` proposes packages from the
   monorepo's own workspace manifests for the PE to confirm.

4. **Write via the CLI.** Write the JSON to a temporary file and run:
   ```bash
   aipe context-brain --input <file.json> --workspace <workspace>
   ```

5. **Handle the result:**
   - Output `OK brain=... / OK state=...` → confirm the brain was written, then
     tell the PE this step is done and to open a **new session in this same
     folder** to continue — the next step (`/make-workspace`) starts
     automatically there.
   - Lines `ERROR <field>: <message>` → show them to the PE, fix the flagged data and
     run it again. Never write anything by hand.

## The no-fabrication gate (MUST — non-negotiable)

You **MUST NOT** invent a repo `url`. A fabricated URL clones the wrong thing (or
nothing) and silently corrupts every downstream phase — the map is the foundation the
whole context is built on. Condition to pass the gate: **every `url` is either a real
remote the PE gave you, or the repo's local filesystem path.**

**Table of non-exceptions (forbidden rationalizations).** Each thought means **STOP:**

| Rationalization | Ruling |
| --- | --- |
| "GitHub URLs are predictable, I'll guess it" | NEVER guess — use the local path, or ask the PE |
| "the PE clearly meant github.com/<org>/<repo>" | Inference ≠ fact. Ask, or use the path |
| "the repo has no remote, I'll make one up" | Use the **local path** as the url; `make-workspace` clones it fine |
| "it's just a placeholder, I'll fix it later" | A wrong url in the brain poisons clone + relations. Get it right now |

When `git -C <path> remote get-url origin` is empty, use the local path as the `url`.
If a url is genuinely unknown and there is no remote, **ask the PE**.

## Rules

- Governance (MUST): you are the coordinator — you **NEVER** edit repo source
  yourself, because all code work must flow through the dispatch gate in `/operate`
  (decompose → dispatch a specialist in a worktree → PR) to keep the audit trail and
  worktree isolation intact; the non-exceptions there ("simple", "urgent", "one
  file", "I already know the fix") never apply. Here you only collect data and run
  the `aipe` CLI.
- Determinism (MUST): never edit `brain.yaml`/`state.yaml` by hand — always through
  the CLI, because only the CLI validates and serializes a format the later phases
  can trust.
- ALWAYS ask one question at a time; dumping them all at once loses answers and
  produces a half-filled brain.
- If the workspace doesn't exist or doesn't look like an `aipe-<context>`, **ask**
  before writing — writing into the wrong folder is hard to unwind.

## Common mistakes

- *Inventing a plausible GitHub URL* → use the local path, or ask the PE (see the gate).
- *Writing the YAML by hand to "save a step"* → always via `aipe context-brain`; the
  CLI is the only validator.
- *Folding two separate products into one monorepo entry* → separate git repos stay
  separate repo entries; only real workspace packages become `packages`.

## Self-review gate (before telling the PE this step is done)

- [ ] Every repo's `url` is a real remote or a local path — nothing fabricated.
- [ ] The brain was written by `aipe context-brain`, not by hand.
- [ ] The CLI printed `OK brain=… / OK state=…` (not an `ERROR` line).
- [ ] The context name came from the folder (`aipe-` stripped), not invented.
