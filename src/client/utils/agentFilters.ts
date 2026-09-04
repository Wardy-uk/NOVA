// Shared rules for which agents belong on a human-facing board.
//
// NOVA AI is a synthetic agent. It resolves round the clock and always tops any
// solve-based ranking, which makes the human positions hard to read and the team
// averages meaningless. Every board excludes it by default; leaderboards offer a
// toggle that shows it UNRANKED, so it can be compared against without moving
// anyone else's position.

export const NOVA_AI_AGENT_NAME = 'NOVA AI';

/** Matches the synthetic agent by display name, tolerating spacing/case drift. */
export function isNovaAi(agentName: string | null | undefined): boolean {
  return (agentName ?? '').trim().toLowerCase() === NOVA_AI_AGENT_NAME.toLowerCase();
}
