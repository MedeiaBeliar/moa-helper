# User guide

[README](../README.md)

Choose English in the language selector at the top of the page. This guide uses the English control labels. The browser remembers your choice; changing language preserves the board, selected pieces, recommendation, and statistics. Block names and Hangul input remain unchanged.

## Block library

Use **Create block** to draw a shape on a 10 × 10 grid. Assign a name, rotate or reflect it if needed, and save. Empty margins are trimmed. Hover over a block to reveal its edit control.

For the supplied library, select **Add all default blocks** or import [the example file](../examples/blocks.json). It contains all 19 unique shapes from the consolidated library, without private IDs or observation counts. Creating or importing a rotated or reflected duplicate does not add another entry.

**Merge equivalent shapes** consolidates existing duplicate entries. The identity with the highest combined normal/reroll count survives; ties keep the first entry in library order. Normal and reroll totals are added separately, including each stage. An active piece keeps its orientation, instance ID, used state, and pending observation marker. Undo can restore a merge made through the interface.

Enter three one-character names in the search field and press Enter to select a complete set. Repeated names fill separate slots.

| Input | Selected names |
| --- | --- |
| `ㅅㅅㅡ`, `ttm`, `ㅅ ㅅ ㅡ` | `ㅅ`, `ㅅ`, `ㅡ` |
| `ㄿㄱ`, `fvr` | `ㄹ`, `ㅍ`, `ㄱ` |
| `ㄳㅇ`, `rtd` | `ㄱ`, `ㅅ`, `ㅇ` |
| `긔`, `rml` | `ㄱ`, `ㅡ`, `ㅣ` |

Compound consonants, vowels, and composed syllables are split into basic letters. Missing or ambiguous names leave the selection unchanged. The same normalization applies to statistics search and reroll input.

## Board editing

Click or drag to mark occupied cells. Click again to clear them, or select the eraser. This editor copies the current game state, so filling a row manually does not immediately clear it. Rows clear when a piece or a recommended plan is committed.

The default board is 10 columns × 16 rows. **Rules and placement settings** contains dimensions and rotation/reflection settings. Only complete horizontal rows clear; other cells stay in place.

## Plans and completion

Select three pieces, then press **Find placement plan**. Matching colors connect board overlays to the move list. If a later move reuses a cleared location, that cell contains multiple colors.

Order numbers disappear only when all placements are disjoint and every permutation produces the same cleared rows, final board, and score. Numbers remain for prerequisite clears, score-sensitive combinations, skills, and target-score stopping points.

Click a move to inspect it, use **Show full plan** for the full plan, or use the playback button and slider. These controls do not commit moves.

After following the plan in the game, press **Complete**. The helper applies the plan and empties the three-piece selection. **Apply partial plan** commits only a partial plan and keeps unused pieces. A partial result or search timeout is not a death verdict.

For manual placement, choose **Place manually** on a selected piece and click its origin on the board. Coordinates refer to the top-left of the transformed shape. R rotates, F reflects, and Esc cancels. If a recommendation includes reflection, reflect horizontally before rotating clockwise.

## Screen sharing and pasted images

Select **Screen capture**, then **Start sharing**, and choose the game window. You can also paste an image with Ctrl+V in this mode. Press **Recognize · read one frame** to read the board and three pieces and request a plan. Pasting alone does not analyze the image.

The browser plays the live video. The helper does not periodically copy or analyze frames, and it keeps the existing recommendation until recognition is requested again. Recognized shapes are matched against saved blocks, including rotations and reflections. **Try example image** loads a reference image and excludes it from statistics.

If recognition regions are wrong, open **Regions and recognition**. Select the board or a piece region, then drag over the preview. The board region should contain the grid without its outer border; each piece region should contain the small shape inside its card. Use **Find regions automatically** after moving or resizing the game. Press recognition again after changing regions or blue-block sensitivity.

Correct an incorrect board in the editor below the preview. Shapes without a unique name remain unclassified in statistics. Score, cleared line count, skill inventory, and ability positions must be entered manually.

Switching to manual mode, pasting an image, or stopping sharing closes the video tracks. Sharing permissions and source images are not saved.

## Skills and ability markers

Enter the number of dot and reroll skills you currently hold. The input permits a combined total of seven, but a completed plan must leave six or fewer. This check includes marked abilities collected during the plan.

A dot skill places one cell in any empty location. Plans can use several dots between ordinary pieces. Viewing a recommendation does not spend a skill.

