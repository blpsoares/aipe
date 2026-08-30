## What this changes and why

## Evidence

This project's ledger refuses to record a delivery with no attached
evidence — the same discipline applies here. Paste the **actual commands you
ran and what their output showed**, not "tests pass":

```
$ bun run version:check
...

$ bun run typecheck
...

$ bun test
...
```

If your change touches `src/serve/app/`, include the relevant view test
output too — there is no screenshot-based coverage for the UI, the view
tests are the proof.

If your change is user-facing (a new subcommand, a changed flag, a new
skill flow), show it actually running end-to-end, not just the test suite
passing:

```
$ bun run src/cli.ts <command> ...
...
```

## Checklist

- [ ] `bun run version:check`, `bun run typecheck`, and `bun test` all pass
      locally (paste the output above)
- [ ] New/changed behavior has a test in the matching `__tests__/` directory
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
      (the release version is computed from them — see `RELEASING.md`)
- [ ] If this touches a `SKILL.md`, a persona body, or a hiring brief, I read
      `skills/authoring-rules/SKILL.md` first
- [ ] I did not hand-bump the version anywhere — it's computed on merge

## Related issues

Closes #
