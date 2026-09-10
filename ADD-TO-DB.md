# ADD-TO-DB

Candidate additions to the database shape, surfaced by the implemented
Companion tools. The authority on the current shape is
[`docs/learner-store.md`](docs/learner-store.md) — the store holds only
per-Learner artefacts (Assessments, Attempts) and the transcript; the Gap Map
and Learning Path are derived, not stored.

These are **candidates, not decisions**. Each is tied to a tool that needs it,
with the rationale for why the current shape falls short. The existing
collections already store the schema-backed Assessment/Attempt artefacts
(`putAssessment` enforces the Concept-tag bridge and persistence invariants;
`generateAssessment` persists through `createAssessmentForLearner`), so no new
collection is needed for those.

---

## 1. Concepts catalog

**What:** a shared (not per-Learner) collection of the Subject's curriculum —
each Concept with its name, description, and canonical learning Items.

**Tools that need it:** `getConcept`, `getItem`, `generateAssessment`.

**Rationale:** today Concept content only exists *inside* per-Learner
Assessments (e.g. the practice-factorisation Items). That means:

- `getConcept(concept)` and `getItem(itemId)` scan the Learner's Assessments
  for Items tagged by Concept — an O(all assessments) scan, and content only
  exists if an Assessment happens to cover it.
- `generateAssessment` derives its concept list from the Gap Map, which only
  contains Concepts the Learner has *attempted* — so a Diagnostic cannot cover
  the full Subject, and a fresh Learner has no concepts to ground a Diagnostic
  in.

A shared catalog makes `getConcept`/`getItem` direct lookups and gives
`generateAssessment` the full curriculum for a proper Diagnostic. It is the
one thing the current per-Learner collections cannot express.

**Shape:** keyed by Subject → Concept (name, description, canonical Items).
Not per-Learner; shared across Learners.

---

## 2. Concept prerequisites

**What:** directed edges between Concepts ("learn X before Y") within a
Subject.

**Tools that need it:** `getLearningPath` (and `generateAssessment` targeting).

**Rationale:** CONTEXT.md defines the Learning Path as ordering Concepts by
Knowledge Gap severity **and prerequisites**, but prerequisites are not in the
model at all. The path today is severity-sorted from the Gap Map only, so it
cannot respect "Factorisation before Quadratic Equations" style ordering.
Prerequisite edges let the path honour the curriculum's dependency structure,
not just "weakest first".

**Shape:** per-Subject directed edges between Concept names.

---

## 3. Transcript

**What:** per-Learner Companion conversation history.

**Tools that need it:** the Companion's conversation
(`transcriptFor` / `appendTranscript`).

**Rationale:** the transcript currently lives in `localStorage` (per-Learner,
ephemeral). ADR-0004 already lists Firestore as the source of truth for the
persisted transcript, with the browser holding an ephemeral copy for instant
UX. This entry confirms it belongs in the DB shape; it is not a new idea, just
an explicit slot.

**Shape:** per-Learner append-only list of turns
(`{ role: user|assistant, content, at }`).
