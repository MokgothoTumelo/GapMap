# Validation: ajv for structure, shared JS for semantics

The artefact format is validated in two layers: the JSON Schemas (`core/schema/`)
are the structural contract, enforced by ajv; `core/validate.js` is the thin,
shared, runtime-agnostic layer for the cross-field semantic checks the schemas
cannot express.

## Context

`core/validate.js` originally hand-mirrored the JSON Schemas — two definitions
of the same format that could drift. Unifying them with "ajv for structure" hit
two facts: (1) the schemas don't express cross-field semantic checks
(`item.concept ∈ concepts[].name` — the Concept-tag bridge — plus
wrong-explanation sanity and the retest target match), and one of those is
load-bearing; (2) ajv is a bare npm specifier, so it can't run in the browser
under the project's no-build, native-ESM setup without vendoring + import maps.

## Decision

- **Structure → ajv + the schemas.** ajv (draft 2020-12) validates structure
  against `core/schema/`. It runs where the LLM boundary lives: in
  `tests/validate.spec.js` now, and in the agent service when assessment
  generation is wired. The schemas are the single structural source of truth.
- **Semantics → `core/validate.js`, shared.** The four cross-field checks the
  schemas can't express stay in pure, dependency-free JS, imported by both the
  browser and the agent service.
- **Browser is semantic-only on load.** It loads trusted demo data (or, later,
  server-validated artefacts), so it does not run ajv. Structure is ajv's job,
  not duplicated in the browser.

## Considered options

- **ajv in the browser too (vendor + import map).** Rejected: ajv belongs at
  the LLM boundary (server-side, per AGENTS.md), not in the browser; vendoring
  it + import maps is machinery for a check the browser doesn't need.
- **Extend the schemas to express the cross-field checks (`data` refs /
  `contains`).** Rejected for now: complex authoring, uneven validator support.
  Revisit if the schema should fully gate LLM output at the boundary.
- **Hand-validators + a consistency test.** Rejected: keeps the duplication the
  unification was meant to remove.

## Consequences

- One source of truth for structure (schemas, via ajv) and one for semantics
  (`core/validate.js`); no hand-mirrored drift.
- The browser no longer structurally validates on load — covered by the ajv
  test (demo data) and the server boundary (LLM data).
- Making the schemas a usable contract required fixing their `$id`s (aligned
  to the filenames the `$ref`s use) and the `correct` /
  `wrong_explanations.answer` `oneOf` (an integer is a number, so `oneOf` matched
  two schemas — changed to a type array).
- `npm test` runs both the Playwright browser baseline and the ajv/semantic
  suite.