# User guide

[README](../README.md)

Choose English in the language selector at the top of the page. This guide uses the English control labels. The browser remembers your choice; changing language preserves the board, selected pieces, recommendation, and statistics. Block names and Hangul input remain unchanged.

## Block library

Use **Create block** to draw a shape on a 10 × 10 grid. Assign a name, rotate or reflect it if needed, and save. Empty margins are trimmed. Hover over a block to reveal its edit control.

For the supplied library, select **Add all default blocks** or import [the example file](../examples/blocks.json). It contains all 19 unique shapes from the consolidated library, without private IDs or observation counts. Creating or importing a rotated or reflected duplicate does not add another entry.

**Merge equivalent shapes** consolidates existing duplicate entries. The identity with the highest combined normal/reroll count survives; ties keep the first entry in library order. Normal and reroll totals are added separately, including each stage. An active piece keeps its orientation, instance ID, used state, and pending observation marker. Undo can restore a merge made through the interface.

Enter three one-character names in the search field and press Enter to select a complete set. Repeated names fill separate slots. When the search field is empty or all three slots are registered, Enter finds a placement plan for the current set. Use **Reset selection** before entering a replacement set.

With no input field focused, typing an alphabetic key focuses block search and inserts that key. **Quick input** selects and searches as soon as three valid names are entered, without Enter. It waits for Hangul composition to finish and remembers its setting after a restart. Unknown or ambiguous names require correction before a plan can run.

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

**Reset game** clears the board, selected pieces, score, cleared-line count, held skills, ability markers and their arrival order. The spawn countdown returns to seven. The library, observations, custom targets and preferences are retained. **Undo** restores the previous game in one step.

## Plans and completion

Select three pieces, then press **Find placement plan**. Matching colors connect board overlays to the move list. If a later move reuses a cleared location, that cell contains multiple colors.

Order numbers disappear only when all placements are disjoint and every permutation produces the same cleared rows, final board, and score. Numbers remain for prerequisite clears, score-sensitive combinations, skills, and target-score stopping points.

Click a move to inspect it, use **Show full plan** for the full plan, or use the playback button and slider. These controls do not commit moves.

After following the plan in the game, press **Complete**. The helper applies the plan and empties the three-piece selection. **Apply partial plan** commits only a partial plan and keeps unused pieces. A partial result or search timeout is not a death verdict.

For manual placement, choose **Place manually** on a selected piece and click its origin on the board. Coordinates refer to the top-left of the transformed shape. R rotates, F reflects, and Esc cancels. If a recommendation includes reflection, reflect horizontally before rotating clockwise.

Recommendations use the saved normal-draw records for the stage selected by the cleared-line count. Update that count when joining an ongoing game. Candidate plans that cross a stage boundary are evaluated against the next stage's records. Missing stage records fall back to overall observations. The calculation details show the stage and sample count used; observations estimate the distribution and do not guarantee a score.

When a crowded board has blocked shapes, difficult gaps, and little recovery capacity, **Consider restarting** appears below the recommendation. It lists occupied cells, blocked shape types, remaining skills, and dots. These figures describe the board after the proposed moves. Recovery is still possible, so the message does not predict a final score. Continue playing or use its **Reset game** button; resets remain manual and can be undone.

## Screen sharing and pasted images

Select **Screen capture**, then **Start sharing**, and choose the game window. You can also paste an image with Ctrl+V in this mode. Press **Recognize · read one frame** to read the board and three pieces and request a plan. Pasting alone does not analyze the image.

The browser plays the live video. Recognition is manual by default. Enable **Auto recognition · 0.5s** to read a frame every half second while sharing. This preference is remembered. Recognition pauses while regions are being adjusted, a dialog is open, or the statistics screen is visible. Browser scheduling can slow the interval in background tabs.

Automatic reads preserve the current plan while you place the pieces. Press **Complete · apply plan** after following the plan in the game. The helper waits for the confirmed board before accepting the next pieces. Repeated frames do not restart the search or add draw records; statistics are recorded on completion. Use the recognition button to correct a reading or resume from a different board. Reroll results still need explicit confirmation. Pasted images and the example image are read only by the button.

Recognized shapes are matched against saved blocks, including rotations and reflections. **Try example image** loads a reference image and excludes it from statistics.

If recognition regions are wrong, open **Regions and recognition**. Select the board or a piece region, then drag over the preview. The board region should contain the grid without its outer border; each piece region should contain the small shape inside its card. Use **Find regions automatically** after moving or resizing the game. Press recognition again after changing regions or blue-block sensitivity.

Correct an incorrect board in the editor below the preview. Shapes without a unique name remain unclassified in statistics. Score, cleared line count, skill inventory, and ability positions must be entered manually.

Switching to manual mode, pasting an image, or stopping sharing closes the video tracks. Sharing permissions and source images are not saved.

## Skills and ability markers

Enter the number of dot and reroll skills you currently hold. The input permits a combined total of seven, but a completed plan must leave six or fewer. This check includes marked abilities collected during the plan.

