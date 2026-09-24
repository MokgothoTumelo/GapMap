# User flows — GapMap

UX quality on this repo is judged against written flows, not taste. One file
per flow under `docs/flows/`; bugs and UX ideas reference them as
`flows/<flow>.md` step N — expected A, got B.

## Instantiation

- **The repo's word for its user:** **Learner** (see `CONTEXT.md`; never
  "student", "user", "pupil").
- **Time classes:** `instant` (same interaction frame), `seconds` (a
  round-trip), `backend-paced` (a live model's window — Assessment generation
  and Companion replies are the only backend-paced surfaces; the key-free demo
  path is deterministic and instant). No repo-specific name — the "backend" is
  the Firebase AI Logic model pool, still forming, so the generic class stays.

## Current flows

| Flow | Status | File |
|---|---|---|
| See why you're stuck | active | [see-why-youre-stuck.md](see-why-youre-stuck.md) |
| Clear the blocking gap | active | [clear-the-blocking-gap.md](clear-the-blocking-gap.md) |

## Candidates (not yet captured)

- Choose a Subject / Language / Explanation Level and see the context switch
  (nav switchers; profile.html) — surfaced by the AI phase work.
- Practise from the generated pool (composition, unseen-first selection).

## Archived flows

None yet.