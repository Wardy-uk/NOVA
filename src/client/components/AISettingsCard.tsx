import { useState, useEffect } from 'react';

export function AISettingsCard() {
  const [apiKey, setApiKey] = useState('');
  const [actionCount, setActionCount] = useState('10');
  const [provider, setProvider] = useState<'openai' | 'claude'>('openai');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.data) {
          if (json.data.openai_api_key) setApiKey(json.data.openai_api_key);
          if (json.data.ai_action_count) setActionCount(json.data.ai_action_count);
          if (json.data.ai_provider) setProvider(json.data.ai_provider);
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const requests: Promise<Response>[] = [];
      if (apiKey.trim()) {
        requests.push(fetch('/api/settings/openai_api_key', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: apiKey }),
        }));
      }
      requests.push(fetch('/api/settings/ai_provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: provider }),
      }));
      requests.push(fetch('/api/settings/ai_action_count', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: actionCount }),
      }));
      await Promise.all(requests);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-[#3a424d] rounded-lg p-5 bg-[#2f353d]">
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-neutral-400 mb-1.5">OpenAI API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-2 text-sm bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 placeholder-neutral-600 outline-none focus:border-[#5ec1ca] transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs text-neutral-400 mb-1.5">
            AI Provider
          </label>
          <div className="flex items-center gap-3 text-sm text-neutral-300">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="ai-provider"
                value="openai"
                checked={provider === 'openai'}
                onChange={() => setProvider('openai')}
                className="accent-[#5ec1ca]"
              />
              ChatGPT (OpenAI)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="ai-provider"
                value="claude"
                checked={provider === 'claude'}
                onChange={() => setProvider('claude')}
                className="accent-[#5ec1ca]"
              />
              Claude (Anthropic)
            </label>
          </div>
        </div>

        <div>
          <label className="block text-xs text-neutral-400 mb-1.5">
            Number of suggestions
          </label>
          <select
            value={actionCount}
            onChange={(e) => setActionCount(e.target.value)}
            className="px-3 py-2 text-sm bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 outline-none focus:border-[#5ec1ca] transition-colors"
          >
            <option value="3">3</option>
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="20">20</option>
          </select>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 text-sm bg-[#5ec1ca] text-[#272C33] font-semibold rounded hover:bg-[#4ba8b0] transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
}
