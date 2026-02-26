# LWSync

**Cross-browser bidirectional sync between Linkwarden and browser bookmarks.**

LWSync is a browser extension that keeps your Linkwarden collections in sync with your browser bookmarks. Changes flow both ways—edit in Linkwarden or your browser, and LWSync keeps everything up to date.

---

## Features

- ✅ **Bidirectional sync** - Changes in Linkwarden or browser bookmarks sync automatically
- ✅ **Subcollection support** - Nested collections sync as folder hierarchies
- ✅ **Conflict resolution** - Last-write-wins with checksum validation
- ✅ **Background sync** - Automatic sync at configurable intervals (default: 5 minutes)
- ✅ **Privacy-first** - No data collection, no telemetry, no external services
- ✅ **Cross-browser** - Supports Chrome, Firefox, and Edge

---

## Privacy & Data Collection Policy

**LWSync does not collect, store, or transmit any user data.**

### What LWSync Does NOT Do

- ❌ No telemetry or analytics
- ❌ No user tracking or fingerprinting
- ❌ No data sent to third-party services
- ❌ No advertising or monetization
- ❌ No remote servers (except your own Linkwarden instance)

### How Data Is Handled

All sync data is stored **locally** in your browser using `chrome.storage.local` with the `unlimitedStorage` permission:

| Data Type       | Storage Location | Purpose                                        |
| --------------- | ---------------- | ---------------------------------------------- |
| Sync metadata   | Browser storage  | Track last sync time, sync direction           |
| Mappings        | Browser storage  | Link Linkwarden IDs to browser bookmark IDs    |
| Pending changes | Browser storage  | Queue changes for next sync                    |
| Settings        | Browser storage  | Your Linkwarden URL, access token, preferences |
| Sync log        | Browser storage  | Recent sync activity (last 100 entries)        |

---

## Requirements

### Build Environment

