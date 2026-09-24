# GapMap — capabilities & UX for the frontend team

What the product can do today, where the experience can improve, and everything
you need to build those improvements. UX changes are accepted against written
flows (`docs/flows/`) — a UX idea must name the flow and step it belongs to
("flow X, step N: expected A, got B"). Tagged at `v0.3.0-root-cause-path`.

Orientation in one line: **Diagnostic → Gap Map → root-cause Learning Path →
Learn/Practice → re-measure** — see `START-HERE.md` to run it,
`CONTEXT.md` for the words (this doc uses them; "student/quiz/level/feedback"
are banned), `core/README.md` for the artefact format.

---

## Part 1 — What the product can do today

Everything below is wired and tested (`npm test`, 129 specs). Nothing here is
mocked UI — the artefacts are real and inspectable.

### 1. Measurement — Diagnostic → Gap Map

- Grade + Subject pick the artefact (`core/demo-data/assessments/`, 15
  grade×subject files). Items are shuffled; per-Item verdicts are computed
  once (written answers matched against accepted variants), then rolled up by
  `core/scoring.js` — the **only** place a percentage or Mastery classification
  exists (strong ≥80, improve 50–79, weak <50).
- Two records result: the presentation store
  (`gapmap_diagnostic:<learner>:<subject>`) that pages render from, and an
  **Attempt** in the Learner store (append-only, joined to the frozen
  assessment by `item_id`).

### 2. The root-cause Learning Path (the differentiator)

- The **Concept Graph** (`data/subjects/graph-g<grade>-<subject>.yaml`, one
  per Subject, served to *all* Learners through `frontend/js/subject-store.js`)
  records prerequisite edges, spanning grades. ADR-0006.
- `core/learning-path.js` derives the **Learning Path** on read:
  `(gapMap, graph, mistakeKinds) → { path, rootCauses }` — roots first,
  severity as tie-break, every entry carrying `origin` (grade), `blocks`,
  `blockedBy`, and Mistake-Diagnosis `evidence`. Never stored per Learner.
- The dashboard renders it three ways: a **root-cause banner** (root Concept,
  origin chip, evidence sentence "N of your M wrong X responses were
  prerequisite failures pointing back here"), a **dependency chain** with arrow
  connectors ("unblocks Quadratic Equations"), and a **"View as data" toggle**
  exposing the exact derived object the Learning Companion reads, with
  provenance. `concept.html` answers "why this is on your path" with a chip.
- Every Subject has a graph; a malformed graph file falls back to severity
  order with a console warning (never breaks the page, never fabricates).

### 3. Learn & Practice

- `concept.html` teaches the Concept (explanation, tip, worked examples) and
  practises it **pool-first**: Items composed from the Learner's generated
  assessments (dedup by prompt, unseen-first from Attempt history, deterministic
  seeded shuffle), frozen as a Practice artefact; the in-page Concept bank is
  the fallback. Results come from `core/scoring.js`; completing writes the
  Attempt back, which drives the next composition.

### 4. Re-measurement

- The Learner re-measures by **retaking the Diagnostic** from the Gap Map;
  the fresh Gap Map shows whether Mastery moved. Attempt history is
  append-only; assessments are frozen.

### 5. The Learning Companion

- Live by default via Firebase AI Logic (browser-owned, key in a managed
  proxy); the key-free demo/test path opts out with `?agent=off`. Provider
  failures are surfaced, never masked with a fabricated reply.
- Discovery tools (ADR-0005): `getGapMap`, `getLearningPath`, `getConcept`,
  `getItem`, `getAttemptHistory`, `getPlatformHelp`, `generateAssessment`.
  The path tools return the **derived chain** (entries with origin/blocks/
  blockedBy/evidence + `rootCauses`) when the Subject store has a graph;
  `getConcept` adds `prerequisites`/`dependents`. The prompt snapshot stays
  bounded (path head + transcript tail); the system prompt forbids inventing
  Gap Map data or root causes.
- Context: the Learner's name, Language, and Explanation Level feed every
  prompt; Language and Explanation Level are switchable in the nav.

### 6. Generation seams (LLM boundary)

- `generateAssessment` (local deterministic + model adapter) and
  `generateConceptGraph` (same pattern) validate at the boundary — JSON Schema
  (`core/schema/`) for structure, `core/validate.js` for semantics (the
  Concept-tag bridge, Mistake-Diagnosis kinds, graph endpoints/cycles). The
  model proposes; the app validates, persists, and renders. The graph
  generator exists but is **not wired to any UI trigger yet**.
- Items' `wrong_explanations` carry a Mistake-Diagnosis `kind` (`misread`,
  `procedure`, `concept`, `prerequisite`) — prerequisite kinds name the
  blocking Concept; the kinds roll up into the root-cause readout.

