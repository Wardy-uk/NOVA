import { useState, useEffect } from 'react';

export function AISettingsCard() {
  const [actionCount, setActionCount] = useState('10');
  const [provider, setProvider] = useState<'openai' | 'claude'>('openai');
  const [syncInterval, setSyncInterval] = useState('5');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Personal AI key override state
  const [personalKey, setPersonalKey] = useState('');
  const [hasPersonalKey, setHasPersonalKey] = useState(false);
  const [personalKeyMasked, setPersonalKeyMasked] = useState<string | null>(null);
  const [keySaving, setKeySaving] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  useEffect(() => {
    // Fetch global preferences
    fetch('/api/settings')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.data) {
          if (json.data.ai_action_count) setActionCount(json.data.ai_action_count);
          if (json.data.ai_provider) setProvider(json.data.ai_provider);
          if (json.data.refresh_interval_minutes) setSyncInterval(json.data.refresh_interval_minutes);
        }
      })
      .catch(() => {});

    // Fetch personal key status
    fetch('/api/settings/my/ai-key')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.data) {
          setHasPersonalKey(json.data.hasKey);
          setPersonalKeyMasked(json.data.masked);
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await Promise.all([
        fetch('/api/settings/ai_provider', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: provider }),
        }),
        fetch('/api/settings/ai_action_count', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: actionCount }),
        }),
        fetch('/api/settings/refresh_interval_minutes', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: syncInterval }),
        }),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const savePersonalKey = async () => {
    if (!personalKey.trim()) return;
    setKeySaving(true);
    setKeySaved(false);
    try {
      const res = await fetch('/api/settings/my/ai-key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: personalKey }),
      });
      const json = await res.json();
      if (json.ok) {
        setHasPersonalKey(true);
        setPersonalKeyMasked(personalKey.slice(0, 5) + '****' + personalKey.slice(-4));
        setPersonalKey('');
        setKeySaved(true);
        setTimeout(() => setKeySaved(false), 2000);
      }
    } catch {
      // silently fail
    } finally {
      setKeySaving(false);
    }
  };

  const removePersonalKey = async () => {
    try {
      const res = await fetch('/api/settings/my/ai-key', { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) {
        setHasPersonalKey(false);
        setPersonalKeyMasked(null);
        setPersonalKey('');
      }
    } catch {
      // silently fail
    }
  };

  return (
    <div className="border border-[#3a424d] rounded-lg p-5 bg-[#2f353d]">
      <div className="space-y-4">
        {/* Personal API key override */}
        <div>
          <label className="block text-xs text-neutral-400 mb-1.5">
            Personal API Key
            <span className="text-[10px] text-neutral-600 ml-1">(overrides global key set by admin)</span>
          </label>
          {hasPersonalKey ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400 font-mono">{personalKeyMasked}</span>
              <span className="text-[10px] text-green-500">Active</span>
              <button
                onClick={removePersonalKey}
                className="text-[10px] text-red-400 hover:text-red-300 transition-colors ml-1"
              >
                Remove
              </button>
            </div>
          ) : (
            <p className="text-[10px] text-neutral-600 mb-1.5">
              No personal key set — using global key from admin.
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <input
              type="password"
              value={personalKey}
              onChange={(e) => setPersonalKey(e.target.value)}
              placeholder={hasPersonalKey ? 'Enter new key to replace...' : 'sk-...'}
              className="flex-1 px-3 py-2 text-sm bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 placeholder-neutral-600 outline-none focus:border-[#5ec1ca] transition-colors"
            />
            <button
              onClick={savePersonalKey}
              disabled={keySaving || !personalKey.trim()}
              className="px-3 py-2 text-xs bg-[#5ec1ca] text-[#272C33] font-semibold rounded hover:bg-[#4ba8b0] transition-colors disabled:opacity-40"
            >
              {keySaving ? 'Saving...' : keySaved ? 'Saved' : 'Save Key'}
            </button>
          </div>
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

        <div>
          <label className="block text-xs text-neutral-400 mb-1.5">
            Default sync frequency
            <span className="text-[10px] text-neutral-600 ml-1">(fallback when per-source not set)</span>
          </label>
          <select
            value={syncInterval}
            onChange={(e) => setSyncInterval(e.target.value)}
            className="px-3 py-2 text-sm bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 outline-none focus:border-[#5ec1ca] transition-colors"
          >
            <option value="1">Every 1 minute</option>
            <option value="2">Every 2 minutes</option>
            <option value="5">Every 5 minutes</option>
            <option value="10">Every 10 minutes</option>
            <option value="15">Every 15 minutes</option>
            <option value="30">Every 30 minutes</option>
          </select>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 text-sm bg-[#5ec1ca] text-[#272C33] font-semibold rounded hover:bg-[#4ba8b0] transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Preferences'}
        </button>
      </div>
    </div>
  );
}
