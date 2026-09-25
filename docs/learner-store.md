# Learner store and agent integration — design

Status: **implemented baseline**. This is the plan of record for the seams
the [live-integration checklist](companion.md) depends on: who the Learner is
(identity), where per-Learner artefacts live (the store), and how Assessments
are created and retrieved (generation). The mock browser store, the project-A
Firestore persistence (`frontend/js/firebase-data-store.js`), the local +
model generation seam, and the live agent config are in place. The Open
points below record what is still unresolved — including the checked-in
security rules versus the derived-summary payload. Decisions that firm up
should be folded into [ADR-0004](adr/0004-firebase-ai-logic.md) or a
successor ADR.

Terminology follows [../CONTEXT.md](../CONTEXT.md): Learner, Learner Profile,
Assessment (Diagnostic / Practice), Attempt, Gap Map, Learning Path.

## Identity: two layers, deliberately separate

Firebase identity appears in two places that must not be conflated.

**Layer 1 — Learner context (prompt-borne).** The app's Firebase project
(project A, `gapmap-6cb1d`; the wiring is `frontend/js/firebase-app.js`)
provides `getCurrentUser()`. That uid **is** the
`learnerId`: it keys every read and write in the store, and the Learner's
context (Gap Map, Learning Path, transcript) is injected into the prompt
client-side before the call — exactly what ADR-0004 prescribes ("Per-Learner
state … is not in the proxy — it is injected into the prompt client-side
before the call"). The panel also accepts an optional
`globalThis.gapmapLearnerContext` provider from the app team for in-memory
preferences or project-A derived state. This layer works regardless of how
many Firebase projects are in play, because it is just data in memory.

**Layer 2 — gateway attestation (project-borne).** The agent's Firebase
project (project B, ours) is **strictly for Firebase AI Logic**: no Firestore,
no Learner data, no per-Learner state. Its only security posture is Firebase
App Check (attestation of the app, required from 2026-11-02; debug provider
on `localhost`). For current shared development, App Check initialization is
commented out so teammates need no project access or debug token. It must be
restored before production enforcement. Authenticated-users mode stays **off**
(its default) in project B — the gateway has no Learner identity and needs
none. Per the
[auth-mode doc](https://firebase.google.com/docs/ai-logic/auth-mode), that
setting is project-wide and, unenforced, allows requests that carry no
Authentication credentials.

Accepted consequences of this split:

- Project B is stateless inference. Worst case, an attested caller prompts
  "as" a `learnerId` it invented — there is nothing in project B to read, and
  the store's security lives entirely in project A (Firestore rules keyed to
  project A's own Auth uids).
- Per-user rate limits (100 RPM default) key on the calling project's Auth
  credentials; with no signed-in user in project B, per-user limiting is not
  guaranteed ([quotas](https://firebase.google.com/docs/ai-logic/quotas)). If
  that ever matters, anonymous sign-in on the agent app gives the gateway a
  per-user key (anonymous users count as authenticated, per the auth-mode
  doc). Deferred until real usage.
- The Learner's uid never needs to be valid in project B — it travels as
  prompt text and as a store key, nothing more.

In production, **Firebase Authentication owns identity**: signup/sign-in yield a
stable Firebase `uid`, and that uid is the `learnerId` used to join durable
Firestore records. The local `gapmap_user` value is a lightweight page-session
snapshot. The key-free offline demo and tests can still use the demo-selected id
(`learner-001` from `core/demo-data/`) so they exercise the same store seam
without touching a real database. `getCurrentLearner` gives Firebase Auth
precedence when a Firebase account is available.

## Deployment shape

One page, two Firebase apps, one Learner store behind two persistence
targets:

```text
browser (one page)
 ├─ app Firebase (project A — gapmap-6cb1d, named app 'gapmap-data')
 │    ├─ Auth: getCurrentUser() → uid → learnerId
 │    └─ Firestore: per-Learner artefacts and Profile data
 ├─ Learner store (two implementations, no adapter between them)
 │    ├─ mock: frontend/js/learner-store.js — localStorage/in-memory; empty
 │    │    at start; the pages fill it from the generator or core/demo-data/
 │    └─ Firestore: frontend/js/firebase-data-store.js — flat save*/get*
 │         functions the pages call alongside the mock (dual write)
 └─ agent Firebase (project B — gapmap-63650, named app, AI Logic only)
      └─ getAI(getApp('gapmap-agent'), { backend: new GoogleAIBackend() })
           prompt = system + Learner context + message → streamed reply
```

Two apps in one page is the documented pattern
([configure multiple projects](https://firebase.google.com/docs/projects/multiprojects)):
the agent app is `initializeApp(agentConfig, 'gapmap-agent')`, initialised
alongside project A's app (`gapmap-data`). Project B's App Check wiring is currently
commented for shared development; when restored, it must use project B's own
reCAPTCHA Enterprise or debug provider. Project A's App Check tokens are
meaningless to it.

ADR-0004's "separate managed proxy" refers to the Firebase AI Logic gateway
versus embedding in the data backend — it does not mandate a separate
Firebase project, and this two-project shape does not contradict it.

## The store seam

Everything is keyed by `learnerId` everywhere — never a global session id
(the retired Node agent's sin). There are two implementations, joined by the
`learnerStore` interface in
[`firebase-learner-store.js`](../frontend/js/firebase-learner-store.js): the
mock store is the offline fallback and the test contract; the Firestore-backed
store implements the same interface on the existing seam
(`frontend/js/firebase-data-store.js`), Firestore-first with anything written
while offline merged in, and the mock's validation run before any write. The
agent panel composes them: live sessions use the Firestore-backed store (it
gates on a signed-in Firebase Auth identity, so the signed-out page and the
key-free demo never attempt a read the rules would deny), and the opted-out
`?agent=off` demo plus every test stay entirely local.

```js
// frontend/js/learner-store.js (ES module, static-server safe) — the mock
// fallback. frontend/js/firebase-learner-store.js implements this interface
// on the Firestore seam in frontend/js/firebase-data-store.js.
export const learnerStore = {
  // Assessments — frozen once written
  async putAssessment(learnerId, assessment) {}, // validate → freeze → write
  async getAssessment(learnerId, assessmentId) {},
  async listAssessments(learnerId, { type } = {}) {}, // diagnostic|practice

  // Attempts — append-only, app-written
  async saveAttempt(learnerId, attempt) {},
  async getAttempt(learnerId, assessmentId) {},
  async listAttempts(learnerId) {},

  // Companion transcript
  async getTranscript(learnerId) {},
  async appendTranscript(learnerId, turn) {},
};
```

Design rules:

- **The mock is the test/demo contract.** `learnerStore`
  (`frontend/js/learner-store.js`; localStorage keys
  `gapmap.learner.<encoded learnerId>`) remains the implementation the key-free
  demo and tests touch — no test may touch a real database. It starts empty;
  Assessments enter it through its own validation on `putAssessment`, from
  either `frontend/js/assessment-generator.js` (in-code fixtures) or the
  authored `core/demo-data/assessments/` YAML loaded through
  `frontend/js/assessment-loader.js` (fetch + vendored js-yaml + validation),
  so the mock exercises the same validation the real store will.
- **Validation at the boundary.** `putAssessment` enforces persistence
  invariants (required identity/artefact fields, immutable ids, and the
  Concept-tag bridge through `core/validate.js`) before writing. Structural
  AJV validation remains at the live LLM boundary: the model generator accepts
  an injected `validateStructure` function for the project-specific AJV
  validator. Keeping that validator at the schema boundary avoids a second
  hand-maintained browser copy of `core/schema/`. An Item without a Concept
  never enters the store.
- **Immutability rules from `core/`.** Assessments are never mutated after
  `putAssessment`; attempts are append-only; regenerating an Assessment makes
  a new one rather than clobbering in-progress Responses.
- **Production Firestore persistence** writes under project A's Firebase Auth
  uid, shaped by the checked-in security rules (`firestore.rules`). The
  document shape remains the contract so a future store swap (including
  Postgres, per AGENTS.md) is a serialization change rather than a model
  change.

## Derived state is persisted as a convenience cache

The Gap Map and Learning Path remain **derived** by the core domain logic.
Firestore also stores the latest per-Subject Diagnostic summary under
`learners/{uid}/subjects/{subjectId}` as a read-optimized cache for the Dashboard
and sign-in hydration. Practice history
(`learners/{uid}/practiceHistory/{subjectId}__{conceptId}`) is the same kind
of cache: it stores the Item signatures already presented so repeat protection
survives a cleared browser. The canonical historical source remains the
append-only Assessment/Attempt artefacts; either cache can be rebuilt from
them.

## Generation is a separate seam from storage (decided)

The original ask — create Assessments for a Learner and retrieve them — is
two functions, not one, and generation never writes the store:

```js
// frontend/js/assessment-generator.js (ES module)
export async function generateAssessment(request) {
  // request: { type, subject, concepts?, targetConcept?,
  //            language, explanationLevel, itemCount }
  // mock mode (default, no key): createMockAssessmentGenerator — an in-code
  //   fixture (frontend/js/assessment-fixtures.js); no network, no key.
  // real mode: createModelAssessmentGenerator — firebase/ai model pool per
  //   ADR-0004's browser orchestration (frontend/js/agent-runtime-config.js;
  //   currently gemini-3.5-flash-lite alone), output validated against
  //   core/schema/ (+ core/validate.js semantics).
}
```

The local generator intentionally supports the inspectable demo fixture scope
(Grade 12 Mathematics, including Factorisation); it refuses to relabel those
Items as an unsupported Concept. The model-backed generator handles broader
requests. The create flow is: `generateAssessment` → validate → `learnerStore
.putAssessment` (freeze) → retrieve with `getAssessment` /
`listAssessments`. The public `assessment-service.js` composes that flow as
`createAssessmentForLearner`, `retrieveAssessmentsForLearner`, and
`retrieveAssessmentForLearner` without coupling generation to storage.
Retrieval is store-only. The Companion's `generateAssessment` tool calls that
service with the model-backed generator when a live model is available and
the local one otherwise. The demo Diagnostic itself does not call the
generator: it loads an authored `core/demo-data/assessments/` artefact, samples
fresh Items per Concept, and freezes that as the Assessment. Mock generation
must stay deterministic and offline — the offline demo and every test depend
on it.

## Offline and test rules

- The static Assessment demo may run without a key or network because it does
  not depend on the Companion.
- The Companion must not fabricate a response when Firebase AI Logic is absent
  or fails. It surfaces the setup/provider error so live integration failures
  remain observable.
- No test may require a key or a live Firebase project. The mock store is the
  test double; `npm run smoke:agent` is the explicit live endpoint check and
  exits nonzero on a real failure.

## Open points

1. **Firestore collection names** are now fixed by `frontend/js/firebase-data-store.js`:
   `learners/{uid}` plus the documented subcollections. Revisit only if the
   database team adopts a different top-level serialization.
2. **Transcript persistence and replay** are implemented at
   `learners/{uid}/companionMessages/{messageId}` — append-only by rule.
   `clearTranscript` is therefore local-only: the adapter records a per-Learner
   cleared-at marker (localStorage) that hides earlier turns from replay on
   that browser; the cloud copy cannot be truncated without a rule change.
3. **Agent project per-user rate keys** (anonymous sign-in on project B) —
   deferred until real usage shows a need.
4. **Companion chat wiring** (system prompt, context injection) is already
   specified in `core/README.md` *Integration points* and `companion.md`;
   this doc defers to those.
5. **Derived-summary write vs the checked-in rules.** Resolved per `CONTEXT.md` (uid IS learnerId): `saveDiagnosticSummary` now writes both `learner_id` and `uid` (same value) and `firestore.rules#/subjects` accepts either owner field, so existing Gap Maps refresh instead of being denied. The Diagnostic still swallows the write in its `allSettled` batch; the append-only Assessment/Attempt writes are unaffected.

## See also

- [companion.md](companion.md) — the rewire this design feeds
- [adr/0004-firebase-ai-logic.md](adr/0004-firebase-ai-logic.md) — the
  architecture decision
- [../core/README.md](../core/README.md) — the artefact contract and
  integration points
- Firebase docs:
  [configure multiple projects](https://firebase.google.com/docs/projects/multiprojects),
  [auth mode](https://firebase.google.com/docs/ai-logic/auth-mode),
  [App Check for AI Logic](https://firebase.google.com/docs/ai-logic/app-check),
  [quotas](https://firebase.google.com/docs/ai-logic/quotas)
