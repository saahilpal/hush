# Hush for Gmail

Chrome Manifest V3 extension for automatically inserting Hush tracking pixels into outgoing Gmail emails.

## Features
- Zero delay/blocking: if the Worker is slow or unreachable (>1.5s), emails send normally without pixel.
- Per-email toggle in compose window to enable/disable tracking on the fly.
- Requests origin permissions at runtime for maximum security.
- Invisible 1x1 transparent GIF with zero branding or watermarks.

## Installation Instructions

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** toggle in the top-right corner.
3. Click the **Load unpacked** button in the top-left corner.
4. Select the `extension/` directory inside this repository (`/Users/nitrousoxide/Code/hush/extension`).
5. Click on the extension icon in Chrome or go to Extension Details -> Extension options.
6. Enter your deployed Hush Worker URL (e.g. `https://hush.<your-subdomain>.workers.dev`) and your `API_TOKEN`.
7. Click **Save & grant permission** and approve the browser prompt allowing access to your Worker origin.
8. Open Gmail (`mail.google.com`), open Compose, and send an email! The pixel will be attached seamlessly.

