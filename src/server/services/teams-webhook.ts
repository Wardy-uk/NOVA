/**
 * Teams channel posts via a Power Automate Workflows webhook.
 *
 * Replaces the O365 connector `MessageCard` that `alert-service` posted, which
 * targets an API Microsoft has RETIRED. That path had never sent anything
 * anyway: `agent_teams_webhook_url` has always been unset, so `sendTeamsNotification`
 * returned on its first line — the code existed and looked done, which is not
 * the same as working.
 *
 * Config-gated and FAIL-SOFT by contract (Q8/Q9): an unset webhook is a normal,
 * expected state, and nothing here may throw or delay the alert it decorates.
 * Alerting ships on email; Teams is an upgrade layered on top.
 */

export type TeamsPostResult =
  | { sent: true }
  | { sent: false; reason: 'not-configured' | 'wrong-url' | 'http' | 'error'; detail?: string };

export interface TeamsCardLine {
  label: string;
  value: string;
}

/**
 * Power Automate Workflows URLs live on Azure hosts. The retired connector used
 * `*.webhook.office.com`, and a card posted there will not render — so say so
 * plainly rather than posting into a void and reporting success.
 */
function looksLikeRetiredConnector(url: string): boolean {
  return /webhook\.office\.com|outlook\.office\.com\/webhook/i.test(url);
}

function buildAdaptiveCard(title: string, lines: TeamsCardLine[], severity: 'critical' | 'warning' | 'info') {
  const colour = severity === 'critical' ? 'attention' : severity === 'warning' ? 'warning' : 'default';

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        // `contentUrl: null` is required by the Workflows connector; omitting it
        // is a silent 400 on some flow templates.
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: title,
              weight: 'Bolder',
              size: 'Medium',
              color: colour,
              wrap: true,
            },
            ...(lines.length
              ? [{
                  type: 'FactSet',
                  facts: lines.map(l => ({ title: l.label, value: l.value })),
                }]
              : []),
          ],
        },
      },
    ],
  };
}

/**
 * Post a card to the configured Teams channel.
 *
 * `webhookUrl` is passed in rather than read here so the caller keeps ownership
 * of its own setting key — NOVA has several and this service should not guess
 * which one it is being used for.
 */
export async function postTeamsCard(
  webhookUrl: string | undefined | null,
  title: string,
  lines: TeamsCardLine[],
  severity: 'critical' | 'warning' | 'info' = 'info',
  timeoutMs = 8000,
): Promise<TeamsPostResult> {
  const url = String(webhookUrl || '').trim();
  if (!url) return { sent: false, reason: 'not-configured' };

  if (looksLikeRetiredConnector(url)) {
    console.warn(
      '[teams-webhook] That URL is an O365 connector (webhook.office.com), which Microsoft has retired. ' +
      'Replace it with a Power Automate "When a Teams webhook request is received" flow URL.',
    );
    return { sent: false, reason: 'wrong-url' };
  }

  // A webhook that hangs must not hold up the alert pipeline behind it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAdaptiveCard(title, lines, severity)),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.warn(`[teams-webhook] ${resp.status}: ${body.slice(0, 200)}`);
      return { sent: false, reason: 'http', detail: `${resp.status}` };
    }
    return { sent: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn('[teams-webhook] post failed:', detail);
    return { sent: false, reason: 'error', detail };
  } finally {
    clearTimeout(timer);
  }
}

/** Is the channel path configured and pointed somewhere that can work? */
export function teamsWebhookStatus(webhookUrl: string | undefined | null) {
  const url = String(webhookUrl || '').trim();
  if (!url) {
    return {
      available: false,
      reason: 'not-configured' as const,
      detail: 'agent_teams_webhook_url is unset. Create a Power Automate "When a Teams webhook request is received" flow and paste its URL — no code change needed.',
    };
  }
  if (looksLikeRetiredConnector(url)) {
    return {
      available: false,
      reason: 'wrong-url' as const,
      detail: 'That is an O365 connector URL, which Microsoft has retired. Replace it with a Power Automate Workflows URL.',
    };
  }
  return { available: true as const };
}
