# Iteration 30 — Confluence Credential Compatibility Hardening

**Status:** Ready for evaluation

## What Changed

### 1. Credential fallback chains extended to use `jira_*` settings

All four Confluence-consuming services now fall back to the working `jira_url`, `jira_username`, and `jira_token` settings when dedicated Confluence settings are absent:

| File | URL fallback added | Email fallback added | Token fallback added |
|------|--------------------|----------------------|----------------------|
| `kb-confluence-sync.ts` | `jira_url` | _(already had `jira_username`)_ | _(already had `jira_token`)_ |
| `portal-kb.ts` | `jira_url` | `jira_username` | `jira_token` |
| `portal-chat.ts` | `jira_url` | `jira_username` | `jira_token` |
| `reasoner.ts` | `jira_url` | `jira_username` | `jira_token` |

### 2. Confluence REST URL construction normalised

Portal-kb and portal-chat were building URLs as `{base}/rest/api/content/...`, missing the required `/wiki` path segment for Atlassian Cloud. Reasoner and kb-confluence-sync already had it correct.

**Before:** Two services used `/rest/api/content/...`, two used `/wiki/rest/api/content/...`
**After:** All four consistently use `/wiki/rest/api/content/...`

All base URLs now strip trailing `/wiki` before path construction (`url.replace(/\/wiki\/?$/, '').replace(/\/$/, '')`) to prevent double `/wiki/wiki/` if `confluence_site_url` was set with a `/wiki` suffix.

### 3. Preserved from Iteration 29

- Portal-kb structural retrieval (child-page + full-space CQL)
- Reasoner merged space key logic
- kb-confluence-sync V2 API usage

## Files Modified

- `src/server/services/kb-confluence-sync.ts` — URL fallback + `/wiki` normalisation in `getAuth()`
- `src/server/services/portal-kb.ts` — full credential chain + `/wiki` prefix on REST paths
- `src/server/services/portal-chat.ts` — full credential chain + `/wiki` prefix + URL normalisation
- `src/server/services/reasoner.ts` — credential chain widened + URL normalisation

## Verification

- TypeScript compiles cleanly (`tsc --noEmit` passes)
- No unrelated code touched
- All Confluence REST URL sites confirmed consistent via grep

## Blockers / Uncertainties

- Actual runtime validation requires the `jira_url` setting to point to the Atlassian Cloud site (e.g. `https://nurtur.atlassian.net`). If this value is present and correct, all four services should now reach Confluence using Jira credentials.
- The `kb_confluence_space_keys` or `kb_confluence_space` setting still needs to be configured to target the correct space(s).
