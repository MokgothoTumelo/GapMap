# GapMap Learning Companion

The Learning Companion: the only part of GapMap that must run off the
learner's machine, because it holds the provider key. Its decided shape
([ADR-0004](adr/0004-firebase-ai-logic.md), closed 2026-08-20) is **Firebase AI
Logic** — orchestration in the browser via the Web SDK, with a managed proxy
holding the credential. The Node agent service (`agent/`, `server/` agent
mounting, `pi-agent-core`/`pi-ai`, SSE) has been purged. The browser-side
Companion client and explicit live-error path are now implemented; the live
Firebase AI Logic model is loaded by default through the root `agent-config.js`
bootstrap, and the key-free demo/test path opts out per session with
`?agent=off`.

## Decided architecture (ADR-0004)

- **Runtime.** Browser via the Firebase AI Logic Web SDK (`firebase/app` +
  `firebase/ai`: `getAI` / `GoogleAIBackend` /
  `getGenerativeModel` + `generateContentStream`/`startChat`). No Node agent
  process. The stable model pool comes from
  `frontend/js/agent-runtime-config.js` and currently holds
  `gemini-3.5-flash-lite` alone — chosen for its higher rate limits under
  concurrent Learners; transient provider failures are retried with
  backoff, then the next model in the pool is tried, and the error is surfaced
  once the pool is exhausted.
- **Deployment.** A separate managed proxy between the client SDK and the
  Gemini API provider (auto-provisioned P4SA service account). No API key in
  the bundle.
- **Auth.** Firebase Auth JWT (Learner identity) + Firebase App Check
  (attestation; reCAPTCHA Enterprise in production, Debug Provider on
  `localhost`). App Check enforcement is required from 2026-11-02;
  `useLimitedUseAppCheckTokens: true` + replay protection in production.
  Per-Learner rate limits are 100 RPM by default, enforced server-side.
- **State.** Firestore (or Postgres via a Cloud Function) as source of truth
  per Learner: Gap Map + Learning Path + persisted transcript. The browser
  holds an ephemeral transcript in memory/`localStorage` for instant UX and
  persists to Firestore. The transcript is no longer global.
- **Transport.** Request-scoped streaming via the SDK. No global `Agent`
  singleton, no `clients` Set, no `202` fire-and-forget, no SSE.

## Current state (post-purge, mock integration landed)

- The Node prototype is gone: `agent/`, `server/`, the pi dependencies, and
  the SSE routes.
- The agent panel (`frontend/agentPanel/`) now uses the request-scoped
  `frontend/js/agent-client.js` seam. It no longer calls `/api/agent/*` or
  opens an `EventSource`; it uses request-scoped Firebase AI Logic and
  persists successful turns through the mock `learnerStore`. The live agent
  is **on by default** — the panel loads `agent-config.js` on every page
  unless the session opted out with `?agent=off` (sticky in sessionStorage,
  so the key-free demo flow stays key-free across navigation). Missing live
  configuration and provider errors are shown in the panel. The panel builds
  the Learner context from the mock store plus the Learner Profile — name,
  Language, Explanation Level, active Subject — before building the prompt. If
  the app team
  exposes `globalThis.gapmapLearnerContext`,
  the panel merges that in-memory project-A context with the mock context
  before building the prompt.
- `frontend/js/firebase-agent.js` contains the SDK-injection seam for a named
  agent Firebase app and the stable model pool; the root `agent-config.js`
  uses that seam for the agent project when the Firebase Web SDK is
  available. For the current shared development setup, App Check
  initialization is commented out so teammates need no project access or
  debug-token registration. The production App Check block remains in the
  file for later restoration. The demo path (Diagnostic → Gap Map → Learning
  Path → Practice) remains independent of a live model.
- The Companion has a **tool-calling interface** (see
  [ADR-0005](adr/0005-companion-tool-calling.md), in progress): the model
  discovers Learner context on demand instead of having it all injected into
  every prompt. The execution loop lives in `agent-client.js`; the discovery
  tools `getGapMap`, `getLearningPath`, `getConcept`, `getItem`,
  `getAttemptHistory`, and `getPlatformHelp` are wired end-to-end against the
  mock `learnerStore` (`generateAssessment` is planned). The Gemini 3
  thought-signature requirement is handled by echoing the raw `functionCall`
  parts back verbatim.
- **The Learning Path tools are root-cause aware**
  ([ADR-0006](adr/0006-concept-graph-learning-path.md)): the panel injects a
  `getConceptGraph` provider (the Subject's graph via the subject store,
  `frontend/js/subject-store.js`, which serves `data/subjects/`); when a graph exists, `getGapMap` and
  `getLearningPath` return the derived chain — entries with `origin`,
  `blocks`, `blockedBy`, Mistake-Diagnosis `evidence`, plus `rootCauses` —
  and `getConcept` adds `prerequisites` / `dependents`. Without a graph the
  tools keep the flat severity list; the degradation is honest. The system
  prompt forbids inventing root causes that are not in the tool data.
- The static demo remains usable without live AI because its Assessment path
  does not depend on the Companion, and the demo can opt out of the live
  bootstrap with `?agent=off`. The Companion does not fabricate a reply
  when Firebase AI Logic is unavailable, and no test requires a live key.

## Remaining live-integration checklist

1. ~~Load the Firebase Web SDK and the agent project's config, initialise the
   named app through `frontend/js/firebase-agent.js`, and expose its model
   pool to `agent-client.js`.~~ **Done:** the panel loads the bootstrap by
   default and the client retries transient capacity failures, tries the next
   stable model, and surfaces the provider error when live inference fails.
2. Replace the mock `learnerStore` with the database team's project-A
   Firestore adapter once its collection and security-rule shape is agreed.
   The client already injects the store's Gap Map and Learning Path context.
3. Move the mock transcript from localStorage to the project-A Firestore
   transcript subtree; retain the Learner-keyed interface and drop no
   per-Learner identity into the agent project.
4. Keep App Check unenforced for the current shared development setup.
   Before production enforcement, restore the commented App Check wiring and
   limited-use-token replay protection; authenticated-users mode remains
   optional for the stateless inference project.
5. Assessment generation already has deterministic local and model adapters;
   connect the model adapter to the live Firebase model and add the shared
   Mistake Diagnosis path when that contract is ready.

## What it consumes and produces

The integration points (what is passed to the model, what the model produces,
and how that is answered) are solved and documented in
[`../core/README.md`](../core/README.md) under *Integration points*. Companion
chat is wired to the browser client and consumes an injected Firebase AI
Logic model; the mock store supplies the current Learner context. Assessment
generation has local and model adapters. Firestore persistence and the full
Mistake Diagnosis path remain planned.

## See also

- [`adr/0004-firebase-ai-logic.md`](adr/0004-firebase-ai-logic.md) — the
  decision that replaced the Node agent service.
- [`adr/0005-companion-tool-calling.md`](adr/0005-companion-tool-calling.md)
  — in progress: discoverable Learner context via tool calling.
- [`learner-store.md`](learner-store.md) — the implemented baseline: identity
  layers, the `learnerStore` seam, and Assessment create/retrieve.
- [`agent-firebase-setup.md`](agent-firebase-setup.md) — how the live agent
  project is enabled by default and how to opt the key-free demo/test path
  out with `?agent=off` without teammate Firebase access.
- [`adr/0002-google-gemini-stored-credential.md`](adr/0002-google-gemini-stored-credential.md)
  — superseded (stored credential).
- [`../core/README.md`](../core/README.md) — the artefact contract and
  integration points.