## SEQUENCE TO FOLLOW

        index.html
            ↓
        signup.html  →  (OTP)  →  setup.html   (grade + subject)
            ↓                         ↓
        login.html  ────────────────→  setup.html  (or directly to diagnostic)
                                            ↓
                                        diagnostic.html   (grade + subject pick the artefact)
                                            ↓
                                        dashboard.html    (Gap Map + Learning Path)
                                            ↓
                                        concept.html?concept=…  (Learn → Practice → Results)
                                            ↓
                                        library.html      (past papers + videos)

Guests are routed to `login.html` from every protected page
(`frontend/js/auth-guard.js`). Re-measurement: the Gap Map's *Retake Diagnostic*
re-runs the Diagnostic for the active Subject.

## Current state

- Wired end to end: signup/login → setup (grade + subject) → Diagnostic →
  Gap Map + Learning Path → Learn/Practice → Results, plus the Library.
- Signup mints the Learner's id onto their Profile (`uid`), and the Learner
  store keys Gap Map, Attempts, and the transcript by it — the Profile is the
  join between who the Learner is and their data.
- **Re-measurement is retaking the Diagnostic** (dashboard → Retake Diagnostic):
  fresh Responses, a fresh Gap Map for the active Subject; Attempt history stays
  append-only. The separate **Retest** Assessment kind has been removed from
  `core/schema/` and the generator/Companion tools.
- Practice is **composed from the pool** the AI generated
  (`frontend/js/assessment-composer.js`): `concept.html` cherry-picks Items for
  the Concept across the Learner's stored assessments, unseen-first, and
  freezes the result as a Practice artefact (schema-clean `q1..qN` ids,
  validated, persisted). Completing it writes an Attempt back, which drives
  the next composition's unseen-first selection. Concepts the bank doesn't
  teach but the pool covers are served straight into Practice; the bank
  remains the fallback when the pool is thin.
- **The Learning Path is a root-cause derivation**
  ([ADR-0006](adr/0006-concept-graph-learning-path.md)): every Subject's
  **Concept Graph** (`data/subjects/graph-g<grade>-<subject>.yaml`, served by
  the subject store — `frontend/js/subject-store.js`) plus the Gap Map drive
  `core/learning-path.js` — roots first, severity as tie-break, each entry
  carrying what it blocks, what blocks it, and its origin grade. The dashboard
  renders a **root-cause banner** (with Mistake-Diagnosis evidence when the
  Learner's attempts carry kinds) and the path as a **dependency chain** with
  arrow connectors naming each dependency — and "View as data" exposes the
  derived path object (entries, roots, evidence, provenance), the same object
  the Companion's tools return; `concept.html` answers "why this is
  on your path". The flows are pinned in `docs/flows/` ("see why you're
  stuck", "clear the blocking gap"). Mistake Diagnoses gained a `kind`
  (`misread | procedure | concept | prerequisite`), with prerequisite kinds
  naming the blocking Concept, so the readout is evidence-backed from the
  artefacts. **Scoring is uniform**: `core/scoring.js` owns every Score and
  Mastery classification (strong ≥80, improve 50–79, weak <50) — pages hand
  over per-Item verdicts via `scoreFromFlags` and never hand-roll percentages
  or thresholds.
- Subject and Language stay in the nav (context switches, feeding the
  Companion's context from the next turn); the avatar opens the Profile menu —
  identity glance, profile.html, Log out — and **profile.html** holds the whole
  Learner Profile in one inspectable place: Account (name, password; email is
  read-only in the demo) and Preferences (Subject, Language, Explanation
  Level). Grade stays part of Setup. Page copy and the Concept bank are still
  English-only — translated content is open work. The Companion panel docks as
  a right-hand rail below the sticky nav on desktop (nav visible, content
  shifted clear of it); narrow screens keep the overlay drawer. The AI phase's
  acceptance criteria are folded into `docs/ai-phase-requirements.md` with
  their status.
- Diagnostic results are stored per Learner + Subject
  (`gapmap_diagnostic:<learner>:<subject>`) — every presentation-level key
  (Gap Maps, practice results, history) is scoped through
  `GapMapAuth.learnerScope()`, so data never crosses Learners on one browser;
  the legacy unscoped keys are no longer read or written. Each Diagnostic also
  writes an Attempt through `frontend/js/learner-store.js`.
