# START HERE

From a fresh machine to the GapMap demo running and tests passing — cross-platform
(Windows included, **no bash required**) — plus a map of what's solid and what's open.

## TL;DR

```bash
npm install --ignore-scripts
npx playwright install chromium   # only needed to run tests
npm start                          # → http://localhost:8000
```

The demo runs **with no API key and no backend beyond the local server**
(`serve.mjs`, which also proxies the Library's paper downloads). Sign up or log
in, complete Setup (grade + subject), then walk the path:
**Diagnostic → Gap Map → Learning Path → Learn/Practice**, then retake the
Diagnostic from the Gap Map to re-measure.

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
separately. It verifies the demo flow end-to-end (Diagnostic and Concept
practice, with the session seeded through `tests/helpers/session.js`), that
guest routing works, that the Library renders and the download route rejects
unknown ids, **and** that the demo data conforms to the schemas.

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
    assessment/attempt/concept-graph must look like).
  - `core/scoring.js` — per-Concept rollup → the **Gap Map**, and Mastery
    classification (strong ≥80%, improve 50–79%, weak <50%).
  - `core/learning-path.js` — Gap Map + **Concept Graph** → the root-cause
    **Learning Path** ([ADR-0006](docs/adr/0006-concept-graph-learning-path.md)):
    roots first, severity as tie-break, with Mistake-Diagnosis evidence.
  - `core/validate.js` — the cross-field semantic checks the schemas can't
    express (the Concept-tag bridge, wrong-explanation sanity, graph
    endpoints/cycles, Mistake-Diagnosis kinds).
  - `core/demo-data/` — inspectable sample assessments + a completed attempt;
    not application state.
  - `data/subjects/` — the Subjects' **Concept Graphs**: subject-level
    application data shared by all Learners, served by
    `frontend/js/subject-store.js` (one YAML per Subject; a row behind the
    same seam when the database lands).
  - `core/README.md` — the format + the **integration points** (what's passed to
    the model, what it produces, how that's answered).
- **The artefact shape.** An assessment is LLM-generated and **frozen** for the
  attempt; an attempt is app-written and **append-only**; they join by `item_id`.
  Every Item carries exactly one Concept — that tag is load-bearing: the
  per-Concept rollup *is* the Gap Map. ([ADR-0001](docs/adr/0001-artifact-based-assessment.md))
  The Subject's **Concept Graph** is a third artefact (frozen per Subject,
  grade-spanning) and the Learning Path is a pure derivation from it plus the
  Gap Map — computed on read, never stored ([ADR-0006](docs/adr/0006-concept-graph-learning-path.md)).
- **`serve.mjs`** — the entry point: serves the repo root statically plus the one
  Library route (`GET /api/download?id=…`, a server-side whitelist). That route
  is the only server behaviour since the agent's Node service was retired
  ([ADR-0004](docs/adr/0004-firebase-ai-logic.md)).
- **`frontend/`** — the demo UI (root pages, `profile.html`,
  `frontend/js/auth-guard.js` for the session, Profile, avatar menu and the
  active Subject, agent panel, the ESM facade over `core/`).
- **`tests/`** — `demo.spec.js` (demo path), `auth-routing.spec.js` (session and
  guest routing), `library.spec.js` (Library + download route), `validate.spec.js`
  (ajv + semantic), plus the module specs. `tests/helpers/session.js` seeds the
  session the guard expects. `npm test` guards them all.

### Open — demo path gaps

- Re-measurement is **retaking the Diagnostic** (the Gap Map's Retake option);
  the separate **Retest** artefact kind has been removed from `core/schema/`,
  `core/validate.js`, and the generator/Companion tools.
- The demo's **Practice** composes from the Learner's pool
  (`frontend/js/assessment-composer.js`) with the in-page Concept bank as
  fallback — generated assessments are viewable and attemptable on
  `concept.html`, including for Concepts the bank doesn't teach.
- **Subject and Language** are switchable in the nav; the dashboard renders the
  root-cause Learning Path — banner, dependency chain, and a "View as data"
  toggle exposing the derived path object the Companion reads. **profile.html**
  (via the avatar menu) holds Account and all three preferences. Page content is
  English-only, and the Companion panel docks below the nav on desktop so the
  session stays in view while learning — the AI phase's acceptance criteria and
  their status live in
  [`docs/ai-phase-requirements.md`](docs/ai-phase-requirements.md).
- **Subject-level data lives in `data/subjects/`** — one Concept Graph per
  Subject, all 15 demo Subjects covered (validated by
  `tests/validate.spec.js`'s no-fallback invariant). The Mistake-Diagnosis
  evidence layer is fully ported for Grade 12 Mathematics (canonical,
  html, and practice artefacts); the other Subjects' html assessments still
  carry no `wrong_explanations` — authored data work, schema-optional, and
  the only remaining gap in the evidence readout. A model-backed
  graph generator exists (`frontend/js/concept-graph-generator.js`) but is
  not wired to any UI trigger yet — the app reads the authored YAML.
- **Library downloads** (`/api/download?id=…`) live in `serve.mjs`; moving to
  static hosting needs an equivalent for that one route.

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
- [`docs/ai-phase-requirements.md`](docs/ai-phase-requirements.md) — the AI
  phase's requirements as the team shared them, with build status.
- [`docs/adr/`](docs/adr/) — architectural decisions (0001 artefact format,
  0002 Gemini/credential [superseded], 0003 validation split, 0004 Firebase AI
  Logic).