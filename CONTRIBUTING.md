# Contributing

Describe the behavior you want to change and provide a reproducible case. Keep bug fixes close to the affected module. Separate algorithm changes from visual redesigns when they can be reviewed independently.

## Development environment

Use Node.js 20 or later. The application needs no installation or build step. Playwright is required only for browser tests.

```sh
npm ci
npx playwright install chromium
npm test
npm run test:ui
npm run check:release
```

See [Architecture](docs/architecture.md) for module boundaries and [Testing](docs/testing.md) for command scope. Unit and browser tests do not open a server. Use temporary state or fixtures rather than a player's save.

## Review criteria

Changes to board state, scores, or inventory need a small reproduction board and an expected result. Check simultaneous row clears, the dot-placement point, 50-point acquisitions, inventory limits, order independence, and partial commits. A failed search must not become a death verdict.

Recognition changes should include a minimal image that reproduces the problem. Keep analysis tied to the recognition button and preserve deferred statistics for recognized pieces.

For UI changes, include desktop and narrow-screen captures. Check keyboard focus, reduced motion, the small window, and overlay alignment. Decorative effects must not introduce a frame-processing loop or interfere with search result delivery.

Compare performance changes under the same input and time budget. Distinguish progress scores from death scores, and one recommendation's duration from an entire set. State what you measured and which environments remain untested.

## Submitting changes

A pull request should explain the problem, resulting behavior, and validation. Update the relevant guide when controls change. New persistence fields must preserve old saves and browser recovery data.

Do not submit `data/`, `test-results/`, `node_modules/`, or logs containing personal paths. Remove account names and chat content from screenshots. Record new asset sources and licenses in [Third-party notices](THIRD_PARTY_NOTICES.md).

The interface is Korean. Repository documentation, contribution material, and issue templates are maintained in English.
