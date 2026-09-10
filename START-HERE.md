# START HERE

From a fresh machine to the GapMap demo running and tests passing — cross-platform
(Windows included, **no bash required**) — plus a map of what's solid and what's open.

## TL;DR

```bash
npm install --ignore-scripts
npx playwright install chromium   # only needed to run tests
npm start                          # → http://localhost:8000
```

The demo runs **with no API key and no backend beyond a static server**. Open
`diagnostic.html` (or click *Start Diagnostic* on `index.html`) and walk
the path: **Diagnostic → Gap Map → Learning Path → Practice → Retest**.

## 1. Prerequisites

- **Node.js 22 or newer** (LTS recommended; the project is developed on Node 24).
  Get it from <https://nodejs.org> or a version manager (`nvm` / `fnm` / `volta`).
- No other runtime is needed. The only bash in the repo is `serve.sh`, a convenience
  wrapper — on Windows, use `npm start` instead (the app itself is plain Node.js).

## 2. Install dependencies

```bash
npm install --ignore-scripts
```

`--ignore-scripts` keeps the project's no-postinstall security posture (install
scripts are disabled). Nothing here needs a postinstall; all dependencies are
well-established.

> **Reproducibility note:** keep `package-lock.json` committed so each machine
> resolves the same dependency tree.

## 3. (Optional) tests

```bash
npx playwright install chromium   # one-time browser download
npm test                          # Playwright + ajv; auto-starts the server
```

`npm test` boots the server itself (on port 8312), so you don't run `npm start`
separately. It verifies the demo flow end-to-end **and** that the demo data
conforms to the schemas.

## 4. The Learning Companion

The Companion's Node service was retired with the move to **Firebase AI Logic**
([ADR-0004](docs/adr/0004-firebase-ai-logic.md)): orchestration moves to the
browser via the Firebase AI Logic Web SDK, with a managed proxy holding the key.
The agent panel (`frontend/agentPanel/`) now uses a request-scoped browser
client with no `/api/agent/*` dependency. The Learning Companion is live by
default via Firebase AI Logic; the key-free demo and test path opts out per
session with `?agent=off`. If the provider fails, the panel shows the actual
error rather than fabricating a reply. The demo path does not require live AI.
See [`docs/companion.md`](docs/companion.md) and
[`docs/agent-firebase-setup.md`](docs/agent-firebase-setup.md).

## 5. Run

```bash
npm start          # http://localhost:8000  (cross-platform)
```

Port 8000 taken? Override with `PORT`:
- **bash / Git Bash:** `PORT=3000 npm start`
- **PowerShell:** `$env:PORT=3000; npm start`
- **cmd:** `set PORT=3000 && npm start`

(`serve.sh` is the same thing as a bash wrapper — use Git Bash/WSL on Windows, or
just `npm start`.)

---

## Map: what's solid vs. what's open

### Solid — the foundation (tested; won't shift under you)

- **`core/` — the artefact format.** The heart of the product; pure and
  runtime-agnostic (no DOM, no Node, no dependencies):
  - `core/schema/` — JSON Schemas, the contract at the LLM boundary (what an
    assessment/attempt must look like).
  - `core/scoring.js` — per-Concept rollup → the **Gap Map**, and Mastery
    classification (strong ≥80%, improve 50–79%, weak <50%).
  - `core/validate.js` — the cross-field semantic checks the schemas can't
    express (the Concept-tag bridge, wrong-explanation sanity, the retest target).
  - `core/demo-data/` — inspectable sample assessments + a completed attempt;
    not application state.
  - `core/README.md` — the format + the **integration points** (what's passed to
    the model, what it produces, how that's answered).
- **The artefact shape.** An assessment is LLM-generated and **frozen** for the
  attempt; an attempt is app-written and **append-only**; they join by `item_id`.
  Every Item carries exactly one Concept — that tag is load-bearing: the
  per-Concept rollup *is* the Gap Map. ([ADR-0001](docs/adr/0001-artifact-based-assessment.md))
- **`serve.mjs`** — the minimal static server (entry point; serves the repo
  root). Static hosting is the whole job since the agent's Node service was
  retired ([ADR-0004](docs/adr/0004-firebase-ai-logic.md)).
- **`frontend/`** — the demo UI (root pages, agent panel, the ESM facade over `core/`).
- **`tests/`** — `demo.spec.js` (Playwright browser baseline) + `validate.spec.js`
  (ajv + semantic). `npm test` guards both.

### Open — the Learning Companion (decided; rewire pending)

- **The Companion's architecture is decided** — Firebase AI Logic, browser-owned
  orchestration with a managed proxy holding the key
  ([ADR-0004](docs/adr/0004-firebase-ai-logic.md)). The Node prototype is purged;
  the panel's live model pool and explicit error path are implemented. The
  static demo does not invoke live AI; `npm run smoke:agent` exercises the live
  endpoint without App Check in the current shared-development setup
  ([`docs/companion.md`](docs/companion.md)).
- **Planned, not present:** the React/PostgreSQL/Python stack in
  [`README.md`](README.md). Don't pretend it exists; don't write anything that
  blocks it (moving to Postgres is meant to be a serialization change, not a model
  change).

---

## Read next

- [`AGENTS.md`](AGENTS.md) — project instructions and conventions (read before writing code).
- [`CONTEXT.md`](CONTEXT.md) — the domain glossary; the authority on what things are called.
- [`core/README.md`](core/README.md) — the artefact format and the integration points.
- [`docs/companion.md`](docs/companion.md) — the Learning Companion: decided
  architecture and rewire checklist.
- [`docs/adr/`](docs/adr/) — architectural decisions (0001 artefact format,
  0002 Gemini/credential [superseded], 0003 validation split, 0004 Firebase AI
  Logic).