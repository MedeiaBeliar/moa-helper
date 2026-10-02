# Publishing

[README](../README.md)

## Build the source bundle

```sh
npm run check:release
npm run release:bundle
```

Extract `releases/moa-helper-github.zip` and use its `moa-helper` directory as a new repository root. It includes source, documentation, examples, tests, and `.github`. Use Git if your upload tool skips hidden files.

The generator collects explicit source roots. It excludes player saves, test output, installed dependencies, previous ZIP files, and local design work. A SHA-256 file accompanies the archive, and `source-manifest.sha256` lists individual source hashes. Identical source files produce an identical archive.

Release checks cover local documentation links, unique UI IDs, duplicate-free examples, dependency locking, and the bundled font license. They are not a complete audit of secrets or asset rights.

## Initialize a repository

Run these commands in the extracted directory. Create an empty GitHub repository and use the remote address GitHub provides.

```sh
git init -b main
git add .
git diff --cached --stat
git commit -m "Initial release"
```

Register your actual repository URL with `git remote add origin`, then push with `git push -u origin main`. Project scripts do not create a repository or push code automatically.

The source license is MIT; Pretendard uses SIL OFL 1.1. The code license does not apply to MapleStory trademarks or game assets. See [Third-party notices](../THIRD_PARTY_NOTICES.md).

## After publishing

Run the checks in [Testing](testing.md) locally before each push. The repository contains no hosted CI workflows; pushing changes does not run tests automatically.

Suggested repository description:

> Local assistant for MapleStory's Hangul Moa Moa event, October 1 to 14, 2026. Built for personal use and learning.

Relevant topics include `maplestory`, `puzzle-solver`, `javascript`, `screen-capture`, and `local-first`. Enable private vulnerability reporting if you want to receive security reports through GitHub.

GitHub Pages alone cannot run the Node storage API. Users run the downloaded application locally with `npm start`.

## Library maintenance

The interface can merge rotation/reflection duplicates with Undo support. An offline migration tool is also available:

```sh
node scripts/dedupe-library.mjs
node scripts/dedupe-library.mjs --apply
```

The first command previews groups. The second creates a backup under `data/backups` and applies the merge. Reload the browser afterward so an old tab does not restore an earlier state.

`--examples` regenerates both example JSON files using the consolidated shapes and neutral IDs, without observation counts. `--reconcile-stage-totals` raises an inconsistent overall count to its stage sum; use it only after deciding that the stage records are authoritative.