A reroll outcome is unknown until you perform it. Follow the recommended prefix in the game, reroll the indicated piece, then enter the resulting name and press Enter. The helper applies the prefix and spent skill and continues searching. The same shape may be entered again as a new draw. With screen input, press recognition and then **Apply captured reroll** to confirm the observed result.

The board tools **◎ Dot** and **↔ Reroll** mark ability locations. Selecting the same type on the same cell removes its marker. Occupied cells may also contain markers. Clearing a marked row adds the ability and 50 points when the inventory rules permit acquisition.

Ordinary piece placements advance the ability timer; dot skills do not. Enter the remaining count in **Placements until spawn**. An ability appears every seven ordinary placements, and at most three remain on the board.

Choose **Existing · unknown order** when the creation order is unknown and remove vanished markers manually. Use **New arrival · track order** for subsequent abilities. Once all remaining creation orders are known, a fourth arrival removes the oldest. Future locations are not predicted.

## Scoring and targets

| Action | Points |
| --- | ---: |
| Ordinary piece placement | Number of cells in the piece |
| Dot placement | 1 |
| n horizontal rows cleared by one action | 300 × n² |
| Ability acquisition | 50 |

Rows cleared by separate actions do not combine into one bonus. Displayed score is capped at 500,000. Editing the skill count or performing a reroll does not add acquisition points. If an unmarked ability was acquired, use **+50 adjust** and correct the inventory manually.

**Auto targets** searches the following targets:

```text
100000  111111  120200  123456  150000  200000  211000  211211
222222  250000  300000  333333  350000  400000  444444  450000
```

The search prioritizes completing the set and retaining useful space. It seeks an exact target or a safe approach without overshooting, then falls back to a scoring plan when needed. If a target occurs before the end, **Apply through target** commits that prefix and retains the remaining pieces. It is offered only when the rest of the set has a legal continuation and the stopping point leaves fewer than seven skills.

## Draw statistics

**Draw statistics** shows normal draws, rerolls, and combined observations for all stages or a selected stage.

[View the statistics panel](images/statistics.png).

| Stage | Cumulative cleared rows |
| --- | --- |
| 1 | 0 to 30 |
| 2 | 31 to 60 |
| 3 | 61 to 100 |
| 4 | 101 to 150 |
| 5 | 151 or more |

A normal draw keeps the stage at which it appeared, even if later placements cross a stage boundary. Overall statistics include all stages and observations with an unknown stage. Filtering does not change the selected scope's denominator. Observed percentages are not the game's confirmed draw probabilities.

Manually selected pieces are recorded together at the first recommendation or direct placement. Recognized pieces are recorded individually when committed. Manual rerolls are recorded when their results are confirmed; recognized rerolls are recorded when placed. Recommending again or reloading does not recount the same draw.

Edit a count and press Enter or leave the field to save its cumulative value. Stage edits update the overall total. An overall total cannot be lower than the sum of its stage records. **Reset all statistics** clears all records regardless of search or stage filters; Undo can restore them.

At the start of a new game, set score and cleared lines to zero. Clearing the board or resetting selected pieces does not reset those values.

## Storage and shortcuts

`data/state.json` contains the library, board, selection, skills, score, and statistics. If a server save fails, the browser keeps a recovery copy and displays **Retry save**. Block export contains only the library.

**Small window** opens an always-on-top plan window in supported browsers. It does not create a transparent click-through overlay over the game. The board's ⛶ button opens focus mode.

| Key | Action |
| --- | --- |
| `/` | Focus block search |
| `Ctrl+K` / `⌘K` | Open the command menu |
| `R` / `F` | Rotate / reflect during manual placement |
| `Esc` | Cancel placement or exit focus mode |
| Arrow keys / Space | Navigate / toggle board and editor cells |

The operating system's reduced-motion preference disables decorative transitions.

## Troubleshooting

For shifted recognition, redefine the regions and press recognition again. If the helper and game disagree, re-read the current screen or edit the board; separately check score, cleared lines, and skills.

If the port is occupied, check for an existing server. In PowerShell, set `$env:PORT=3211`, then run `npm start`. On macOS/Linux, use `PORT=3211 npm start`.

If a save-format warning appears, stop and restart the server and reload the page. For a frontend-only update, Ctrl+Shift+R refreshes the files. Reload after a library migration before making more edits in an older tab.
