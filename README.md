# 모아모아 도우미

Moa Helper is a local puzzle assistant for MapleStory's **Hangul Moa Moa** event, running from **October 1, 2026 at 10:00 AM to October 14, 2026 at 11:59 PM (KST)**. It is an unofficial project for personal use and learning.

Enter the board and three pieces, or read a shared screen, to find a placement plan with rotations, reflections, and available skills. The helper shows the moves; you place the pieces in the game.

[Getting started](#getting-started) · [User guide](docs/guide.md) · [Architecture](docs/architecture.md) · [Testing](docs/testing.md) · [Contributing](CONTRIBUTING.md)

![Moa Helper showing the current board, three selected pieces, and a color-coded placement plan](docs/images/playfield.png)

## Getting started

Install [Node.js](https://nodejs.org/) 20 or later, download this repository, and run the following command from the project directory:

```sh
npm start
```

Open [localhost:3210](http://localhost:3210). The application has no runtime package dependencies and requires no installation or build step. On Windows, you can also double-click `start.cmd`. Press `Ctrl+C` in the server console to stop it.

The first launch has an empty block library. Choose **기본 블록 모두 추가** to load all **19 unique shapes**, or import [`examples/blocks.json`](examples/blocks.json) using **불러오기**. The in-game interface remains in Korean; project documentation is in English.

Desktop Chrome or Edge is recommended for screen sharing and the optional always-on-top window. The latter requires Document Picture-in-Picture support.

## Playing a set

1. Match the board, score, cleared line count, and skill inventory to the game. In screen-sharing mode, you can paste a screenshot and press the recognition button.
2. Select three pieces. Enter `ㅅㅅㅡ`, or its English keyboard equivalent `ttm`, in the search field and press Enter to fill all three slots.
3. Request a placement plan. All three pieces appear on the board at once, distinguished by color. Numbers appear when placement order affects the result.
4. Follow the plan in the game, then confirm completion. The helper updates the board, score, skills, and statistics, and clears the three selection slots.

Select a move, play the sequence, or scrub through individual steps to inspect a plan. Previews do not change the saved board. Undo restores an incorrectly committed action.

## Features

| Area | Behavior |
| --- | --- |
| Placement search | Prioritizes placing all three pieces, then compares simultaneous line-clear scores and space for future pieces. |
| Screen input | Reads a shared screen or pasted image only when recognition is requested. Video preview uses native browser playback. |
| Skills | Places dot skills between ordinary pieces and asks for actual reroll results. A completed plan must leave fewer than seven held skills. |
| Target scores | Searches a list of 16 targets from 100,000 upward. Falls back to a scoring plan when a safe target path is unavailable. |
| Draw statistics | Tracks normal draws and rerolls across all stages and by stage. Supports direct count editing, filtering, and sorting. |
| Block library | Includes a dot editor, import/export, and rotation/reflection duplicate detection. Duplicate records merge into the most-observed identity. |
| Keyboard input | Accepts Hangul, English two-set keyboard input, and composed syllables: `ㄿㄱ` becomes `ㄹㅍㄱ`; `긔` becomes `ㄱㅡㅣ`. |
| Always-on-top view | Shows the plan and completion control in a separate supported browser window. |

Recognized pieces are counted only after their placements are committed. Re-reading or correcting the same image does not count another draw.

## Search budget and measured results

The solver runs in a Web Worker with an **850ms search budget**. A **950ms browser watchdog** recovers the latest available plan. Browser scheduling and system load can delay display beyond that time.

A historical simulation reached the 500,000 display cap. Across 1,177 recommendations, average calculation time was 478ms and the maximum was 829ms. The run stopped before death, used an estimated distribution shared across stages, and predates a scoring correction for dot skills. These numbers do not predict live-game scores. See the [benchmark conditions and comparison](docs/benchmarks.md).

Future draws are unknown. The search compares candidates and sampled future pieces within its time budget; it cannot guarantee a globally optimal plan or an exact target score.

## Data and privacy

Blocks, board state, skills, score, and statistics are stored in `data/state.json`. Back up the `data` directory to preserve a game. Block export contains only the block library.

The server binds to `127.0.0.1`. Video and clipboard images are analyzed in the browser and are not sent to the server. Pretendard is bundled locally, so the running application requires no external service connection. Personal saves, generated test output, and installed packages are excluded from the source bundle.

## Development

```sh
npm ci
npx playwright install chromium
npm test
npm run test:ui
npm run check:release
```

Unit and UI tests do not start a web server. UI tests intercept browser requests and use isolated temporary state. HTTP checks and long simulations are separate commands, described in [Testing](docs/testing.md).

To create a source ZIP for a new GitHub repository:

```sh
npm run release:bundle
```

Extract `releases/moa-helper-github.zip` and use its `moa-helper` directory as the repository root. It contains source, documentation, examples, tests, and contribution templates. See [Publishing](docs/publishing.md) for the remaining steps.

## Documentation

- [User guide](docs/guide.md): input, capture, skills, targets, statistics, and backups
- [Architecture](docs/architecture.md): modules, search, and state transitions
- [Testing](docs/testing.md): regression checks and simulations that run until death
- [Contributing](CONTRIBUTING.md): change scope, reproduction cases, and validation
- [Security](SECURITY.md): local-server scope and vulnerability reporting

## Disclaimer and license

MapleStory trademarks, logos, game images, and related rights belong to Nexon and their respective rights holders. This project is made for personal use and learning. It is not developed, approved, endorsed, or sponsored by Nexon and is not affiliated with MapleStory or TETR.IO.

Source code is available under the [MIT license](LICENSE). Bundled fonts and game reference images have [separate notices](THIRD_PARTY_NOTICES.md). The code license does not grant rights to MapleStory assets or trademarks.
