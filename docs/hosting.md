# Hosting

The public service uses `hosted/server.mjs`, not the local state server. It needs Node.js 22.13 or later for the built-in SQLite module. There are no runtime npm dependencies. Nginx terminates HTTPS and forwards only the four configured Moa Helper hosts to loopback port 3211. The supplied systemd unit runs as a dedicated unprivileged user with a 256 MiB memory limit.

## Data boundaries

- Browser storage: board, score, skills, markers, selected pieces, block library, preferences, personal observation counters and an anonymous contribution token. Storage is separate for each origin, browser and device.
- Shared SQLite database: a hash of each random contribution token, its latest revision, canonical shape/stage counts, and public aggregate counts. It starts empty, independently of `data/state.json`.
- Public statistics: normal draws and rerolls for all stages, including unknown-stage observations. Retries are idempotent; an older revision cannot replace a newer one. Undo replaces only the current browser's contribution. Game reset retains observations.
- Images and placement search: processed in the browser. No video, screenshots, board state, score, custom names, or arbitrary shapes are sent to the public service.

The hosted statistics screen is read-only and has no forum export. The export controls and browser modules are available only in the local application. Placement forecasts map public counts back to the player's local library by rotation/reflection equivalence. If no shared counts exist, the solver uses its existing fallback behavior.

The service validates shape IDs, stage buckets, integer counts, payload size and write origins. Per-address limits reduce accidental or automated flooding. Anonymous visitors can still submit inaccurate counts; these are community observations, not verified game telemetry or official probabilities. Deleting browser data does not remove previously contributed counts, but it does remove that browser's token and progress. A network failure keeps pending counts in the browser for retry.

## Deployment

1. Run `npm test`, `npm run test:hosted` and `npm run release:bundle`. These commands do not open browsers. The hosted tests exercise a request handler in memory and use temporary SQLite files without starting a server.
2. Extract the source bundle into a new directory under `/opt/moa-helper/releases/`. Never copy `data/state.json`, private SSH keys or local test output.
3. Create the `moa-helper` system user. Install [the systemd unit](../hosted/moa-helper.service) in `/etc/systemd/system/`.
4. Install [the HTTP configuration](../hosted/nginx-http.conf) as a separate Nginx site. Leave existing sites intact. Validate with `nginx -t`, then reload Nginx.
5. Obtain a certificate named `moa-helper` for all four names using Certbot's webroot mode and `/var/www/html`. Install [the HTTPS configuration](../hosted/nginx-https.conf). Its Cloudflare real-IP snippet must contain only Cloudflare's published address ranges and `real_ip_header CF-Connecting-IP`.
6. Point `/opt/moa-helper/current` at the new release, reload systemd and enable/start `moa-helper.service`. The service's state directory is `/var/lib/moa-helper`; it persists across releases.
7. Check each HTTPS hostname, `/healthz`, `/api/statistics`, `/robots.txt`, `/sitemap.xml`, and the language routes. `/api/state` must return 404. A request with an unknown Host or a foreign write Origin must fail.

Rollback by repointing `current` to the previous release and restarting only `moa-helper.service`. Do not replace the data directory during a rollback. Certbot's renewal timer renews the certificate; a deployment hook reloads Nginx after renewal.

## Backups

Back up `statistics.sqlite` using SQLite's backup API so writes and WAL files are handled consistently. For example, Python's standard `sqlite3.Connection.backup` can copy it to a dated file in a protected backup directory. A plain copy of only the main SQLite file while the service is running can miss WAL transactions. Keep backups outside the web root and test restore into a separate database before changing the live file.

## Search and AI crawler access

Each domain has self-referencing canonical links, Korean/English `hreflang` alternates, a sitemap and an unrestricted public-page robots policy. Guides and statistics are rendered on the server and readable without JavaScript. App metadata includes WebSite/WebApplication JSON-LD, Open Graph and a social preview image. `/llms.txt` links to the same public content; it is a convenience file, not a ranking signal or an indexing guarantee.

These choices follow [Google's guidance for AI features](https://developers.google.com/search/docs/appearance/ai-features), [Bing's webmaster guidelines](https://www.bing.com/webmasters/help/bing-webmaster-guidelines-30fba23a), and [OpenAI's crawler documentation](https://developers.openai.com/api/docs/bots). Search engines may consolidate identical domains despite self-canonical links. Cloudflare bot settings can also restrict crawlers before requests reach Nginx. Search Console and Bing Webmaster account verification remain owner-managed; there are no fabricated verification tokens or ranking claims.

The deployed hosts are `moa.chocolily.dev`, `moa.moria-luluka.com`, `moa.morialuluka.com` and `moa.xn--o39a013c.tv` (`moa.응가.tv`). The apex domains and their other applications are outside this service.
