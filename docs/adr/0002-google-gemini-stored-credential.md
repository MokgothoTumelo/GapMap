# Google Gemini via stored credential

> **Superseded by [ADR-0004](0004-firebase-ai-logic.md) (2026-08-20):** the
> stored credential and `agent/auth.json` are retired with the Node agent
> service; the Companion now runs in the browser via Firebase AI Logic with a
> managed proxy holding the key. Kept for history.

The Learning Companion uses Google Gemini (`gemini-3.7-flash`) as its only
provider, authenticated by a stored credential in `agent/auth.json`
(the same directory as the agent feature) — no environment variables, and no
filesystem access in the agent feature itself.

The prototype shipped with a three-provider fallback chain (Anthropic → OpenAI
→ Google) selected by whichever of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GOOGLE_API_KEY` was set, with a per-provider default model and a `PI_MODEL`
override. That chain was POC scaffolding: it supported providers the product
never used, and its Google branch checked `GOOGLE_API_KEY` while pi-ai's
Google provider actually resolves auth from `GEMINI_API_KEY` (or a stored
credential / explicit `apiKey`) — the branch failed at stream time. The
provider chain collapses to Google; the model is pinned to `gemini-3.7-flash`
with the `gemini-flash-latest` alias as a catalog fallback; the key comes from
a stored credential, never an environment variable.

## Considered options

- **Environment variables** (`GEMINI_API_KEY`). Rejected: per-shell setup, and
  the team shares one free-tier key — a stored credential is one setup step
  per machine instead of a per-shell export.
- **pi's `~/.pi/agent/auth.json`.** Rejected: ties the app to a per-machine
  home directory; the team would have to copy the file around anyway.
- **In-repo `agent/auth.json`, read by the agent feature.** Rejected:
  the agent feature must stay platform-agnostic — filesystem access belongs to
  the adapter (`server/index.mjs`), so a serverless host swap only changes the
  adapter.
- **Keep the three-provider chain.** Rejected: POC scaffolding for providers
  the product never uses; the Google branch's env check was wrong anyway.

## Consequences

- One setup step per machine: drop `agent/auth.json` into the repo
  (gitignored; the team shares it by copying or force-adding — free-tier key).
- The `GOOGLE_API_KEY`/`GEMINI_API_KEY` mismatch is gone; auth resolution is
  pi-ai's own, and an explicit key wins over env vars by design.
- Tests and offline use never need a key; the local demo remains the fallback.
- **Pinned:** the agent is still one global instance (`sessionId:
  'gapmap-learning-companion'`) — every client shares a transcript and the
  busy state is global. Per-user auth is being added by another team member;
  the global instance is accepted until then and must be revisited when
  per-user sessions are pinned down.