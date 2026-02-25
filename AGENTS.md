# AGENTS.md - Project Guidelines

## Tools & Dependencies

| Tool | Purpose |
|------|---------|
| **Bun** | Runtime, bundler, test runner, package manager |
| **TypeScript** | Type-safe JavaScript |

## Commands

```bash
bun install      # Install dependencies
bun run build    # Build extension to dist/chrome/ and dist/firefox/ (fast, local)
bun run build:prod  # Production build in container (reproducible)
bun run dev      # Watch mode (rebuild on changes, Chrome only)
bun test         # Run all tests
bun test tests/sync.test.ts        # Run unit tests only
bun test tests/sync.integration.test.ts  # Run integration tests only
bun test tests/api.e2e.test.ts     # Run E2E tests only
bun run zip      # Package for distribution
bun run package  # Build + zip in one command
bun run verify   # Verify archive checksums
bun run verify --compare <dir1> <dir2>  # Compare two build dirs for determinism
```

## Project Structure

```
src/       # Source code
assets/    # Manifest files, HTML, icons
scripts/   # Build helper scripts (TypeScript)
dist/      # Build output
  chrome/    # Manifest V3 build for Chrome/Edge
  firefox/   # Manifest V2 build for Firefox
```

## Development Workflow

1. **Code** → Make changes in `src/`
2. **Build** → `bun run build` (or `bun run dev` for watch)
3. **Test** → `bun test`
4. **Load** → Load `dist/` as unpacked extension in browser
5. **Package** → `bun run zip` for distribution

## Testing

- Unit tests: `tests/sync.test.ts` (pure functions, no mocks)
- API E2E tests: `tests/api.e2e.test.ts` (real Linkwarden API)
- Use `bun:test` imports
- Run all tests: `bun test`

**Rule:** Never mock the system-under-test. Only mock browser APIs that don't exist in test environment.

## Loading the Extension

**Chrome/Edge:**
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `dist/chrome/` folder

**Firefox:**
1. Go to `about:debugging`
2. Click "Load Temporary Add-on"
3. Select `dist/firefox/manifest.json`
