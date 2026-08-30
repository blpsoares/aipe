# Changelog

There is no hand-maintained changelog file in this repository — one would go
stale immediately, because releases here are fully automated.

Every merge to `main` runs `.github/workflows/release.yml`, which computes
the next version from the [Conventional Commits](https://www.conventionalcommits.org/)
since the last tag, tags it, and publishes a
[GitHub Release](https://github.com/blpsoares/aipe/releases) with generated
release notes, the standalone binaries for every platform, and `SHA256SUMS.txt`.

**That Releases page is the changelog.** See [`RELEASING.md`](RELEASING.md)
for exactly how a version is computed and published.
