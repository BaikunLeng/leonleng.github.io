# Portrait feedback

The existing GitHub Pages site sends completed-message impressions and voluntary like/dislike votes to a small Cloudflare Worker with SQLite-backed Durable Object storage. No A/B assignment, replay recording, names, emails, or IP addresses are stored by this application.

- Each message has a stable SHA-256-derived catalog ID.
- A random browser ID is kept in localStorage; the server stores only its hash.
- Impressions and votes each have a unique `(browser, phrase)` key. Retried requests do not inflate counts. The first vote is immutable.
- An impression is sent after the message finishes typing while the bubble is on screen and the tab is visible. An interrupted message is not counted. Failed requests can retry when the browser comes online or votes.
- Existing non-repeating messages, typing, hover behavior, automatic dismissal, bubble design, and page content are retained.
- Browser identity does not identify a real person across devices. Clearing browser storage or changing browsers creates a new identity.
- Public writes accept only catalog messages and the site's allowed origins. Read access requires a private admin token. CORS and browser IDs are lightweight abuse controls, not authenticated accounts.

## Read the totals

Run from the repository checkout:

```
node feedback/report.mjs /absolute/path/portrait-feedback.csv
```

The report includes every message's text, impressions, likes and dislikes. The script reads its admin credential from `~/.codex/private/leonleng-feedback-admin-token` or `LEON_FEEDBACK_TOKEN_FILE` / `LEON_FEEDBACK_ADMIN_TOKEN`. Never commit this credential or place it in browser code. The deployed Worker secret is `ADMIN_TOKEN`.

## Deployment and local preview

```
npx wrangler deploy --config feedback/worker/wrangler.jsonc
npx wrangler dev --config feedback/worker/wrangler.jsonc --port 8787 --var ALLOW_LOCAL:1
```

Serve the website on localhost port 8782 for preview. Local previews use the local Worker and separate local data. `/admin/test/events` and `/admin/test/report` require admin authorization and use an isolated test object. Live reporting uses `/admin/report`.

The service uses features available in Cloudflare's Workers Free plan; no paid subscription was enabled for this change. Free quotas apply. See https://developers.cloudflare.com/durable-objects/platform/pricing/ .
