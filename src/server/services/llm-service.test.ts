import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { LlmService } from './llm-service.js';

// Minimal mock for SettingsQueries
function mockSettings(overrides: Record<string, string> = {}) {
  const store: Record<string, string> = {
    anthropic_api_key: 'sk-ant-test',
    openai_api_key: 'sk-test',
    ...overrides,
  };
  return {
    get: (key: string) => store[key] ?? null,
    set: (_key: string, _value: string) => {},
    getAll: () => ({ ...store }),
    delete: (_key: string) => {},
  };
}

const TriageSchema = z.object({
  category: z.string(),
  confidence: z.number(),
});

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(() => {
    service = new LlmService(mockSettings() as any);
    service.resetCircuitBreakers();
  });

  it('should throw if no API keys are configured', async () => {
    const noKeySvc = new LlmService(mockSettings({ anthropic_api_key: '', openai_api_key: '' }) as any);
    await assert.rejects(
      () => noKeySvc.call('system', 'user', TriageSchema, { callType: 'test' }),
      /No LLM providers configured/,
    );
  });

  it('should throw with schema info when all providers fail validation', async () => {
    // This tests that the service propagates errors when structured output is invalid.
    // In a real test you'd mock the HTTP layer — this just verifies the error path.
    const badKeySvc = new LlmService(mockSettings({ anthropic_api_key: 'bad-key', openai_api_key: 'bad-key' }) as any);
    await assert.rejects(
      () => badKeySvc.call('system', 'user', TriageSchema, { callType: 'test' }),
      /All LLM providers failed/,
    );
  });

  it('should select correct default models by tier', () => {
    // Access private methods via any cast to verify config resolution
    const svc = service as any;
    const reasoning = svc.getPrimaryConfig('reasoning');
    assert.equal(reasoning.provider, 'anthropic');
    assert.ok(reasoning.model.includes('sonnet'));

    const fast = svc.getPrimaryConfig('fast');
    assert.equal(fast.provider, 'anthropic');
    assert.ok(fast.model.includes('haiku'));
  });

  it('should use settings overrides for model selection', () => {
    const customSvc = new LlmService(mockSettings({
      anthropic_api_key: 'sk-ant-test',
      llm_primary_provider: 'openai',
      llm_primary_model: 'gpt-4.1-nano',
    }) as any) as any;

    const config = customSvc.getPrimaryConfig('reasoning');
    assert.equal(config.provider, 'openai');
    assert.equal(config.model, 'gpt-4.1-nano');
  });

  it('should resolve failover config as openai by default', () => {
    const svc = service as any;
    const failover = svc.getFailoverConfig('reasoning');
    assert.equal(failover.provider, 'openai');
    assert.ok(failover.model.includes('gpt-4.1'));
  });
});
