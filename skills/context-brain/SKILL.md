---
name: context-brain
description: Use during onboarding of an AIPe context/team to map the repositories (URLs, paths, stacks) and write .aipe/brain.yaml + .aipe/state.yaml. Does not clone or analyze code — only records factual knowledge.
---

# /context-brain

Interactive collection of a team's context and deterministic writing of the brain file.
You (coordinator) do NOT write the YAML by hand — collect the data from the PE and delegate
the writing to the typed CLI, which validates and serializes it.

## Flow

1. **Confirm the workspace.** The brain is written to `<workspace>/.aipe/`. By default the
   workspace is the current directory. Confirm with the PE whether this is the right place
   (it should be an `aipe-<context>` folder).

2. **Collect the data, one question at a time:**
   - **Context** name (slug: lowercase, numbers, hyphens — becomes `aipe-<name>`).
   - **Coordinator** name (how the PE wants to be addressed).
   - The **repositories**: for each one, `name`, `url` (git@, or https with `.git`
     optional) and a relative `path`
     (starting with `./`). `stack` is optional — only fill it in if the PE knows it;
     otherwise leave it out (it will be filled in during later phases). The PE may paste a
     whole list at once.

3. **Assemble the JSON** in `ContextInput` format:
   ```json
   {
     "context": { "name": "<slug>", "coordinator": "<name>" },
     "repos": [ { "name": "...", "url": "...", "path": "./...", "stack": ["..."] } ]
   }
   ```

4. **Write via the CLI.** Write the JSON to a temporary file and run:
   ```bash
   bun <plugin-path>/src/context-brain/cli.ts --input <file.json> --workspace <workspace>
   ```

5. **Handle the result:**
   - Output `OK brain=... / OK state=...` → confirm to the PE that the files were written.
   - Lines `ERROR <field>: <message>` → show them to the PE, fix the flagged data and
     run it again. Never write anything by hand.

## Rules

- Never edit `brain.yaml`/`state.yaml` directly here — always go through the CLI, to
  guarantee a valid format.
- One question at a time; don't dump them all at once.
- If the workspace doesn't exist or doesn't look like an `aipe-<context>`, ask before
  writing.
