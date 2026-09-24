import { test, expect } from '@playwright/test';
import {
  createFirebaseAIModel,
  initializeFirebaseAgent,
} from '../frontend/js/firebase-agent.js';

test.describe('Firebase AI Logic setup seam', () => {
  test('initializes a named agent app and keeps it separate from app data setup', () => {
    const calls = [];
    const app = { name: 'gapmap-agent' };
    const initialized = initializeFirebaseAgent({
      agentConfig: { projectId: 'agent-project' },
      initializeApp(config, name) {
        calls.push(['initializeApp', config, name]);
        return app;
      },
      getAI(receivedApp, options) {
        calls.push(['getAI', receivedApp, options]);
        return { kind: 'ai' };
      },
      getGenerativeModel(ai, params) {
        calls.push(['getGenerativeModel', ai, params]);
        return { kind: 'model' };
      },
      GoogleAIBackend: class GoogleAIBackend {},
      modelName: 'custom-model',
    });

    expect(initialized).toEqual({
      app,
      model: { kind: 'model' },
      models: [{ name: 'custom-model', model: { kind: 'model' } }],
    });
    expect(calls[0]).toEqual(['initializeApp', { projectId: 'agent-project' }, 'gapmap-agent']);
    expect(calls[1][0]).toBe('getAI');
    expect(calls[1][1]).toBe(app);
    expect(calls[1][2].useLimitedUseAppCheckTokens).toBe(true);
    expect(calls[2]).toEqual(['getGenerativeModel', { kind: 'ai' }, { model: 'custom-model' }]);
  });

  test('configures the documented Firebase AI Logic backend directly', () => {
    let captured;
    class Backend {}
    const model = createFirebaseAIModel({
      app: { name: 'agent' },
      getAI(app, options) {
        captured = { app, options };
        return 'ai-instance';
      },
      getGenerativeModel(ai, params) {
        expect(ai).toBe('ai-instance');
        expect(params).toEqual({ model: 'custom-model' });
        return 'model-instance';
      },
      GoogleAIBackend: Backend,
      modelName: 'custom-model',
      useLimitedUseAppCheckTokens: false,
    });

    expect(model).toBe('model-instance');
    expect(captured.app.name).toBe('agent');
    expect(captured.options.backend).toBeInstanceOf(Backend);
    expect(captured.options.useLimitedUseAppCheckTokens).toBe(false);
  });
});
