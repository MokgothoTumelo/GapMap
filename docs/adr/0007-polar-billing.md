# 0007 — Polar billing via `gapmap-poc`: hosted checkout links in, webhook-mirrored Firestore doc as truth

Date: 2026-09-26 · Status: accepted

## Context

The Billing gate (`GapMapAuth` in `frontend/js/auth-guard.js` plus
`subscription.html`) enforced the 30-day trial with a client-side
`localStorage` clock and a Paystack R1 verification charge: money moved just
to prove a card. The clock resets when storage is cleared, lives on one
device only, and the gate could never tell a real checkout from a click.
Polar's `gapmap-poc` sandbox org now holds the catalog — Learner Monthly
R40/mo and Learner Annual **R420/yr** (R60 off 12 × monthly), both ZAR with a
native 30-day trial: card collected at checkout, no charge until day 30,
conversion reminders on. Firebase work belongs to a different teammate, so
this decision splits the migration: catalog + interim frontend now, durable
truth on handoff (`docs/polar-billing-handoff.md`).

## Decision

1. **Polar is the billing source of truth.** Checkout happens on
   Polar-hosted links; the R1 verification charge is deleted and never
   replaced. The Free Trial card reuses the Monthly link — trial lives on
   the products, so "start trial" and "subscribe monthly" are one action.
2. **The durable access record is `learners/{uid}/billing`** in Firestore
   (`status`, `planKey`, `trialEndsAt`, `currentPeriodEnd`,
   `polarCustomerId`), written **only** by a `customer.state_changed`
   webhook handler on a Firebase Cloud Function with the Admin SDK.
   `serve.mjs` keeps exactly one route (`GET /api/download`); the webhook
   is never a `serve.mjs` route, so ADR-0004's amendment stands unmodified.
3. **The webhook joins Polar → Learner on verified Auth email**, never on
   client-supplied `uid`; checkout metadata (`gapmap_plan`) is a hint only.
4. **The browser must never hold a Polar API secret, and a Learner must
   never write their own billing doc** (`firestore.rules`: owner-read, no
   client write; Admin SDK bypasses rules).
5. **Interim, until the Cloud Function exists:** the gate keeps the local
   trial record, but trial-start is written only on return with a
   Polar-issued `checkout_id` (`handlePolarReturn()` in
   `dashboard.html` — Polar's per-link `success_url` points at the
   Dashboard), never on CTA click. (Correction 2026-09-26: first draft
   named `subscription.html`; the handler moved before implementation.)
6. **Tests and the key-free demo never touch live Polar.** Browser tests
   keep seeding the session helper (`tests/helpers/session.js`); live
   checkout is a manual sandbox path.

## Rationale

Native trials remove both the R1 hack and the spoofable clock in one move.
A Cloud Function (not `serve.mjs`) keeps the one-route constraint and the
future Firebase Hosting swap mechanical. Email-join stops a Learner claiming
another Learner's subscription. The interim keeps the demo gate working
without pretending Polar is verified — and the return handler makes even the
interim start on a server-issued id.

## Consequences

- New surface to build and operate: Cloud Function + webhook secret +
  `firestore.rules#/billing` — owned by the Firebase teammate per
  `docs/polar-billing-handoff.md`; no Firebase files were touched here.
- `auth-guard.js` billing source becomes an async Firestore read preferring
  the billing doc; `gapmap_billing:*` keys migrate then delete at cutover.
- `subscription.html` is links + portal + return handling (done, interim);
  Manage Subscription points at the Polar Customer Portal once customer
  sessions are wired server-side.
- Card-only payment (plus Apple/Google Pay where available) is the accepted
  ceiling — no EFT, SnapScan, or PayPal. If that blocks Learners, it needs a
  product decision, not a silent link swap.
- `success_url` is environment-coupled (localhost now): repoint both links
  at the public URL on deploy — dashboard edit, no code change.
- Trial-abuse prevention stays off in sandbox; enable it in production
  (dashboard toggle).
