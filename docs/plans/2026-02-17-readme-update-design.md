# README Update Design — 2026-02-17

## Scope

Two files:

1. **`README.md`** — Lean refresh. Same structure and tone as today, updated for accuracy.
2. **`docs/OVERVIEW.md`** — New comprehensive reference doc covering everything README doesn't.

---

## README.md Changes

### What changes

| Section | Change |
|---|---|
| Header | Add tech stack line: Tauri 2 · React 19 · TypeScript 5.9 |
| Features | Add optional password, update auto-lock range (10min default, up to 60min), add PBKDF2/rate-limit bullet |
| Security | AES-256-GCM, PBKDF2 600k iterations (OWASP 2024), 5-attempt rate limit + exponential backoff, optional password / passwordless mode supported |
| Tech Stack | Add version numbers, add Rust/Axum backend entry |
| Development | Fix commands to match package.json (`npm run tauri:dev`, `npm run tauri:build`), add `npm test` (1606 tests) |

### What stays the same

- All existing sections (Derivation Paths, BRC-42/43, Time Locks, License)
- Length and tone — short, scannable, developer-friendly
- No screenshots or badges (out of scope)

---

## docs/OVERVIEW.md Structure

Comprehensive reference. Sections:

1. **What is Simply Sats** — purpose, who it's for, what makes it different
2. **Features in depth** — each feature with a 2-3 sentence explanation (not just bullet points)
3. **Architecture** — layer diagram summary, link to `docs/architecture.md`
4. **Security model** — full detail: AES-256-GCM, PBKDF2 600k iterations, rate limiting, CSRF nonces, DNS rebinding protection, optional password, auto-lock, audit log
5. **Derivation paths** — same table as README plus explanation of BRC-42/43
6. **BRC-100 / SDK** — what BRC-100 is, the HTTP server on port 3322, the `@simply-sats/sdk` package
7. **Development setup** — all commands from CLAUDE.md quick commands section
8. **Project structure** — abbreviated tree of `src/` with layer descriptions
9. **Tech stack** — full list with versions and rationale links to `docs/decisions.md`
10. **Contributing** — how to run tests, lint, typecheck before PRs
11. **License** — MIT

---

## Implementation Plan

1. Update `README.md` in place (Edit operations)
2. Create `docs/OVERVIEW.md` (Write operation)
3. Run `npm run lint && npm run typecheck` (no code changes, but good hygiene)
4. Commit both files: `docs: update README and add comprehensive OVERVIEW`
5. Push to GitHub
