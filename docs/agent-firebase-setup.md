# Live Firebase AI Logic setup

The Learning Companion is **live by default**: every page attempts live
inference through Firebase AI Logic. The key-free demo and test path opts out
per session with `?agent=off` (sticky in sessionStorage, so the whole demo
flow stays key-free once opted out). Use the port your static server is
actually using (the default is `8000`):

```text
http://localhost:<PORT>/?agent=off
```

The live bootstrap is `agent-config.js`. It uses Firebase Web SDK `12.17.1`
from the official CDN because this repository intentionally remains a static
site with no browser bundler. The same version is pinned in `package.json` for
tooling and future bundling. Live inference uses the stable model pool from
`frontend/js/agent-runtime-config.js`, currently `gemini-3.5-flash-lite` alone
(chosen for its higher rate limits under concurrent Learners): transient
capacity failures are retried with backoff, then the next pool entry
is tried, and if the pool is exhausted the error is surfaced in the panel (no
fabricated reply).

## One-time project setup

The agent project is `gapmap-63650`.

1. In the Firebase console, open **AI Services → AI Logic** for
   `gapmap-63650` and click **Get started**.
2. Select the **Gemini Developer API** provider for the current setup.
3. Confirm that **Firebase AI Logic API** and **Gemini Developer API** are
   enabled. Firebase's guided workflow enables the required APIs and provisions
   the managed service account.
4. For the current shared-development setup, leave **Security → App Check →
   APIs → Firebase AI Logic** unenforced and keep replay protection disabled.
   The client-side App Check setup is commented out in `agent-config.js`, so
   teammates do not need Firebase access or debug tokens.

The production App Check path remains commented in `agent-config.js` and can be
restored before enforcement is required.

## Shared-development setup

No App Check debug token is required for the current setup.

1. Start the site:

   ```bash
   npm start
   ```

2. Open `http://localhost:<PORT>/` — the Companion is live by default.
3. The live request is sent without an App Check header.
4. Teammates only need the repository and network access; they do not need
   access to the Firebase Console project.
5. To run the key-free demo or tests, open
   `http://localhost:<PORT>/?agent=off` (the opt-out is sticky for the
   session, so navigating the demo flow stays key-free).

## Browser-free live smoke check

Run the real endpoint smoke check without a browser:

```bash
npm run smoke:agent
```

The command calls the live model pool directly and exits nonzero if Firebase AI
Logic, model capacity, or response parsing fails. It does not use the local
Companion path.

If App Check is temporarily re-enabled for a staging/production check, a
registered debug token can be supplied without committing it:

```bash
FIREBASE_APPCHECK_DEBUG_TOKEN='registered-debug-token' npm run smoke:agent
```

## Re-enabling App Check later

Restore the commented App Check import/initialization in `agent-config.js`,
set `useLimitedUseAppCheckTokens: true`, enforce Firebase AI Logic App Check,
and register either production attestation or per-browser localhost debug
tokens as described in the Firebase documentation.

## Production setup

For a non-localhost origin, provide a reCAPTCHA Enterprise site key before
loading the live bootstrap:

```html
<script>
  globalThis.GAPMAP_RECAPTCHA_SITE_KEY = 'RECAPTCHA_ENTERPRISE_SITE_KEY';
</script>
<script type="module" src="agent-config.js"></script>
```

Register the production web app with App Check, use the reCAPTCHA Enterprise
provider, and enable replay protection once clients use limited-use tokens.
Never use the debug provider in a production build.

## App-project identity

The agent project does not own Learner Auth. The app project remains the source
of identity. If the app config exposes `getCurrentUser()` or `auth.currentUser`,
the panel uses that uid as `learnerId`. The app team can additionally expose
`globalThis.gapmapLearnerContext` to supply project-A preferences, Gap Map, and
Learning Path data; the agent receives those values only as prompt context.

## Troubleshooting

- **403 mentioning `firebaseappcheck.googleapis.com`:** App Check is still
  enforced in the Firebase project, or the production code path was restored
  without completing App Check registration.
- **`GAPMAP_RECAPTCHA_SITE_KEY is required`:** the commented production App
  Check path was restored without supplying its production site key.
- **A live error appears:** inspect the browser console, the Companion Activity
  log, or run `npm run smoke:agent`. The panel intentionally surfaces the
  provider/setup failure; it does not substitute a fabricated response.
