import { JiraRestClient } from './jira-client.js';
import type { JiraOAuthService } from './jira-oauth.js';
import type { UserSettingsQueries } from '../db/queries.js';

export class JiraUserClientFactory {
  constructor(
    private userSettingsQueries: UserSettingsQueries,
    private jiraOAuthService: JiraOAuthService | null,
  ) {}

  async getClientForUser(userId: number): Promise<JiraRestClient | null> {
    const cloudId = await this.userSettingsQueries.get(userId, 'jira_cloud_id');
    const accessToken = await this.userSettingsQueries.get(userId, 'jira_access_token');
    const refreshToken = await this.userSettingsQueries.get(userId, 'jira_refresh_token');

    if (cloudId && accessToken && this.jiraOAuthService) {
      const client = new JiraRestClient({ cloudId, accessToken });
      return this.ensureTokenValid(client, userId, cloudId, refreshToken);
    }

    const userEnabled = await this.userSettingsQueries.get(userId, 'jira_enabled');
    const userUrl = await this.userSettingsQueries.get(userId, 'jira_url');
    const userEmail = await this.userSettingsQueries.get(userId, 'jira_username');
    const userToken = await this.userSettingsQueries.get(userId, 'jira_token');
    if (userEnabled === 'true' && userUrl && userEmail && userToken) {
      return new JiraRestClient({ baseUrl: userUrl, email: userEmail, apiToken: userToken });
    }

    return null;
  }

  private async ensureTokenValid(
    client: JiraRestClient,
    userId: number,
    cloudId: string,
    refreshToken: string | null,
  ): Promise<JiraRestClient | null> {
    if (!refreshToken || !this.jiraOAuthService) return client;

    try {
      await client.getMyself();
      return client;
    } catch (err: any) {
      if (err?.statusCode !== 401 && !err?.message?.includes('401')) throw err;

      console.log(`[jira-user-client] Token expired for user ${userId}, refreshing...`);
      try {
        const newTokens = await this.jiraOAuthService.refreshToken(refreshToken);
        await this.userSettingsQueries.set(userId, 'jira_access_token', newTokens.accessToken);
        await this.userSettingsQueries.set(userId, 'jira_refresh_token', newTokens.refreshToken);
        return new JiraRestClient({ cloudId, accessToken: newTokens.accessToken });
      } catch (refreshErr) {
        console.error(`[jira-user-client] Token refresh failed for user ${userId}:`, refreshErr);
        await this.userSettingsQueries.delete(userId, 'jira_access_token');
        await this.userSettingsQueries.delete(userId, 'jira_refresh_token');
        return null;
      }
    }
  }

  async isConnected(userId: number): Promise<boolean> {
    const accessToken = await this.userSettingsQueries.get(userId, 'jira_access_token');
    if (accessToken) return true;
    const enabled = await this.userSettingsQueries.get(userId, 'jira_enabled');
    const token = await this.userSettingsQueries.get(userId, 'jira_token');
    return enabled === 'true' && !!token;
  }
}
