# Flow: Clear the blocking gap — the Learner works the root Concept and re-measures

Trigger:  The Learner follows the root-cause CTA (or any chain node) from the
          dashboard to `concept.html?concept=…`.
Goal:     The Learner understands the blocking Concept, practises it, sees the
          result, and re-measures so the Gap Map shows whether Mastery moved.
Pre:      Signed in; a Gap Map exists for the active Subject; the Subject
          store serves the Concept Graph; Practice is composed from the
          Learner's generated pool where it covers the Concept.

## Steps
| # | Learner action | Expected observable behavior | Time class |
|---|----------------|------------------------------|------------|
| 1 | Open the Concept page | The Learn screen opens with the Concept's explanation and tip, and — when the Concept is on the path — a chip answering **why it's there**: "Why this is on your path: at N% — first taught in Grade X, it unblocks Y." A strong Concept shows no chip. | instant |
| 2 | Study the worked examples | Examples advance on request; the page stays on the Concept. | instant |
| 3 | Start Practice | Practice serves pool-first: Items composed from the Learner's generated assessments for this Concept (unseen-first), frozen as a Practice artefact; the in-page Concept bank is the fallback when the pool is thin. | instant |
| 4 | Answer the Practice Items | Each answer advances immediately with per-Item correctness; the progress counter updates. | instant |
| 5 | Land on Results | The Score ("You got X out of Y correct") and the Mastery-keyed next-step copy render; a single percentage is never the headline — the Concept's Score is contextualised against the path. Score and Mastery come from core/scoring.js (strong ≥80, improve 50–79, weak <50). | instant |
| 6 | Return to the Gap Map | The dashboard re-derives from the new Attempt: the practised Concept's Score may have moved; the chain re-renders with the same rules as steps 2–3 of *see-why-you're-stuck*. | instant |
| 7 | Re-measure | "Retake Diagnostic" from the dashboard starts a fresh Diagnostic; the fresh Gap Map shows whether Mastery moved. Attempt history stays append-only. | instant (demo); backend-paced (generation) when a live model authors the artefact |

## Failure paths
| From step | Failure | Expected feedback / recovery |
|-----------|---------|------------------------------|
| 3 | The pool is thin for this Concept | The in-page Concept bank serves the Practice; the flow does not dead-end. |
| 5 | The Learner's Attempt cannot be persisted | A console warning explains it; the Results screen still renders for this sitting — the next composition reuses what exists rather than stacking duplicates. |
| 1 | The Concept isn't in the bank or the pool | An empty state says so plainly and points back to the Gap Map. |

## Known gaps (annotations, not expectations)
- Step 3: Practice composition is deterministic and local; live
  model-generated Practice lands via the Companion's `generateAssessment` —
  evidence: docs/companion.md (remaining live-integration checklist).
- Step 7: re-measurement is a full Diagnostic retake; a lighter single-Concept
  re-check was deliberately removed with the Retest artefact kind (CONTEXT.md,
  flagged ambiguities) — evidence: core/README.md "How that gets answered".

---

*Evidence verified 2026-09-21 against this session's build
(tests/demo.spec.js "Concept practice runs from the Gap Map to Results";
tests/root-cause.spec.js concept-page steps; the scoring unification made
Results come from core/scoring.js). Flow shape Learner-calibrated
2026-09-21.*