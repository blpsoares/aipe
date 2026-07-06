---
name: context-brain
description: Use during onboarding of an AIPe context/team to map the repositories (URLs, paths, stacks) and write .aipe/brain.yaml + .aipe/state.yaml. Does not clone or analyze code — only records factual knowledge.
---

# /context-brain

Interactive collection of a team's context and deterministic writing of the brain file.
You (coordinator) do NOT write the YAML by hand — collect the data from the PE and delegate
the writing to the typed CLI, which validates and serializes it.

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
   - The **repositories**: for each one, `name`, `url` (git@, or https with `.git`
     optional) and a relative `path`
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

   **Monorepos.** If a repo is a monorepo, give it `modules` — the units of work
   below the repo (each gets its own specialists, worktree, PR and dispatch, and
   distinct modules run in parallel):
   ```json
   { "name": "platform", "url": "...", "path": "./platform", "kind": "web", "modules": [
       { "name": "core",    "path": "packages/core",    "stack": ["TypeScript"], "kind": "lib" },
       { "name": "billing", "path": "services/billing", "stack": ["Go"], "group": "backend", "kind": "api" }
   ] }
   ```
   A repo with no `modules` is one implicit module (the whole repo) — flat repos
   are unchanged. Modules sharing a `group` share one specialist pair (use it to
   keep a big monorepo's roster small). Don't fold **separate** products into one
   monorepo entry — genuinely separate git repos stay separate repo entries.
   After the clone, `aipe detect-modules --repo <name>` proposes modules from the
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

## Rules

- Never edit `brain.yaml`/`state.yaml` directly here — always go through the CLI, to
  guarantee a valid format.
- One question at a time; don't dump them all at once.
- If the workspace doesn't exist or doesn't look like an `aipe-<context>`, ask before
  writing.
