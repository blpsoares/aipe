// The ONE pure derivation behind `aipe release promote`: does a version's
// publication actually EXIST in the registry? (onda3 #94). The house rule this
// module exists to enforce: a release is `published` only when the published
// registry — the git tag AND a non-draft GitHub Release — SAYS so. A workflow
// that exited 0 establishes nothing here; exit-0-as-proof is the exact defect
// class this command was cut to kill ("Exit 0 de CI é a forma canônica desta
// classe de defeito"). No I/O lives here — the CLI reads the registry and hands
// these facts in; this turns them into a verdict with a sentence explaining it.
//
// The honesty seam is the same one `release/state.ts` leans on: a fact that
// could not be read from the registry is `null`, and a `null` is NEVER read as
// "not there" or "there" — it degrades the verdict to `unverifiable`, never to
// the comfortable `published`.

// What the registry says about one version. Every field is nullable: `null`
// means "could not be established" (gh unauthenticated, a network failure, git
// could not reach the remote) and MUST NOT be read as false — that is the seam.
//   • tagExists      — a `v<version>` tag exists on the remote (the published
//                      registry), not merely locally.
//   • releaseExists  — a GitHub Release for that tag exists.
//   • releaseIsDraft — that Release is a draft (a draft is NOT published).
//                      Only meaningful when releaseExists is true; `null` there
//                      means "the Release exists but its draft state was
//                      unreadable" → we refuse to assume it is live.
export interface PublishedFacts {
  tagExists: boolean | null;
  releaseExists: boolean | null;
  releaseIsDraft: boolean | null;
}

export type PublicationState = "published" | "not-published" | "unverifiable";

export interface PublicationVerdict {
  version: string;
  state: PublicationState;
  reason: string; // a plain sentence: why this state, naming the missing fact
}

// The verdict. `published` is returned ONLY when the registry positively
// confirms every requirement; any unread fact yields `unverifiable`; a fact read
// as absent yields `not-published`. There is deliberately no path from a
// process/exit-code signal to `published` — this function never sees one.
export function evaluatePublication(version: string, f: PublishedFacts): PublicationVerdict {
  const base = { version };

  // Unread registry ⇒ we cannot claim anything. This is the "diz isso e falha"
  // branch: the command that gets this back reports it could not establish the
  // fact and fails, rather than assuming the release went out.
  if (f.tagExists === null || f.releaseExists === null) {
    const which = f.tagExists === null && f.releaseExists === null
      ? "neither the tag nor the release could be read from the registry"
      : f.tagExists === null
        ? "the tag could not be read from the registry"
        : "the release could not be read from the registry";
    return { ...base, state: "unverifiable", reason: `publication of v${version} could not be established — ${which}` };
  }

  // Both facts read, and something is missing ⇒ genuinely not published.
  if (!f.tagExists || !f.releaseExists) {
    const missing: string[] = [];
    if (!f.tagExists) missing.push(`no v${version} tag on the remote`);
    if (!f.releaseExists) missing.push(`no published release for v${version}`);
    return { ...base, state: "not-published", reason: missing.join("; ") };
  }

  // Tag and release both exist — but a draft release is not published, and an
  // unreadable draft state must not be assumed live (the seam again).
  if (f.releaseIsDraft === null) {
    return { ...base, state: "unverifiable", reason: `the v${version} release exists but its draft state was unreadable — cannot confirm it is live` };
  }
  if (f.releaseIsDraft === true) {
    return { ...base, state: "not-published", reason: `the v${version} release exists but is still a draft` };
  }

  return { ...base, state: "published", reason: `v${version} is tagged on the remote and its GitHub Release is live` };
}
