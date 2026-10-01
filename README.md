# LWSync

Bidirectional sync between your Linkwarden collections and browser bookmarks. Manifest V3 for Chrome, Edge, and Firefox 128+.

Edit in Linkwarden or your browser — LWSync keeps both sides in sync, including nested collections and bookmark order.

See [DESIGN.md](DESIGN.md) for architecture details.

## Features

- Bidirectional sync (browser events + 5-minute polling)
- Nested collections sync as folder hierarchies
- Bookmark order preserved via server-side order tokens
- Conflict resolution: last-write-wins with checksum validation
- No data collection, no telemetry — everything stays in `chrome.storage.local`

## Requirements

- Bun 1.3.9
- A self-hosted Linkwarden instance with an access token (Settings → Access Tokens)

## Build & Run

```bash
bun install
bun run build    # outputs dist/chrome/ and dist/firefox/
```

Load as an unpacked extension:

- **Chrome/Edge:** `chrome://extensions/` → Developer mode → Load unpacked → `dist/chrome/`
- **Firefox:** `about:debugging` → Load Temporary Add-on → `dist/firefox/manifest.json`

## Setup

1. Click the LWSync toolbar icon
2. Enter your Linkwarden URL and access token
3. Test connection, save settings, sync now

## Development

```bash
bun run dev       # watch mode (Chrome)
bun test          # all tests (87)
bun run quality   # lint + format
bun run zip       # package for distribution
```

## License

MIT