| Requirement            | Version           | Purpose                                |
| ---------------------- | ----------------- | -------------------------------------- |
| [Bun](https://bun.sh/) | 1.3.9             | Runtime, bundler, test runner          |
| Node.js                | 25.7.0 (optional) | Alternative runtime (Bun is preferred) |

### Browser Requirements

| Browser | Minimum Version | Manifest                    |
| ------- | --------------- | --------------------------- |
| Chrome  | 88+             | Manifest V3                 |
| Firefox | 109+            | Manifest V2 (WebExtensions) |

### Linkwarden Requirements

| Requirement | Version                                           |
| ----------- | ------------------------------------------------- |
| Linkwarden  | Self-hosted instance                              |
| API Access  | Access token (create in Settings → Access Tokens) |

---

## Installation

### From Extension Stores (Recommended)

**Chrome Web Store** - Coming soon
**Firefox Add-ons (AMO)** - Coming soon
**Edge Add-ons** - Coming soon

### Manual Installation (Development)

1. **Clone the repository:**

   ```bash
   git clone https://github.com/WombatFromHell/lwsync.git
   cd lwsync
   ```

2. **Install dependencies:**

   ```bash
   bun install
   ```

3. **Build the extension:**

   ```bash
   bun run build
   ```

4. **Load in your browser:**

   **Chrome/Edge:**
   - Go to `chrome://extensions/` or `edge://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist/chrome/` folder

   **Firefox:**
   - Go to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select `dist/firefox/manifest.json`

---

## Development

### Build Commands

```bash
# Install dependencies
bun install

# Development build (watch mode, Chrome only)
bun run dev

# Production build (all browsers)
bun run build

# Production build in container (reproducible)
bun run build:prod

# Run all tests
bun test

# Run specific test file
bun test tests/sync.test.ts

# Lint and format code
bun run lint
bun run format

# Run all quality checks
bun run quality

# Package for distribution
bun run zip

# Build + package in one command
bun run package

# Verify build artifacts
bun run verify
```

### Testing

**Run all tests:**

```bash
bun test
```

**Test philosophy:** Never mock the system-under-test. Only mock browser APIs that don't exist in the test environment.

---

## Packaging for Distribution

### Chrome Web Store

1. **Build the extension:**

   ```bash
   bun run build
   ```

2. **Package for Chrome:**

   ```bash
   bun run zip
   ```

   This creates `dist/LWSync-chrome.zip` with SHA256 checksum.

3. **Verify the archive:**

   ```bash
   bun run verify
   ```

4. **Upload to Chrome Web Store:**
   - Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - Click "New Item"
   - Upload `dist/LWSync-chrome.zip`
   - Fill in store listing details (description, screenshots, etc.)
   - Submit for review

**Chrome Store Requirements:**

- Single ZIP file (`LWSync-chrome.zip`)
- Manifest V3 compatible
- Icons: 16x16, 48x48, 128x128 (included in `assets/`)
- Privacy policy URL (link to this README's privacy section)

---

### Firefox Add-ons (AMO)

1. **Build the extension:**

   ```bash
   bun run build
   ```

2. **Package for Firefox:**

   ```bash
   bun run zip
   ```

   This creates `dist/LWSync-firefox.zip` with SHA256 checksum.

3. **Verify the archive:**

   ```bash
   bun run verify
   ```

4. **Upload to AMO:**
   - Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/en-US/developers/)
   - Click "Submit a New Add-on"
   - Upload `dist/LWSync-firefox.zip`
   - Fill in listing details
   - Submit for review

**AMO Requirements:**

- Single ZIP file (`LWSync-firefox.zip`)
- Manifest V2 compatible (WebExtensions)
- Detailed description of functionality
- Privacy policy (link to this README's privacy section)
- Screenshots of the extension UI

---

### Edge Add-ons

1. **Build and package** (same as Chrome):

   ```bash
   bun run zip
   ```

2. **Upload to Edge Add-ons:**
   - Go to [Microsoft Edge Addons](https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview)
   - Create new product
   - Upload `dist/LWSync-chrome.zip`
   - Complete submission process

**Note:** Edge uses the same manifest format as Chrome (Manifest V3).

---

### Verifying Build Determinism

LWSync produces **reproducible builds**. You can verify this:

```bash
# Build twice and compare
bun run build:prod
bun run verify --compare dist/chrome dist/chrome-backup

# Or verify checksums
cd dist
sha256sum -c LWSync-chrome.zip.sha256sum
sha256sum -c LWSync-firefox.zip.sha256sum
```

---

## Configuration

### Extension Settings

| Setting               | Description                                          | Default     |
| --------------------- | ---------------------------------------------------- | ----------- |
| **Linkwarden URL**    | Your Linkwarden instance URL                         | Required    |
| **Access Token**      | API token from Linkwarden settings                   | Required    |
| **Sync Interval**     | How often to sync (minutes)                          | 5           |
| **Target Collection** | Collection name to sync (use `/` for nested)         | "Bookmarks" |
| **Browser Folder**    | Browser bookmark folder to sync (use `/` for nested) | Root        |

### First-Time Setup

1. Click the LWSync extension icon in your browser toolbar
2. Enter your Linkwarden instance URL
3. Create an access token in Linkwarden (Settings → Access Tokens)
4. Paste the token into the extension
5. Click "Test Connection" to verify
6. Click "Save Settings"
7. Click "Sync Now" to perform initial sync

---

## Troubleshooting

### Common Issues

**"Sync not configured" error:**

- Complete the first-time setup in the popup UI
- Ensure URL starts with `http://` or `https://`

**"Connection failed" error:**

- Verify your Linkwarden URL is correct (include `https://`)
- Check that your access token is valid
- Ensure your Linkwarden instance is accessible from your browser

**Bookmarks not syncing:**

- Check the sync log in the popup UI for errors
- Verify the target collection name matches exactly (case-sensitive)
- Try clicking "Reset" and reconfiguring

**Duplicate bookmarks created:**

- This can happen if mappings are lost
- Use "Reset" to clear sync state, then re-sync
- LWSync uses path-based matching to recover from lost mappings

### Getting Help

- **Documentation:** See `DESIGN.md` for architecture details
- **Test Suite:** See `tests/TEST_DESIGN.md` for test coverage
- **Issues:** Report bugs on GitHub (link coming soon)

---

## License

MIT License - See [LICENSE](LICENSE) file for details.

---

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

### Quick Start for Contributors

```bash
# Fork and clone
git clone https://github.com/WombatFromHell/lwsync.git
cd lwsync

# Install dependencies
bun install

# Create a branch
git checkout -b feature/your-feature

# Make changes, run tests
bun test
bun run quality

# Commit and push
git commit -m "Add your feature"
git push origin feature/your-feature
```

---

## Changelog

### Version 1.0.0 (In Development)

- Initial release
- Bidirectional sync between Linkwarden and browser bookmarks
- Subcollection support with nested folder hierarchies
- Conflict resolution with last-write-wins strategy
- Background sync at configurable intervals
- Privacy-first design with no data collection

---

## Acknowledgments

- [Linkwarden](https://linkwarden.app/) - Self-hosted bookmark manager
- [Bun](https://bun.sh/) - Fast JavaScript runtime and bundler
- [Preact](https://preactjs.com/) - Lightweight UI framework
