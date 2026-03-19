# sieve

A virtual browser for AI agents. No rendering. No Chromium. Just the parts that matter.

## Quick reference

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Tests**: `bun test`
- **Typecheck**: `bun run typecheck`
- **Benchmarks**: `bun benchmarks/core.ts`

## Architecture

```
src/
├── dom/          # Virtual DOM: nodes, parser (htmlparser2), serializer, HTMLRewriter preprocessing
├── css/          # CSS selector matching, computed styles (visibility/display)
├── a11y/         # Accessibility tree builder and LLM-optimized serializer
├── forms/        # Form state machine, validation, serialization
├── actions/      # Click, type, select simulation
├── navigation/   # URL routing, cookie jar, storage
├── snapshot/     # State capture, diff, restore, Bun.hash change detection
├── network/      # Pluggable fetchers: live HTTP, mock, disk replay (Bun.file/Bun.write)
├── persistence/  # SQLite persistence (bun:sqlite) for cookies, storage, snapshots
├── page.ts       # SievePage — main page abstraction
├── browser.ts    # SieveBrowser — multi-page manager
└── index.ts      # Public API surface
```

## Bun-specific features used

- **bun:sqlite**: Persistent cookie jar, localStorage/sessionStorage, snapshot storage (WAL mode, in-memory or file-backed)
- **Bun.hash**: Wyhash for fast snapshot change detection, CRC32 for content-addressable IDs, SHA-256 for digests
- **HTMLRewriter**: Native streaming HTML preprocessing — strips scripts/styles/SVGs for agents, sanitizes XSS, extracts metadata
- **Bun.file / Bun.write**: Disk-backed replay fetcher records HTTP responses to filesystem
- **Bun.Glob**: Scanning replay recording directories
- **Snapshot testing**: `toMatchSnapshot()` for a11y tree regression tests

## Key design decisions

- Pages are data structures (serializable TypeScript objects), not browser processes
- Accessibility tree is the primary agent interface
- Form state is tracked in WeakMaps separate from DOM attributes (value attr = default, WeakMap = current)
- CSS engine is minimal: visibility/display only, no layout
- htmlparser2 handles tokenization; our DOM is a thin layer on top
- All interactions are synchronous except network operations and HTMLRewriter preprocessing
- Two parse paths: `parseHTML()` (sync, no preprocessing) and `parseHTMLAsync()` (with HTMLRewriter)