### 7. Platform

- Firebase Authentication + EmailJS OTP account flow, lightweight `gapmap_user`
  session snapshot, guest routing, Learner-scoped local keys
  (`GapMapAuth.learnerScope()`), and Firestore persistence for Profiles,
  Assessments, Attempts, Diagnostic summaries, Practice history, and Companion
  transcript entries. The Profile page remains behind the avatar menu; the
  Library still serves past papers through the server's one route
  `GET /api/download?id=…` plus per-Concept videos.

---

## Part 2 — Where the UX can improve

Each improvement names its flow and step — that step is the acceptance
criterion. File diffs against it; don't restyle what a step doesn't cover.

### High-value (demo-visible)

1. **Close the re-measure loop on Results** — flow: clear-the-blocking-gap,
   steps 5–7. The Results screen offers only "Back to GapMap" and "Practise
   again"; the Learner must know on their own to retake the Diagnostic to
   re-measure. Expected: Results offers the next step the path implies —
   "Retake Diagnostic" (the re-measure) and/or "Next on your path:
   <Concept>" (the chain's next node). Effort: small (the chain and path are
   already derivable on `concept.html` — the why-chip machinery is there).
2. **Show movement, not just state** — flow candidate: "watch your mastery
   move" (register it in `docs/flows/README.md` first). The dashboard shows
   the current Gap Map; the retake's *delta* (Factorisation 33% → 76%) is the
   moment the README's demo script wants judges to remember. The Attempt
   history is append-only and Learner-keyed — everything needed for a delta
   strip ("since your last Diagnostic") already exists. Effort: medium.
3. **Chain ergonomics for long paths** — flow: see-why-you're-stuck, step 3
   (known gap). More than ~4 weak Concepts makes a long page; consider
   progressive disclosure (root + next open, rest collapsed behind "show all")
   or a compact vertical timeline. The 700px media query does not restyle the
   chain — verify mobile before shipping. Effort: small.
4. **Make the why-chip actionable** — flow: clear-the-blocking-gap, step 1.
   The chip says "it unblocks Quadratic Equations" but isn't linked; make the
   blocked Concept clickable so the Learner can *see* the dependency instead of
   reading it. Effort: small.

### Worth debating (design, not just build)

5. **Guided hand-holding, carefully** — the team's original "experience layer"
   idea. The flows pin staged revelation (banner → chain → data); the open
   question is whether the Companion should *proactively* walk the Learner
   through them ("I see a new root cause — want me to explain?"). Risk: hiding
   the Gap Map, which is the product's claim. A candidate flow must be drafted
   and registered before any UI work.
6. **Empty state with a path preview** — flow: see-why-you're-stuck, failure
   path step 1. Today: "No diagnostic results yet". A preview of what the path
   *will* look like (without fabricating Scores) could motivate the Diagnostic.
   Anchored to that failure row; needs a step before building.

### Not UX — data work that shows up as UX

- The evidence sentence on the banner exists only for Grade 12 Mathematics
  artefacts today; the other 14 html assessments carry no `wrong_explanations`.
  Authoring them (one subject per sitting, two entries per MC Item, classified)
  makes the root-cause readout evidence-backed everywhere. Schema-optional —
  the UI already degrades honestly.
- The g12 Physical Science assessment's `subject` label says "Physical
  Science" (singular) while the canonical Profile subject is "Physical
  Sciences"; cosmetic demo-data label — normalise when that file is next
  touched.

---

## Part 3 — Everything you need to get it done

### Module map (who imports what)

```
core/  (pure — no DOM, no Node)
  scoring.js            scoreFromFlags(items, flags) — THE rollup + thresholds
  learning-path.js      buildLearningPath({gapMap, graph, mistakeKinds})
                        mistakeKindsByConcept(assessments, attempts)
  validate.js           validateAssessment, validateConceptGraph

frontend/js/
  subject-store.js      createSubjectStore() → getConceptGraph({grade, subject})
                        serves data/subjects/*.yaml, cached per Subject
  learner-store.js      per-Learner store (assessments, attempts, transcript)
                        getCurrentLearnerId(), learnerScope()
  assessment-generator.js   local + model adapters (kinds included)
  assessment-composer.js    composePractice — pool-first, unseen-first
  agent-client.js       Companion client + tool executor (getConceptGraph
                        provider param — pass it to get the derived chain)
  auth-guard.js         session, Profile, switchers, learnerScope

data/subjects/          one Concept Graph per Subject (application state)
core/demo-data/         inspectable sample assessments + attempt (NOT app state)
```

### Shapes you'll render

- **Gap Map entry**: `{ concept, pct, status: 'strong'|'improve'|'weak', correct, total }`
  — the presentation store uses `score` for `pct`:
  `gapmap_diagnostic:<learner>:<subject>` → `{ overall, concepts: {<name>:
  {score, correct, total, status}}, takenAt, … }`.
