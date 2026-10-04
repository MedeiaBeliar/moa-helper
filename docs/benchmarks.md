# Benchmarks

[README](../README.md) · [Running current tests](testing.md)

## October 3 strategy experiments

These experiments used 19 unique shapes, 2,472 normal observations and 62 reroll observations, with separate records for all five stages. Normal sample counts by stage were 666, 447, 458, 450 and 451; reroll counts were 0, 0, 8, 21 and 33. Missing reroll stages used the overall prior. The private input snapshot was frozen throughout the comparison.

Runs used Node 22.20.0 on Windows, a Ryzen 5 5600G and 32GB RAM. Two games ran concurrently at normal priority with automatic targets enabled, an 850ms search budget and a 950ms host watchdog. Ordinary draws, rerolls, icon positions and icon types used separate random streams. Each game ended at verified death or the preset's 500,000-point cap. No scored run was stopped early or reset after a warning.

The model includes one point per dot, 300 × n² for simultaneous row clears, 50 points per acquired ability, the seven-placement spawn interval, 40% dot / 60% reroll icons, oldest-icon expiry above three, and retained icons at full inventory. Future icon positions remain hidden from the solver.

### Current policy

The selected policy combines full-distribution next-piece evaluation, scarce-dot preservation and symmetry deduplication. Seeds 509–512 were used during tuning. Seeds 513 and 514 were tested after selecting the policy, with no further search changes.

| Seed | Final score | Endpoint | Completed sets | Recommendations | Mean | Maximum |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| 509 | 106,403 | Verified death | 176 | 190 | 303ms | 649ms |
| 510 | 251,000 | Verified death | 400 | 437 | 264ms | 657ms |
| 511 | 337,257 | Verified death | 536 | 600 | 260ms | 660ms |
| 512 | 217,274 | Verified death | 352 | 397 | 305ms | 685ms |
| 513 | 151,365 | Verified death | 237 | 262 | 224ms | 630ms |
| 514 | 500,000 | Display cap | 789 | 881 | 233ms | 584ms |

The mean displayed score was 260,550, with a minimum of 106,403. Four of six games reached 200,000; one reached the cap. **The requested 200,000-point floor was not achieved.** Six runs, including reused tuning seeds, cannot establish a general score guarantee.

Across 2,767 recommendations, the weighted mean round-trip time was approximately 258ms, with no calls over one second and no watchdog recoveries. A set needing several rerolls can require several recommendations: the maximum cumulative calculation time for one set was 2,379ms. These measurements exclude human input time and do not guarantee timing under different system load. No browser or server was launched for these checks.

Seed 512 touched the exact 150,000 target and continued to death. Cap completion in seed 514 was recorded separately from death. Private checkpoints preserve the complete result summaries, algorithm hashes and recent board traces.

### Previous policy under the same rules

The policy from commit `62f8152` was rerun with the same frozen observations and corrected ability model. Both games ended in verified death. The selected policy improved both measured scores; this pair remains part of the tuning data.

| Seed | Previous policy | Current policy |
| --- | ---: | ---: |
| 509 | 50,777 | 106,403 |
| 510 | 66,211 | 251,000 |

### Development results

Each cell lists the two final scores in seed order. A dash means that pair was not tested. All entries ended in verified death except the explicitly marked cap result. These are tuning results on reused seeds, not an independent estimate of a typical player's score.

| Experiment | Seeds 509 / 510 | Seeds 511 / 512 |
| --- | ---: | ---: |
| V1: cell coverage and occupancy | 68,759 / 65,942 | — |
| V2: narrow gaps and resources | 103,140 / 99,730 | — |
| V3: more sampled candidates | 119,788 / 56,028 | — |
| V4: local repair table | 45,682 / 47,460 | — |
| V5: preserve empty rows | 209,930 / 226,644 | 109,208 / 52,947 |
| V6: enumerate every next identity | 205,244 / 500,000 (cap) | 110,844 / 50,592 |
| V7: reduce immediate score weight | 169,914 / 269,330 | — |
| V8: stress hands | — | 57,614 / 52,100 |
| V9: preserve scarce dots | — | 108,403 / 399,524 |
| V10: wider beam | — | 109,426 / 53,727 |
| V11: favor marked dot rows | — | 58,267 / 324,250 |
| V12: favor future combinations | — | 185,626 / 62,394 |
| Require all reroll samples | 160,136 / 344,181 | 202,795 / 50,716 |
| Deduplicate symmetric candidate boards | 106,403 / 251,000 | 337,257 / 217,274 |

The 500,000 result belongs to V6, which also lost at 50,592 on another seed. It is not evidence of a score floor. The original reported 72,779 / 41,615 run predates the capacity-rule correction and is not an isolated algorithm comparison.

Restart warnings are not calibrated score predictions. In the symmetry run, seed 511 first received a warning at 171,877 and subsequently reached 337,257 without resetting. Seed 512 died without a warning. Advice can be premature or absent; benchmarks retain both outcomes.

## October 2 historical measurements

The following results come from the original eight-second and one-second simulations stopped on October 2, 2026. Both games were stopped by user request before death. Scores below are progress at termination, not final death scores.

| Version | Displayed score | Completed sets | Recommendations | Mean calculation | Maximum | Calls over 1s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| One-second | 500,000 | 1,066 | 1,177 | 478ms | 829ms | 0 |
| Original eight-second | 60,826 | 93 | 97 | 7,669ms | 7,988ms | 97 |

The one-second version reached the display cap during set 802. The runs have different play lengths, so this is not a comparison at equal set counts. Neither run used the separate fallback policy. The one-second algorithm was the default at the time of those runs. The imported native25 engine replaced it on October 4, 2026.

### Conditions

Both runs began on empty boards with seed 509 on a Ryzen 5 5600G, 32GB RAM, and Node 22.20. Normal draws, rerolls, ability locations, and ability types used separate random streams. Policies consumed those streams at different rates as their placements and skill use diverged.

The input contained 21 historical identities with 599 normal and 18 reroll observations. The model added one prior observation per identity to normal draws and a 30-observation prior following the normal distribution to rerolls. Stage-specific samples were unavailable, so the same overall distribution was used at every stage. This does not reproduce the game's confirmed late-stage difficulty.

These runs excluded the one placement point for dot skills. The current version includes it. Historical scores have not been recomputed. They also predate library consolidation and the correction that prevents spawns at seven held skills and retains uncollectable board icons. The table does not contain a completed death comparison under the current rules and library.

Calculation time measures one worker round trip. A recommendation after a reroll is a separate call, not the total duration of a set. A separate browser check measured up to 908ms from click to display and 961ms to recover a stalled worker's result. Timing depends on hardware and load.

### Identical-board comparison

This experiment measured points from one recommended plan, not a full game.

| Board | Original time | One-second time | Original plan points | One-second plan points |
| --- | ---: | ---: | ---: | ---: |
| Empty board, three large pieces | 7,919ms | 790ms | 1,229 | 1,229 |
| Seven dot skills available | 7,934ms | 791ms | 620 | 320 |
| Fragmented free space | 5,429ms | 372ms | 1,229 | 1,229 |
| Board from an ongoing simulation | 7,925ms | 765ms | 321 | 321 |

Both versions placed all three pieces in every case. The original gained 300 more points on one board; the shorter budget does not preserve plan quality in every position.

See [Testing](testing.md) to run a new experiment. Historical checkpoints and private output files are not included in the source bundle.
