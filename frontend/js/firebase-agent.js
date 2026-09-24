// Firebase AI Logic setup seam.
//
// This module deliberately does not import the Firebase SDK. The static demo
// supplies the SDK through the optional agent-config.js bootstrap, while tests
// inject fakes and never require credentials.

export const DEFAULT_AGENT_MODEL_NAMES = [
  'gemini-3.5-flash-lite'
];

export function initializeFirebaseAgentApp({
  initializeApp,
  agentConfig,
  appName = 'gapmap-agent',
} = {}) {
  if (typeof initializeApp !== 'function') {
    throw new Error('initializeApp is required to configure the agent Firebase app');
  }
  if (!agentConfig || typeof agentConfig !== 'object') {
    throw new Error('agentConfig is required to configure the agent Firebase app');
  }

  return initializeApp(agentConfig, appName);
}

export function createFirebaseAIModel({
  app,
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  modelName = DEFAULT_AGENT_MODEL_NAMES[0],
  useLimitedUseAppCheckTokens = true,
} = {}) {
  if (!app) throw new Error('The agent Firebase app is required');
  if (typeof getAI !== 'function') throw new Error('getAI is required');
  if (typeof getGenerativeModel !== 'function') {
    throw new Error('getGenerativeModel is required');
  }
  if (typeof GoogleAIBackend !== 'function') {
    throw new Error('GoogleAIBackend is required');
  }

  const ai = getAI(app, {
    backend: new GoogleAIBackend(),
    useLimitedUseAppCheckTokens,
  });

  return getGenerativeModel(ai, { model: modelName });
}

export function createFirebaseAIModels({
  app,
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  modelNames = DEFAULT_AGENT_MODEL_NAMES,
  useLimitedUseAppCheckTokens = true,
} = {}) {
  if (!Array.isArray(modelNames) || modelNames.length === 0) {
    throw new Error('At least one Firebase AI Logic model name is required');
  }

  return modelNames.map((name) => ({
    name,
    model: createFirebaseAIModel({
      app,
      getAI,
      getGenerativeModel,
      GoogleAIBackend,
      modelName: name,
      useLimitedUseAppCheckTokens,
    }),
  }));
}

export function initializeFirebaseAgent({
  initializeApp,
  agentConfig,
  appName = 'gapmap-agent',
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  modelName,
  modelNames,
  useLimitedUseAppCheckTokens = true,
} = {}) {
  const app = initializeFirebaseAgentApp({ initializeApp, agentConfig, appName });
  const models = createFirebaseAIModels({
    app,
    getAI,
    getGenerativeModel,
    GoogleAIBackend,
    modelNames: modelNames || (modelName ? [modelName] : DEFAULT_AGENT_MODEL_NAMES),
    useLimitedUseAppCheckTokens,
  });

  return { app, model: models[0].model, models };
}
