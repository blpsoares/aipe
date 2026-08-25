# AIPe documentation

Start at the [root README](../README.md) for what AIPe is and how to install it.

## Reference

| Document | Covers |
|---|---|
| [`harnesses.md`](harnesses.md) | The harness adapter seam, every supported harness and how they differ, adding a new one |
| [`upgrades.md`](upgrades.md) | `aipe upgrade` / `aipe check-update`, machine state under `~/.aipe/`, critical releases |
| [`../RELEASING.md`](../RELEASING.md) | How a release is cut (automatic, from `main`) and the download-domain wiring |
| [`governance-dispatch-gate.md`](governance-dispatch-gate.md) | The parallel-dispatch law and its gates |
| [`serve-background.md`](serve-background.md) | Running the web console detached, and the token required off loopback |
| [`pr-c-monitor.md`](pr-c-monitor.md) | The monitor stream behind the console |

## Design record

| Directory | Holds |
|---|---|
| [`dossie/`](dossie/) | Execution ledger: decisions, plan, review and final state, one per sub-project |
| [`superpowers/specs/`](superpowers/specs/) | Design specs (brainstorming output), one per sub-project |
| [`superpowers/plans/`](superpowers/plans/) | Implementation plans |

`NEXT-SESSION.md` and `NEXT-SESSION-phase-b.md` are working handoff notes, not
reference material — they go stale by design.
