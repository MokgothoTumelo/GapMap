# Firebase AI Logic for the Learning Companion

The Learning Companion moves from a custom Node agent service to **Firebase AI
Logic** — orchestration in the browser (Web SDK), credential + policy on a
managed proxy. This closes the five open questions (runtime, deployment
location, auth shape, user-state storage, transport) and supersedes
[ADR-0002](0002-google-gemini-stored-credential.md) (stored Gemini credential)
and the seam-based Node server's agent mounting.

> **Implementation update:** the browser-side mock integration has since been
> landed in `frontend/js/agent-client.js`, `frontend/js/learner-store.js`, and
> `frontend/js/firebase-agent.js`. The panel is no longer on the retired
> `/api/agent/*` protocol; it now requires live Firebase AI Logic and surfaces
> setup/provider errors instead of fabricating a response. The historical
> pre-rewire panel status described in the consequences below is retained as
> context. The original `gemini-3.7-flash` pin is now implemented as a
> resilient stable model pool: `gemini-3.5-flash` → `gemini-3.5-flash-lite`;
> exhausted capacity is an explicit error. `npm run smoke:agent` checks the
> real endpoint without a browser. App Check initialization is intentionally
> commented out for the current shared-development setup; the production
> App Check block remains in `agent-config.js` for restoration before the
> enforcement deadline.

> **Amendment (2026-08-20):** the earlier implementation update over-reached
> beyond the approved decision by making live inference opt-in via
> `?agent=live` and framing the demo as "key-free by default" — a rationale
> the user never approved. The Companion is **live by default**: the panel
> loads the Firebase AI Logic bootstrap on every page unless the session opts
> out with `?agent=off` (sticky in sessionStorage), which is the key-free
> demo/test escape hatch, not the product default. The no-fabrication rule
> stands: when live inference is unavailable or opted out, the panel surfaces
> the error rather than inventing a reply. The opt-in framing is corrected
> below.

## Considered options

- **Keep the Node `Agent` + pi-agent-core/pi-ai + SSE singleton.** Rejected:
  the global instance (`sessionId: 'gapmap-learning-companion'`) blocks
  per-Learner auth; the long-lived process with a `clients` Set and
  `202` fire-and-forget does not fit static hosting or serverless; the custom
  plumbing duplicates what a managed proxy provides.
- **Direct Gemini calls from the browser with the key in the bundle.**
  Rejected: the key must never ship to the client.
- **Firebase AI Logic.** Chosen: the "simple single-purpose agent that runs
  with the app in the browser but has requests (and API keys) run on our
  servers" split. `core/` stays runtime-agnostic.

## Decision

- **Runtime.** Browser via the Firebase AI Logic Web SDK (`firebase/app` +
  `firebase/ai`: `getAI` / `GoogleAIBackend` /
  `getGenerativeModel({ model: "gemini-3.7-flash" })` +
  `generateContentStream`/`startChat`). No Node agent process. Model pinned to
  `gemini-3.7-flash`.
- **Deployment location.** A separate managed proxy, not embedded in the data
  backend. The Firebase AI Logic gateway sits between the client SDK and the
  Gemini API provider (Gemini Developer API via the auto-provisioned P4SA
  `service-PROJECT@gcp-sa-firebasevertexai.iam.gserviceaccount.com`, or Agent
  Platform Gemini API). No API key in the bundle. Per-Learner state (Gap Map,
  Learning Path, transcript) is *not* in the proxy — it is injected into the
  prompt client-side before the call, or via server prompt templates / Remote
  Config.
- **Auth shape.** Firebase Auth JWT carries Learner identity; Firebase App
  Check carries attestation (reCAPTCHA Enterprise for web in production,
  Debug Provider `self.FIREBASE_APPCHECK_DEBUG_TOKEN=true` for `localhost`).
  Both tokens are sent with every AI Logic request and verified by the proxy.
  Per-Learner rate limits are 100 RPM by default (configurable per-region in
  Cloud Console), enforced server-side. App Check enforcement is required from
  2026-11-02; `useLimitedUseAppCheckTokens: true` + replay protection is the
  production setting.
- **User-state storage.** Firestore (or Postgres via a Cloud Function) as
  source of truth per Learner: Gap Map + Learning Path + persisted transcript.
  The browser holds an ephemeral transcript in memory/`localStorage` for
  instant UX and persists to Firestore. The transcript is no longer global.
- **Transport / deployment model.** Request-scoped streaming via the SDK, not
  a long-lived process. No global `Agent` singleton, no `clients` Set, no
  `202` fire-and-forget. Each call streams on that request; works on static
  hosting + serverless and removes the global-state conflict that blocked
  per-Learner auth.

## Consequences

- The Node prototype is purged: `agent/` (singleton, credentials, `auth.json`),
  `server/` agent mounting + SSE routes, and the `@earendil-works/pi-agent-core`
  / `pi-ai` dependencies. The repo keeps a minimal static-only server
  (`serve.mjs`) for the demo and tests; static hosting may later move to
  Firebase Hosting.
- At decision time, the agent panel UI (`frontend/agentPanel/`) was left as-is
  and was **inert**: it spoke the old protocol (`/api/agent/prompt`,
  `/api/agent/reset`, `/api/agent/events`), which no longer existed. That
  historical pre-rewire state has now been replaced by the browser client
  described in the implementation update above. The live `firebase/ai`
  setup remains an injected seam because this repo has no production project
  config. The demo path (Diagnostic → Gap Map → Learning Path → Practice →
  Retest) does not require the companion.
- The Assessment demo remains usable without live AI. The Companion is live
  by default; the key-free demo and test path opts out per session with
  `?agent=off`. The Companion does not fabricate a response when live
  inference is unavailable or opted out; it surfaces the error. Tests never
  require a live key, while `npm run smoke:agent` is the explicit live
  endpoint check.
- ADR-0002 is superseded: the stored credential and `agent/auth.json` are
  retired with the Node service. The key itself is a free-tier shared key and
  is not rotated.
- `core/` stays runtime-agnostic; the *Integration points* contract in
  `core/README.md` is unchanged — the Companion consumes it from the browser
  instead of a Node service.