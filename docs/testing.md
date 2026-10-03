# Testing

[README](../README.md) · [Historical measurements](benchmarks.md)

## Regression checks

```sh
npm ci
npx playwright install chromium
npm test
npm run test:ui
npm run check:release
```

On Linux, use `npx playwright install --with-deps chromium` if system libraries are missing. Dependency installation requires network access; running the application does not.

`npm test` checks placement, skills, targets, observations, persistence, recognition, and library consolidation with Node's test runner. Tests named HTTP are excluded. `test:ui` intercepts browser requests and stores fixture state in temporary directories. Neither command opens a server or uses the player's `data/state.json`.

Browser coverage includes manual placement, Hangul input and IME composition, inline statistics, screen sharing, clipboard images, stage records, worker deadlines, exact-score targets, playback, focus mode, and layouts from 320px to desktop. Picture-in-Picture is exercised when the browser exposes that API.

The keyboard suite checks automatic search focus, Enter behavior, quick input after IME confirmation, cursor-based ability markers, and isolation from other form fields and dialogs. It also exercises whole-game reset and undo, custom-target persistence, and a real solver result confirmed with auto targets disabled. Target controls are checked in English and at mobile widths.

Statistics navigation checks preserve the current plan, filters, and live video across view changes and browser history. Recognition regressions include the reported blue-bar pixels, three- and five-cell bars at several scales, and genuinely disconnected shapes.

The ability-board fixture reproduces a failed recognition where placed tiles and ability glows interrupt the clear background. Checks assert all 12 occupied cells and the exact 3-, 6-, and 8-cell piece shapes at multiple scales. A live-video fixture moves the game panel without resizing the shared window and verifies recovery from one captured frame, plus recovery after a pixel-read error.

Localization checks cover Korean/English switching, reload and cross-tab persistence, dialog validation, keyboard commands, and English layouts. They verify that language changes preserve plans and observations and do not trigger another capture or recognition pass. Unit checks verify translated placeholders and literal player-defined names.

Set `PLAYWRIGHT_MODULE_PATH` to reuse an installed Playwright module, or `BROWSER_EXECUTABLE` to use a separate Chromium executable. By default, tests use the Playwright dependency installed by `npm ci` and its browser.

`npm run test:http` is a separate API test that opens an ephemeral local HTTP server. Do not run it when testing must avoid listening ports. `npm run test:parallel` uses a small temporary fixture to check pause/resume behavior; it is not a score benchmark.

Run regression checks locally before publishing changes. The repository does not use hosted CI. Record the operating system, Node version, browser, and hardware when reporting results.

## Full-game target comparison

On Windows, open `test-targets.cmd`. Menu option 1 runs short unit checks; option 2 starts the target ON/OFF simulation. The equivalent direct command is:

```sh
node tests/target-benchmark.mjs --pairs 3 --parallel 3 --seed 509
```

Each seed produces a target-enabled and a target-disabled game, so this command starts six games. The simulator accepts the current library size, including the consolidated 19-shape library. It copies blocks and observations from `data/state.json` without modifying them. If the save cannot be read, it uses the bundled historical observation snapshot.

For an explicit historical input and one concurrent calculation:

```sh
node tests/target-benchmark.mjs --pairs 1 --parallel 1 --seed 509 --input tests/fixtures/observed-speed-comparison.json
```

The progress display shows each game's score, distance to the next target, and exact target arrivals. A target is recorded only when the score after an individual action equals it. Games continue after targets and the 500,000 display cap, until death. The progress bar measures distance to a target, not time until the simulation ends.

Death requires that no remaining piece can be placed under allowed transformations and that no skills remain. User cancellation, errors, timeouts, and failed searches are not death results. Scores from the last incomplete set are included.

The scheduler lowers process priority, rests between calculations, and limits concurrency according to CPU count and available memory, up to four workers. It slows down under load. Use `--parallel 1` to calculate one game at a time. A run may take hours.

## Stop, resume, and output

Ctrl+C saves checkpoints and stops the run. Resume with the printed run ID:

```sh
node tests/target-benchmark.mjs --run RUN_ID --parallel 1
```

Input, algorithm, and target-list hashes must match. Start a new run after changing them. Use `--output-dir` to choose a results directory. By default, summaries, per-game JSON, and checkpoints are written under `test-results`.

`npm run benchmark:results` reads old comparison output if it exists locally. It does not start a simulation. Personal historical outputs are excluded from the public bundle; their published measurements and limitations are documented in [Benchmarks](benchmarks.md).

## Comparison requirements

Record the seed, shape distribution, stage samples, ability-generation model, time budget, CPU, and memory alongside scores. Include the termination reason, death verification, completed sets, and recommendation count.

Actual stage-dependent draw probabilities are unknown. The simulator uses smoothed observations and a uniform-empty-cell model for ability positions. Scores under these assumptions do not guarantee the same outcome in the game.
