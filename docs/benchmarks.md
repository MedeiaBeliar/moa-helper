# Historical benchmarks

[README](../README.md) · [Running current tests](testing.md)

These results come from the original eight-second and one-second simulations stopped on October 2, 2026. Both games were stopped by user request before death. Scores below are progress at termination, not final death scores.

| Version | Displayed score | Completed sets | Recommendations | Mean calculation | Maximum | Calls over 1s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| One-second | 500,000 | 1,066 | 1,177 | 478ms | 829ms | 0 |
| Original eight-second | 60,826 | 93 | 97 | 7,669ms | 7,988ms | 97 |

The one-second version reached the display cap during set 802. The runs have different play lengths, so this is not a comparison at equal set counts. Neither run used the separate fallback policy. The application now exposes only the one-second algorithm.

## Conditions

Both runs began on empty boards with seed 509 on a Ryzen 5 5600G, 32GB RAM, and Node 22.20. Normal draws, rerolls, ability locations, and ability types used separate random streams. Policies consumed those streams at different rates as their placements and skill use diverged.

The input contained 21 historical identities with 599 normal and 18 reroll observations. The model added one prior observation per identity to normal draws and a 30-observation prior following the normal distribution to rerolls. Stage-specific samples were unavailable, so the same overall distribution was used at every stage. This does not reproduce the game's confirmed late-stage difficulty.

These runs excluded the one placement point for dot skills. The current version includes it. Historical scores have not been recomputed. They also predate library consolidation and the correction that prevents spawns at seven held skills and retains uncollectable board icons. The table does not contain a completed death comparison under the current rules and library.

Calculation time measures one worker round trip. A recommendation after a reroll is a separate call, not the total duration of a set. A separate browser check measured up to 908ms from click to display and 961ms to recover a stalled worker's result. Timing depends on hardware and load.

## Identical-board comparison

This experiment measured points from one recommended plan, not a full game.

| Board | Original time | One-second time | Original plan points | One-second plan points |
| --- | ---: | ---: | ---: | ---: |
| Empty board, three large pieces | 7,919ms | 790ms | 1,229 | 1,229 |
| Seven dot skills available | 7,934ms | 791ms | 620 | 320 |
| Fragmented free space | 5,429ms | 372ms | 1,229 | 1,229 |
| Board from an ongoing simulation | 7,925ms | 765ms | 321 | 321 |

Both versions placed all three pieces in every case. The original gained 300 more points on one board; the shorter budget does not preserve plan quality in every position.

See [Testing](testing.md) to run a new experiment. Historical checkpoints and private output files are not included in the source bundle.
