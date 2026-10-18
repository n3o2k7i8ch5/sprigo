# Sprigo — Development and release

The repo is public, so GitHub Actions' macOS and Windows minutes are free and every build runs in CI. There are no local or Docker builds (see below).

## Flow

1. **Branch:** every change is made on a branch from `master` (`feature/…`, `fix/…`, `chore/…`).
2. **Merge into test:** push the branch, open a PR against `test` and merge it. Small changes can be merged into `test` directly with `--no-ff`, without a PR. Push `test`.
   - `check` runs on every push to `test` and every PR: typecheck, tests, and `cargo check` on three operating systems (whisper.cpp included). Most errors that would break a release build are caught here.
3. **Smoke test before release:** before `test` goes to `master`, run the release build without publishing:
   ```bash
   gh workflow run release.yml --ref test
   ```
   Continue when all four builds are green (~15 min, in parallel). Packaging and signing errors show up here, before the tag.
4. **Master = live:** `test` → `master` only with explicit approval. Bump the version first (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, then `cargo update -p sprigo --offline` in `src-tauri`). `check` runs again on the push to `master`.
5. **Release:** when `check` is green on `master`, push a tag:
   ```bash
   git tag v1.3.0 && git push origin v1.3.0
   ```
   `release` runs the four builds and uploads the files and a merged `latest.json` to a **draft** release.
6. **Publish:** publish the draft by hand. The in-app updater only sees published releases, so this is the last gate. If a build is red, the draft is not published; the fix ships as a new version.
   Publishing also runs `tap`, which bumps the Homebrew cask in [ozerozdas/homebrew-tap](https://github.com/ozerozdas/homebrew-tap) (needs the `HOMEBREW_TAP_TOKEN` secret). `install.sh` always reads the latest release, so it needs nothing.
   The release notes are what the app shows once, in "What's new", on the first launch after the update. The draft has GitHub's generated PR list: trim it to what learners care about before publishing.
7. **Beta (optional):** to let beta testers (Settings → Beta updates) try a version first, tag it with a numeric pre-release part, e.g. `v1.8.0-1` (Windows installers only accept numbers there), with the same version in the three files. The draft is a pre-release; publishing it runs `channel`, which copies its `latest.json` to the `updater-beta` release that beta apps check. Stable releases are copied there too, so beta testers also get them. Pre-releases skip `tap` and never become `releases/latest`.

## Why no local or Docker builds

- **macOS:** Docker cannot build for macOS (there are no macOS containers). A local Mac could, but CI is free and takes 6–8 min.
- **Windows:** Windows containers need a Windows host; cross-compiling from macOS (cargo-xwin) is experimental in Tauri and fragile with whisper.cpp's MSVC/CMake build. The longest build (~14 min), but free.
- **Linux:** possible in Docker, but it gains nothing on its own.
- Producing builds in two places would mean merging `latest.json` by hand; one source is safer.

If the repo goes private (macOS minutes cost 10×, Windows 2×), moving the macOS builds to a local Mac is worth reconsidering.
