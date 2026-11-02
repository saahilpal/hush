# Hush

A private, self-hosted email open tracker designed for cold job outreach. Hush tells you when recipients open your emails or click tracked links, with clear distinction between automated scanners, likely human opens, and confirmed link clicks.

Runs entirely on Cloudflare Workers and D1's **100% free tier** with zero external analytics, zero tracking watermarks, and zero stored IP addresses or user agents.

---

## Features

- **Invisible 1x1 Transparent GIF**: 43-byte image with `no-store` headers. Zero branding, zero images or badges in outgoing emails.
- **Three-Tier Classification**:
  - `Detected`: Automated security scanners (e.g. Proofpoint, Mimecast, Barracuda), data centers (AWS, Hetzner, etc.), Apple Mail privacy proxies, or pixel hits within the first 90 seconds.
  - `Likely opened`: Passed all automated filters and timing checks (Gmail proxy, Yahoo Mail, Outlook, mobile/desktop device).
  - `Confirmed`: Tracked link was clicked from a verified non-scanner client.
- **Privacy First**: IP addresses and raw user agents are never stored in the database.
- **Dashboard**:
  - Built strictly with vanilla DOM (`textContent`), no innerHTML, no frameworks, no external fonts or CDN calls.
  - Responsive down to 375px with automatic light and dark mode.
  - 3-bar signal glyph (0 bars = none, 1 grey = detected, 2 blue = likely opened, 3 green = confirmed/replied).
  - Tabs: All, Follow up, Opened, Replied.
  - Follow-up reminders (due after 3 days).
  - Detailed hit timeline with exact timestamps and reason breakdown.
  - One-click copy for pixel (`text/html` `<img>` + plain text fallback) and tracked link.
  - Tab visibility-aware 30s auto-refresh (respects D1 free read limits).
- **Chrome MV3 Extension ("Hush for Gmail")**:
  - Intercepts Gmail's Send button and keyboard shortcuts (Ctrl/Cmd+Enter).
  - Automatically provisions a tracking pixel via `POST /api/emails` with Bearer auth.
  - Strict 1.5s timeout: if the worker fails or times out, the email sends normally without delay or error.
  - Per-email toggle in compose window to enable/disable tracking.
- **Optional Push Notifications**: Real-time alerts via `ntfy.sh` on the first hit of each tier per email.

---

## Architecture & Stack

- **Runtime**: Cloudflare Workers (ES Module, plain JS, no build step).
- **Database**: Cloudflare D1 (SQLite at the edge).
- **Dashboard**: Inlined HTML imported into worker via Wrangler text rule.
- **Extension**: Chrome Manifest V3 content script and service worker.

---

## Deployment Guide

### Prerequisites
- Node.js (v18+) and npm
- Cloudflare account (Free tier)
- Wrangler CLI (`npx wrangler`)

### Step 1: Install & Login
```bash
git clone https://github.com/saahilpal17/hush.git
cd hush
npx wrangler login
```

### Step 2: Create D1 Database & Run Schema
```bash
npx wrangler d1 create hush
# Note the database_id from the output and ensure it is set in wrangler.toml under [[d1_databases]]
npx wrangler d1 execute DB --remote --file=./schema.sql
```

### Step 3: Set Secrets
```bash
echo -n "your-dashboard-password" | npx wrangler secret put PASSWORD
echo -n "your-bearer-api-token" | npx wrangler secret put API_TOKEN
# Optional push notifications:
echo -n "https://ntfy.sh/your-topic" | npx wrangler secret put NOTIFY_URL
```

### Step 4: Deploy
```bash
npx wrangler deploy
```

---

## Chrome Extension Setup

1. Open Google Chrome and go to `chrome://extensions/`.
2. Toggle on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` directory.
4. Click the Hush extension icon in the toolbar.
5. Enter your deployed Worker URL (e.g., `https://hush.<your-subdomain>.workers.dev`) and `API_TOKEN`.
6. Click **Save & grant permission** to allow origin access.
7. Open Gmail (`mail.google.com`) and compose a new email — tracking will be active by default with a toggle in the toolbar.

---

## Free-Tier Limits

Hush is engineered to run indefinitely within Cloudflare's free limits:
- **Cloudflare Workers**: 100,000 requests/day (Hush uses minimal sub-millisecond execution).
- **Cloudflare D1**: 5 million row reads/day, 100,000 row writes/day, 10 GB storage.
- **Protection**:
  - Maximum 200 hits recorded per tracked email.
  - Dashboard polling pauses automatically when the browser tab is hidden.
  - Batch queries optimize list views into a single database round-trip.

