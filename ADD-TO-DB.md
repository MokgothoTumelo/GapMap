# ADD-TO-DB

Candidate additions to the database shape, surfaced by the implemented
Companion tools. The authority on the current shape is
[`docs/learner-store.md`](docs/learner-store.md) — the store holds per-Learner
artefacts (Assessments, Attempts) and the Companion transcript, plus derived
convenience caches (the latest Diagnostic summary and Practice history); the
Gap Map and Learning Path are derived on read, not stored.

These are **candidates, not decisions**. Each is tied to a tool that needs it,
with the rationale for why the current shape falls short. The existing
collections already store the schema-backed Assessment/Attempt artefacts
(`putAssessment` enforces the Concept-tag bridge and persistence invariants;
`generateAssessment` persists through `createAssessmentForLearner`), so no new
collection is needed for those. Resolved candidates are kept at the bottom as
a record, not as open work.

---

## Open candidates

### 1. Concepts catalog

**What:** a shared (not per-Learner) collection of the Subject's curriculum —
each Concept with its name, description, and canonical learning Items.

**Tools that need it:** `getConcept`, `getItem`, `generateAssessment`.

**Rationale:** Concept names, descriptions, and prerequisite edges already live
Subject-level in the **Concept Graph** (`data/subjects/`, served by
`frontend/js/subject-store.js` — ADR-0006), so `getSubjectConcepts` no longer
depends on the Learner's own data. Canonical *Items* do not: Item content only
exists inside per-Learner Assessments (e.g. the practice-factorisation Items).
That means:

- `getConcept(concept)` and `getItem(itemId)` scan the Learner's Assessments
  for Items tagged by Concept — an O(all assessments) scan, and content only
  exists if an Assessment happens to cover it.
- `generateAssessment` derives its concept list from the Gap Map, which only
  contains Concepts the Learner has *attempted*, so a fresh Learner has no
  subject-wide Item content to ground a Diagnostic in (the model can propose
  content, but there is no canonical pool to validate it against).

A shared catalog makes `getConcept`/`getItem` direct lookups and gives
`generateAssessment` canonical curriculum content. It is the one thing the
current per-Learner collections cannot express.

**Shape:** keyed by Subject → Concept (name, description, canonical Items).
Not per-Learner; shared across Learners.

---

## Resolved candidates

### 2. Concept prerequisites — resolved by ADR-0006

Prerequisite edges landed as the Subject-level **Concept Graph**
(`data/subjects/graph-g<grade>-<subject>.yaml`, schema at
`core/schema/concept-graph.schema.json`, served by
`frontend/js/subject-store.js`), and `core/learning-path.js` derives the
roots-first Learning Path from it. One home per Subject; no per-Learner
collection. The remaining question is only how non-demo Subjects get their
graph — the model-proposal path exists in
`frontend/js/concept-graph-generator.js` but is not wired to a UI trigger.

### 3. Transcript — resolved (implemented)

Persisted at `learners/{uid}/companionMessages/{messageId}` (append-only;
`saveCompanionMessage` in `frontend/js/firebase-data-store.js`), written
alongside the mock store's local transcript. Replay still reads the mock copy
(`learnerStore.getTranscript`), so dropping the local transcript is the
remaining half — not a new collection.
