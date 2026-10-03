# Testing

[README](../README.md) · [Measured results](benchmarks.md)

## Regression checks

```sh
npm ci
npm test
npm run test:parallel
npm run check:release
```

Validation is Node-only. Do not start a web server, launch a browser, or run browser automation. See [Project constraints](../AGENTS.md).

`npm test` checks placement, skills, targets, observations, persistence, recognition, and library consolidation with Node's test runner. Tests named HTTP are excluded. Temporary fixtures isolate runner checks from the player's `data/state.json`.

Statistics export tests verify stage and source denominators, unknown-stage records, HTML cell geometry, name escaping, and rich-text versus source clipboard payloads. Clipboard APIs are stubbed; browser rendering and external forum sanitizers are not exercised.

The 500k runner checks use two workers, stop and resume temporary checkpoints, and verify separate cap and death results. Constructed endpoint fixtures test lifecycle behavior; their scores are not performance measurements. `npm run test:parallel` separately verifies the original low-load comparison's checkpoint behavior.

Probability regressions check stage boundaries, overall fallback, nonzero weights for unseen shapes, separation of normal and reroll records, and exclusion of unidentified or deleted entries. Paired recommendations on the same board verify that stage records affect ranking even without sampled lookahead. Proven failed future hands must remain in candidate comparisons. Pixel fixtures cover reported recognition errors without a browser.

An independent placement oracle verifies the full-distribution mean and weighted lower quartile. Additional checks cover rare-hole penalties, dot preservation at capacity, and restart warnings that respect recovery skills and pending rerolls.

Legacy browser fixtures remain in `tests/*-browser.mjs` for reference. They are outside the active validation workflow. Do not run `test:ui` or `test:http`. Record the operating system, Node version, hardware, and untested UI behavior when reporting results. The repository does not use hosted CI.

## Two-game 500k run

On Windows, double-click [`test-500k.cmd`](../test-500k.cmd). No configuration menu appears. The equivalent command is:

```sh
npm run test:500k
```

This preset runs two games concurrently with all automatic targets enabled, using seeds 509 and 510. It reads the saved blocks and stage statistics without changing the save. Both workers run at normal priority without artificial rest or load-based throttling. Each recommendation retains the application's one-second budget.

Each game ends at 500,000 points or verified death. A cap result is marked `cap-reached`, not `dead`. Reaching an intermediate target is recorded and play continues. The display shows progress toward 500,000, points remaining, the next intermediate target, and exact arrivals for each game. The console stays open after completion.

Restart warnings appear in the dashboard and are saved with their first occurrence and total count. They do not stop or reset the game. Every low-scoring death remains in the report. Traces retain recent boards, inventories, and search evidence for diagnosing failures.

In an interactive terminal, each placement, dot, reroll, and completed set updates the display immediately, before checkpoint writes. Calculation elapsed time refreshes every 100ms. Short windows use a compact view to keep both games visible, showing the hit count and the two most recent targets; the reports retain every exact arrival. Redirected output uses sparse snapshots instead of cursor control codes.

Both games simulate abilities. Every seventh ordinary placement attempts to spawn an icon on a uniformly selected empty cell, with a 40% chance of a dot and 60% chance of a reroll. A fourth board icon removes the oldest. Clearing its row acquires a skill and 50 points if inventory space is available. At seven held skills, new icons do not spawn and uncollectable icons remain on the board after a clear. Dots cost one held skill and score one placement point without advancing the spawn counter. Rerolls spend a skill and draw a replacement from the observed distribution. The dashboard shows inventory, uses, acquired skills, board icons, and the next spawn count.

Runs from before the capacity-rule correction spawned icons at seven held skills and removed uncollectable icons. Those results use a different model. Start a new run to use the corrected rules; old checkpoints cannot resume under changed algorithm hashes.

Ctrl+C saves checkpoints. Resume with the command printed in the report; the snapshot retains the two-game preset, so it needs no additional settings. A single game may finish before the other. Results are written under `test-results`; this preset does not open a browser or server.

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