- **Path entry** (`buildLearningPath`): `{ concept, pct, status, origin: '9'|null,
  blockedBy: string[], blocks: string[], evidence?: { wrong, byKind,
  prerequisiteFailures: {<concept>: n} } }` — plus `rootCauses: [entry]`
  (blocks-length-descending). Wording stays in your render layer; the module
  returns data, not sentences.
- **Companion tool payloads** (`getGapMap`/`getLearningPath`): same entries +
  `rootCauses`; `getConcept` adds `prerequisites` / `dependents`. Without a
  graph the flat name-array shape is kept — don't break that contract
  (`tests/agent-client.spec.js` pins both).
- **Concept Graph**: `{ id, type: 'concept-graph', subject, nodes: [{concept,
  grade?, description?}], edges: [{requires, for}] }` — validate with
  `validateConceptGraph`; never render from unvalidated data.

### The rules (break these and the demo loses its point)

1. **Scoring is `core/scoring.js` or it's wrong.** Hand a verdict array to
   `scoreFromFlags`; never compute a percentage, a threshold, or a status
   anywhere else. (The 75/40 handroll existed and was removed — keep it gone.)
2. **No fabricated data.** If the graph is missing → severity order, honestly
   labelled; if it's malformed → console warning + fallback (pages) or tool
   failure (Companion). Never invent a root cause, a prerequisite, or a Score.
3. **Concept tag is load-bearing.** Every Item carries exactly one Concept;
   rollups join by exact name (case included — "Quadratic Equations" ≠
   "Quadratic equations"; a casing bug in the demo data was fixed for this).
4. **Assessments frozen; attempts append-only.** Never mutate either.
5. **Subject-level data is never per-Learner.** Graphs (and future subject
   content) live in `data/subjects/` behind `subject-store.js`; Learner state
   stays in `learner-store.js`. These two never mix.
6. **The format moves together.** A schema change means `core/schema/` +
   `core/validate.js` + demo data + generator + Companion payloads + tests in
   one change. ADR-0001 and ADR-0006 are binding.
7. **Glossary terms only** (`CONTEXT.md`): Learner, Concept, Diagnostic,
   Practice, Item, Response, Score, Mastery, Knowledge Gap, Gap Map, Learning
   Path, Mistake Diagnosis, Language, Explanation Level, Learning Companion,
   Prerequisite, Concept Graph, Foundational Gap. Banned: student, user
   (in prose), quiz, test, topic, weakness, level alone, feedback (for the
   Mistake Diagnosis).

### Gotchas

- **`js-yaml` vendor script** (`frontend/vendor/js-yaml.min.js`) must be on
  any page that uses `subject-store.js` (it parses YAML from the global).
  Diagnostic, dashboard, and concept pages have it; new pages need it.
- `dashboard.html` and `concept.html` are ES-module pages; `GapMapAuth`
  (classic, from the head) is available but module scripts run after DOM
  parse — don't assume ordering with the agent panel.
- The **two data sources** are by design: pages render the Gap Map from the
  presentation store; the Companion reads the Learner store's attempts rollup.
  If you make them disagree in the UI, you'll see it as a demo bug — keep
  verdicts computed once (`results.flags`) and shared.
- Live-model paths: tests never require a live project or key — build UX with
  `?agent=off` (sticky per session) and keep it that way.
- No postinstall scripts, ever (supply-chain posture; `npm install
  --ignore-scripts`).
- `next_concept` in `core/schema/attempt.schema.json` is an orphan field —
  harmless, optional, not read. Don't build on it; prefer the derivation.

### How to work

1. Run: `npm start` → `http://localhost:8000`; tests: `npm test` (boots its
   own server on :8312, network-free — `?agent=off` is already applied by the
   specs). Session seeding lives in `tests/helpers/session.js`.
2. Pin the UX before building: the flow file + step is the acceptance
   criterion; update the step only when the expectation itself changes. New
   user goal → new flow file + README index row.
3. The specs that guard what you'll touch: `tests/root-cause.spec.js`
   (banner, chain, data view, why-chip), `tests/demo.spec.js` (Diagnostic +
   Practice end-to-end), `tests/learning-path.spec.js` (derivation),
   `tests/subject-store.spec.js` (seam), `tests/validate.spec.js` (the
   no-fallback invariant: every Subject graphed, every diagnosis typed).
4. Read next, in order: `docs/flows/` (the two flows), `docs/adr/0006-…`
   (the path + graph decisions), `core/README.md` (the format +
   integration points), `docs/companion.md` (tools), `CONTEXT.md` (words).

*Written 2026-09-21 against `v0.3.0-root-cause-path` (commit `3cd0de8`,
129 tests green).*