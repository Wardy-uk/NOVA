import type { RiskScorer } from './risk-scorer.js';
import { groupFlaggedByReason } from './risk-scorer.js';
import type { SettingsQueries } from '../db/settings-store.js';

// Pushes the "look at this" grouped feed to NUERO so the worst flagged tickets
// surface in Nick's NUERO Focus. NOVA is the source of truth — NUERO replaces
// its whole active set on each push, so this is safe to run repeatedly.
//
// Config (settings first, env fallback):
//   neuro_push_url   — NUERO base URL, e.g. http://100.100.28.58:3001
//   neuro_api_token  — matches NUERO's NEURO_API_TOKEN (machine auth)
export async function pushFlaggedToNeuro(
  riskScorer: RiskScorer,
  settings: SettingsQueries,
): Promise<{ pushed: number } | null> {
  const url = (settings.get('neuro_push_url') || process.env.NEURO_PUSH_URL || '').replace(/\/+$/, '');
  const token = settings.get('neuro_api_token') || process.env.NEURO_API_TOKEN || '';
  if (!url || !token) return null; // not configured — silently skip

  const pending = await riskScorer.getFlagged('pending');
  const payload = groupFlaggedByReason(pending);

  const res = await fetch(`${url}/api/nova-signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Neuro-Api-Token': token },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`NUERO push failed: HTTP ${res.status}`);
  return { pushed: payload.total };
}
