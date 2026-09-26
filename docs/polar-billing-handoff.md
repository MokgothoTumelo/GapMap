# Polar billing — Firebase handoff

Owner: Firebase teammate. Frontend + Polar catalog are done; **no Firebase
changes have been made** — this doc is the full pickup list.

Status: **interim live**. `subscription.html` points at Polar hosted
checkouts; the Billing gate still runs on the local trial record in
`frontend/js/auth-guard.js` (`gapmap_billing:<uid>`), started only on return
with a Polar-issued `checkout_id`. Everything below replaces that record.

Terminology follows `CONTEXT.md`: Learner, Learner Profile, uid IS
learnerId. Proposed decision text (not yet recorded): ADR-0007 draft from
2026-09-26 session — confirm with the team before filing under `docs/adr/`.

## 1. Catalog (live in Polar sandbox, org `gapmap-poc`)

Organization id: `ca2c2dda-16c7-441d-a0d2-da2c8c9426b3` (sandbox).
Presentment currency ZAR on the org and both products.

| Plan | Product id | Price id | Amount | Trial | Checkout link |
|---|---|---|---|---|---|
| Learner Monthly | `485dbfae-2af5-4c11-952e-b06e71fd5d1f` | `d344fe4e-aa67-46bf-9d4d-382f7f632b98` | R40/mo (4000c) | 30 days, card upfront | `https://sandbox-api.polar.sh/v1/checkout-links/polar_cl_eMBpOAlB2njqCe0rCSTttRxr2KXV77FQ3fZBn1VWtq0/redirect` (metadata `gapmap_plan=monthly`) |
| Learner Annual | `315eac09-0533-41fa-9780-7dbf2cbb5844` | `66013de2-0c37-412b-a86d-6b9f1cb3da4e` | **R420/yr** (42000c — R60 off 12 × R40) | 30 days, card upfront | `https://sandbox-api.polar.sh/v1/checkout-links/polar_cl_hnmIP9Jro9Ei1bF15jS0O03yHGtfx14S2RnZt38jLhq/redirect` (metadata `gapmap_plan=annual`) |

The Free Trial card reuses the Monthly link (trial is on the product).
Trial conversion reminder emails are on (Polar default). Trial-abuse
prevention is **off** in sandbox — enable it in production (dashboard toggle,
no code).

Manage via the Polar MCP sandbox server (`polar-sandbox` in `.mcp.json`):
`products_list`, `checkout_links_list`, etc. Old R480 annual price/link were
replaced, not kept — the catalog above is the whole shelf.

## 2. What to build

1. **Webhook endpoint as a Firebase Cloud Function (not `serve.mjs`).**
   `serve.mjs` stays at exactly one route (`GET /api/download`) per
   `docs/adr/0004-firebase-ai-logic.md` — do not add the webhook there.
   Subscribe to **`customer.state_changed`** only (covers
   create/update/subscription/benefit changes in one event).
   Secrets minted after 2026-09-08 follow Standard Webhooks — validate
   signatures with the Polar SDK, never trust the body raw.
2. **Join key: verified Auth email, never client-supplied `uid`.**
   Look up the Learner by the Polar customer email → Firebase Auth email →
   `uid`. `gapmap_plan` metadata is a hint only.
3. **Write `learners/{uid}/billing`** (Admin SDK bypasses rules):
   `{ status, planKey, trialEndsAt, currentPeriodEnd, polarCustomerId }`.
   `status`: `trialing | active | past_due | canceled | revoked`.
   Map Polar `trialing` → local trial display; `active` → paid;
   `past_due` → grace (gate still passes, banner warns — copy TBD);
   `canceled`/`revoked` → gate blocks at period end / immediately.
4. **`firestore.rules`**: owner-read, **no client write** on
   `learners/{uid}/billing` (read: `ownsLearner(learnerId)`; create/update/
   delete: `false`). The browser must never hold a Polar API secret and a
   Learner must never write their own billing doc.
5. **Cut over the gate**: `auth-guard.js` `getBillingStatus()` should prefer
   the billing doc (async, cached in session) and fall back to the local
   record; once live, migrate then delete `gapmap_billing:*` keys. Until
   then the interim stands (spoofable by design — accepted, documented in
   `auth-guard.js`).
6. **Manage Subscription**: point `subscription.html#manageBtn` at the Polar
   Customer Portal via customer sessions (needs the secret — server side).

## 3. Still open (needs a domain decision, not Firebase)

* `success_url` is set for **local dev** on both links:
  `http://localhost:8000/dashboard.html?checkout_id={CHECKOUT_ID}&plan=<plan>`
  (`{CHECKOUT_ID}` is Polar's placeholder, substituted per checkout).
  `handlePolarReturn()` in `dashboard.html` reads it — it runs before the
  page guard so a returning Learner isn't bounced first. Point both links
  at the public URL when one exists (dashboard edit or via MCP
  `checkout_links_update`, no code change).
* Payment ceiling: cards only (plus Apple/Google Pay where available) — no
  EFT/SnapScan/PayPal. If that blocks Learners, it needs a product decision.
* Production promotion: recreate the two products on the live org (or Polar
  migrate), update `POLAR_CHECKOUT_LINKS` in `subscription.html`, set
  `success_url`, enable trial-abuse prevention.

## 4. Test expectations

* Never require live Polar in the suite (`npm test` stays offline).
  Browser tests keep seeding the session helper (`tests/helpers/session.js`).
* Manual sandbox path: new Learner → subscription.html → Monthly link →
  sandbox card → trial starts → return with `checkout_id` → Dashboard
  (its page guard routes unfinished Setup to setup.html). Webhook delivery
  is observable in the Polar dashboard.
