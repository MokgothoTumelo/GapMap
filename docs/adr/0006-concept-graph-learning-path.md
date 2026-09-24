# 0006 — Subject-level Concept Graph; the Learning Path derived from it

Date: 2026-09-21 · Status: accepted

## Context

The glossary has always promised a Learning Path "prioritised by Knowledge Gap
severity **and prerequisites**", but the derivation in `frontend/js/learner-store.js`
was a severity sort only — no prerequisites, no *why this order* — while the
dashboard labelled its entries "Highest priority / Next / Then improve". The demo
attempt data carried the reasoning as a YAML comment ("Factorisation is chosen
first because it is a prerequisite for solving quadratics by factoring"), and the
attempt schema carried an orphan `next_concept` field nothing read. The format
had placeholders for a recommendation with no mechanism behind it.

Two tiers of capability were identified (2026-09-21 session):

- **Tier A** — in-grade chaining: Factorisation (weak) blocks Quadratic
  Equations (weak), so the path starts at Factorisation and the Gap Map can say
  *why*.
- **Tier B** — cross-grade Foundational Gaps: a Learner who did Mathematical
  Literacy needs Algebra built from below-grade Concepts. This cannot live in a
  Diagnostic's `concepts[]` (grade-scoped; `core/README.md` requires every
  Item's Concept to match that assessment's `concepts[]`), so it needs a
  Subject-level artefact.

## Decision

1. **Prerequisite edges live in a Subject-level Concept Graph artefact** — not
   inside assessments. One frozen artefact per Subject (JSON Schema at the LLM
   boundary, YAML on disk), spanning grades where relevant via each node's
   optional origin `grade`. Two homes for the same edges would drift; a
   Diagnostic's `concepts[]` cannot represent cross-grade Concepts at all.
2. **The Learning Path is a pure derivation in `core/`** (`learning-path.js`):
   graph + Gap Map → topologically ordered Concepts, roots first, severity as
   tie-break, each entry carrying `blocks` / `blockedBy` / origin grade. It is
   computed on read, not stored as a per-Learner artefact — matching how the
   Gap Map itself is derived from attempts. The Concept Graph is Subject-level
   knowledge, so it is injected by consumers that know the Subject (the pages,
   the Companion's tool executor) rather than stored per Learner.
3. **Mistake Diagnoses gain a kind** — `misread | procedure | concept |
   prerequisite` — as an optional field on `wrong_explanations` entries, with a
   `prerequisite` kind naming the blocking Concept. The kinds roll up into the
   Gap Map's root-cause readout, so "3 of your 4 wrong Responses there were
   prerequisite failures" is evidence-backed from the artefacts, not asserted.
4. **The root-cause readout is rendered, never fabricated.** The model may
   propose graph edges at the boundary, but they are schema-validated and the
   Learner inspects the same artefact the UI renders — ADR-0001's artefact
   discipline and ADR-0005's no-fabrication rule, applied to the Learning Path.
   The demo Subject's graph is authored inspectable YAML
   (`data/subjects/`, application data the subject store serves — moved out of `core/demo-data/`, which holds sample data, not application state); generation follows the assessment pattern
   (deterministic local adapter + model adapter).
5. **The fallback exists only for the unreadable, not the unported.** Every
   Subject a Learner can assess carries a Concept Graph and every
   Mistake Diagnosis in the demo artefacts carries a kind (2026-09-21
   porting decision) — there is no severity-only path in normal operation.
   If a graph file is missing or malformed, the pages fall back to the
   severity order and a console warning rather than breaking; the Companion
   surfaces the failure. The UI says what the data supports and nothing
   more, and `tests/validate.spec.js` enforces the no-fallback invariant
   ("every demo Subject has a schema-valid Concept Graph").

## Rationale

The glossary already promised prerequisites; this pays that debt. Cross-grade
Foundational Gaps ("Mathematical Literacy → needs Algebra") are the
differentiator no black-box competitor can copy cheaply, and they require a
Subject-level graph by construction. The Learning Path becomes a dependency
chain the Learner can see — root → blocked → current — instead of a sorted list
with unearned priority labels.

## Consequences

- The format moves together: `core/schema/` gains the graph schema and optional
  Item fields (`kind`, `prerequisite`); `core/validate.js` gains graph checks
  (edge endpoints exist, no cycles, no self-edges) and kind checks; demo data
  gains the graph and kinds; the generator's schema/prompt grow; the
  Companion's `getGapMap` / `getLearningPath` / `getConcept` payloads grow.
- Learning Path ordering changes — severity-only expectations in tests and
  copy are updated; without a graph the severity order remains the fallback.
- Path *wording* stays in the render layer; `core/learning-path.js` returns
  data, not sentences.
- The graph's authority is Subject-level from day one, so a later
  Curriculum-wide graph is a data expansion, not a model change.
- A Learner's path can now start below their grade (a below-grade-origin
  Concept that is measured and weak); that is the Foundational Gap story, and
  it is a feature, not a bug.

## See also

- [0001-artifact-based-assessment.md](0001-artifact-based-assessment.md) — the
  two-file artefact discipline this extends to the path.
- [0005-companion-tool-calling.md](0005-companion-tool-calling.md) — the
  discovery-tool pattern the enriched payloads follow.
- [`CONTEXT.md`](../../CONTEXT.md) — Prerequisite, Concept Graph, Foundational
  Gap; the amended Mistake Diagnosis entry.
- [`core/README.md`](../../core/README.md) — the format this extends.