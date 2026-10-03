# Security

The local entry point, `server.mjs`, is for one computer and binds to `127.0.0.1`. Do not expose its state API to the internet.

The separate hosted entry point, `hosted/server.mjs`, has no state API. It accepts only canonical shape IDs, stage buckets, counts, anonymous contributor tokens and monotonic revisions. Progress and screenshots stay in the browser. Public responses contain aggregates, not contributor records. The Node listener remains on loopback behind HTTPS Nginx with an explicit hostname allowlist, strict write-origin checks, request size limits and rate limits. SQLite transactions keep replacements and undo atomic.

Anonymous observations are not authenticated game telemetry. Rate limits and validation constrain malformed submissions but cannot prove that a submitted count came from a real game. Treat public frequencies as community observations, not official probabilities. Do not put secrets in browser storage. A stolen contributor token could alter that contributor's own counts.

The save contains block definitions, game state, and observations. Source video and clipboard images are processed in the browser. Keep the server's Host, Origin, path, and state validation checks in place.

Use **Security → Report a vulnerability** when private reporting is enabled on the repository. If it is unavailable, open an issue requesting a private contact method without posting exploit details or personal data.

Include the affected behavior, environment, and minimal reproduction. Full save directories and account information are not required. No response-time or long-term-support commitment has been established.
