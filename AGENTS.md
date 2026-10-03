# Project constraints

- Do not launch a web server for development or testing.
- Do not launch browsers or run browser automation tests. This includes `npm run test:ui` and `tests/*-browser.mjs`.
- Use Node-only checks and isolated temporary fixtures for validation. Do not change `data/state.json` during tests.
- Do not add GitHub Actions or hosted CI workflows.
- Keep documentation in English. Keep the application available in Korean and English.
- Scored game tests must run to verified death unless the requested mode explicitly ends at 500,000 points. Do not report an interrupted run as a final score.
