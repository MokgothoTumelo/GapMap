// Live Firebase AI Logic bootstrap for the agent project.
//
// The panel loads this module by default — the Learning Companion is live
// unless the session opted out with `?agent=off` (sticky in sessionStorage),
// so the key-free demo and test path stays key-free without touching this
// module. Firebase's official CDN ESM modules are used here because this
// repository intentionally has no browser bundler. The matching npm package
// is pinned in package.json for the project/tooling contract.
import { initializeFirebaseAgent } from './frontend/js/firebase-agent.js';
import {
  AGENT_MODEL_NAMES,
  FIREBASE_SDK_VERSION,
  agentFirebaseConfig,
} from './frontend/js/agent-runtime-config.js';

const [
  { initializeApp },
  {
    getAI,
    getGenerativeModel,
    GoogleAIBackend,
  },
] = await Promise.all([
  import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
  import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-ai.js`),
]);

/*
  App Check is intentionally disabled for the current shared development
  setup. Keep this block for the production/staging re-enable before the
  Firebase AI Logic enforcement deadline.

  const {
    initializeAppCheck,
    CustomProvider,
    ReCaptchaEnterpriseProvider,
  } = await import(
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-check.js`
  );
*/

const agentApp = initializeApp(agentFirebaseConfig, 'gapmap-agent');

/*
  App Check is intentionally disabled for the current shared development
  setup. To re-enable it, restore the imports above and this block, then set
  the Firebase Console enforcement and replay-protection settings.

  const hostname = globalThis.location?.hostname || '';
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  const useDebugAppCheck =
    isLocalhost || globalThis.GAPMAP_FIREBASE_APPCHECK_DEBUG === true;
  const recaptchaSiteKey = globalThis.GAPMAP_RECAPTCHA_SITE_KEY;

  if (!useDebugAppCheck && !recaptchaSiteKey) {
    throw new Error(
      'GAPMAP_RECAPTCHA_SITE_KEY is required for live Firebase AI Logic outside localhost',
    );
  }

  if (useDebugAppCheck && globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN === undefined) {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  const appCheckProvider = useDebugAppCheck
    ? new CustomProvider({ getToken: async () => ({ token: '' }) })
    : new ReCaptchaEnterpriseProvider(recaptchaSiteKey);

  const appCheck = initializeAppCheck(agentApp, {
    provider: appCheckProvider,
    isTokenAutoRefreshEnabled: true,
  });
*/

const { model: agentModel, models: agentModels } = initializeFirebaseAgent({
  initializeApp: (_config, _name) => agentApp,
  agentConfig: agentFirebaseConfig,
  appName: 'gapmap-agent',
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  modelNames: AGENT_MODEL_NAMES,
  // App Check is disabled for shared development. Restore true with the
  // commented setup above when production enforcement is enabled.
  useLimitedUseAppCheckTokens: false,
});

globalThis.gapmapAgentModel = agentModel;
globalThis.gapmapAgentModels = agentModels;
globalThis.gapmapAgentApp = agentApp;
// globalThis.gapmapAgentAppCheck = appCheck;

export { agentApp, agentModel };