A dot skill places one cell in any empty location. Plans can use several dots between ordinary pieces. Viewing a recommendation does not spend a skill.

A reroll outcome is unknown until you perform it. Follow the recommended prefix in the game, reroll the indicated piece, then enter the resulting name and press Enter. The helper applies the prefix and spent skill and continues searching. The same shape may be entered again as a new draw. With screen input, press recognition and then **Apply captured reroll** to confirm the observed result.

The helper can suggest a reroll while the current pieces still fit if sampled replacements offer better placement space. It also gives scarce dots more value as a reserve for difficult gaps. A proposed skill use is applied only when you confirm it.

The board tools **◎ Dot** and **↔ Reroll** mark ability locations. Selecting the same type on the same cell removes its marker. Occupied cells may also contain markers. Clearing a marked row adds the ability and 50 points when the inventory rules permit acquisition.

Ordinary piece placements advance the ability timer; dot skills do not. Enter the remaining count in **Placements until spawn**. Every seventh ordinary placement can create an ability, and at most three remain on the board. At seven held skills, new icons do not appear. Clearing a marked row at capacity leaves the uncollected icon at its original position without adding points. A later clear can collect it after a skill has been spent.

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

Open **Target list** to add custom targets. Enter a whole number from 1 to 500,000 and press Enter or **Add**; repeat for additional targets. Up to 100 custom targets are saved, with duplicates removed. They remain active when **Auto targets** is off. With auto targets on, both lists participate in the same search. Each custom target has a remove button; **Active targets** shows the combined list in ascending order.

## Draw statistics

**Draw statistics** opens a separate screen with normal draws, rerolls, and combined observations for all stages or a selected stage. **Back to play** returns to the previous manual or capture screen, preserving the current plan and live sharing session. Browser Back and Forward also navigate between screens. Filters remain in place while switching screens.

**Export for a forum** creates tables containing block names, HTML block shapes, stage columns, percentages and counts. Normal draws and rerolls use separate tables and denominators. Choose both sources or one, all stages or the current scope, and Korean or English. The post contains no commentary, timestamp, CSS, images or scripts. Shapes use nested table cells with HTML size and background attributes.

Use **Copy table** for a rich-text editor, **Copy HTML source** for its HTML mode, or **Save HTML file** to download the document. If clipboard access fails, the source is selected for manual copying. The preview shows the exported HTML. Exports ignore the search filter, retain unidentified and deleted-block counts, and use the current sort choice. Overall counts include all stages without double counting; unknown-stage columns appear in a full export only when records exist. Exporting does not record pending recognized pieces or change the save.

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

Edit a count and press Enter or leave the field to save its cumulative value. Stage edits update the overall total. An overall total cannot be lower than the sum of its stage records. **Reset all statistics** clears all records regardless of search or stage filters; the statistics screen's **Undo** button can restore them.

At the start of a new game, set score and cleared lines to zero. Clearing the board or resetting selected pieces does not reset those values.

## Storage and shortcuts

`data/state.json` contains the library, board, selection, skills, score, and statistics. If a server save fails, the browser keeps a recovery copy and displays **Retry save**. Block export contains only the library.

**Small window** opens an always-on-top plan window in supported browsers. It does not create a transparent click-through overlay over the game. The board's ⛶ button opens focus mode.

| Key | Action |
| --- | --- |
| `/` | Focus block search |
| `A`–`Z` | Focus block search and insert the key when no input is focused |
| Enter | Find a plan from an empty search field, a registered set, or the playfield |
| `1` / `2` | Mark Dot / Reroll at the board cell under the pointer |
| Backtick | Remove the ability marker under the pointer |
| `Ctrl+K` / `⌘K` | Open the command menu |
| `R` / `F` | Rotate / reflect during manual placement |
| `Esc` | Cancel placement, exit focus mode, or return from statistics |
| Arrow keys / Space | Navigate / toggle board and editor cells |

The operating system's reduced-motion preference disables decorative transitions.

Ability shortcuts edit board markers, leaving held inventory and occupied cells unchanged. They follow the selected **Ability to add** arrival-order setting. Shortcuts are ignored in other input fields and dialogs; Enter keeps its normal behavior on action buttons. During manual placement, R and F retain their transformation actions.

## Troubleshooting

If the game panel moves inside a shared window, press recognition again. When the old regions fail, the helper attempts to find the board and all three cards in that same frame. If recognition still reports uncertain cells, redefine the regions and retry. If the helper and game disagree, re-read the current screen or edit the board; separately check score, cleared lines, and skills.

If the port is occupied, check for an existing server. In PowerShell, set `$env:PORT=3211`, then run `npm start`. On macOS/Linux, use `PORT=3211 npm start`.

If a save-format warning appears, stop and restart the server and reload the page. For a frontend-only update, Ctrl+Shift+R refreshes the files. Reload after a library migration before making more edits in an older tab.
