/**
 * Azure DevOps REST client.
 * Pushes brand settings / logos as commits and creates pull requests.
 * Uses PAT (Personal Access Token) via Basic auth.
 */

export interface AzDoConfig {
  org: string;
  project: string;
  repo: string;
  pat: string;
  baseBranch?: string;
}

export interface FileChange {
  path: string;            // e.g. /acme/brand.json
  content: string;         // text content (JSON, etc.)
  contentType?: 'rawtext' | 'base64encoded';
}

export interface PushResult {
  commitId: string;
  refName: string;
}

export interface PrResult {
  pullRequestId: number;
  url: string;
  webUrl: string;
}

export class AzDoApiError extends Error {
  constructor(
    public statusCode: number,
    public statusText: string,
    public body: unknown,
  ) {
    const detail = body && typeof body === 'object'
      ? (body as any).message || JSON.stringify(body).slice(0, 300)
      : String(body).slice(0, 300);
    super(`AzDO API ${statusCode}: ${statusText} — ${detail}`);
    this.name = 'AzDoApiError';
  }
}

export class AzDoClient {
  private authHeader: string;
  private baseUrl: string;
  private baseBranch: string;

  constructor(private config: AzDoConfig) {
    this.authHeader = 'Basic ' + Buffer.from(':' + config.pat).toString('base64');
    this.baseUrl = `https://dev.azure.com/${config.org}/${config.project}/_apis/git/repositories/${config.repo}`;
    this.baseBranch = config.baseBranch || 'main';
  }

  private async request<T>(method: string, path: string, body?: unknown, apiVersion = '7.1'): Promise<T> {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${path}${separator}api-version=${apiVersion}`;

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let errorBody: unknown;
      try { errorBody = await res.json(); } catch { errorBody = await res.text().catch(() => ''); }
      throw new AzDoApiError(res.status, res.statusText, errorBody);
    }

    // Some endpoints return 204 No Content
    if (res.status === 204) return {} as T;

    return await res.json() as T;
  }

  /** Get the latest commit SHA on a branch. */
  async getLatestCommitId(branch?: string): Promise<string> {
    const ref = branch || this.baseBranch;
    const data = await this.request<{ value: Array<{ objectId: string }> }>(
      'GET',
      `/refs?filter=heads/${ref}`,
    );
    if (!data.value || data.value.length === 0) {
      throw new Error(`Branch '${ref}' not found`);
    }
    return data.value[0].objectId;
  }

  /** Test connectivity by fetching the repo info. */
  async testConnection(): Promise<{ defaultBranch: string; name: string }> {
    const data = await this.request<{ defaultBranch: string; name: string }>('GET', '');
    return {
      defaultBranch: data.defaultBranch?.replace('refs/heads/', '') || 'main',
      name: data.name,
    };
  }

  /**
   * Push files as a single commit (create or update) and optionally create a new branch.
   * Uses the Git Pushes API.
   */
  async pushCommit(opts: {
    branchName: string;
    files: FileChange[];
    commitMessage: string;
    createBranch?: boolean;
  }): Promise<PushResult> {
    const { branchName, files, commitMessage, createBranch } = opts;

    // Get the base commit to branch from (or the current tip if updating existing branch)
    let oldObjectId: string;
    if (createBranch) {
      oldObjectId = await this.getLatestCommitId(this.baseBranch);
    } else {
      oldObjectId = await this.getLatestCommitId(branchName);
    }

    const changes = files.map(f => ({
      changeType: 'add',  // 'add' creates or overwrites
      item: { path: f.path },
      newContent: {
        content: f.content,
        contentType: f.contentType || 'rawtext',
      },
    }));

    const pushBody = {
      refUpdates: [{
        name: `refs/heads/${branchName}`,
        oldObjectId: createBranch ? '0000000000000000000000000000000000000000' : oldObjectId,
      }],
      commits: [{
        comment: commitMessage,
        changes,
      }],
    };

    const data = await this.request<{ commits: Array<{ commitId: string }>; refUpdates: Array<{ name: string }> }>(
      'POST',
      '/pushes',
      pushBody,
    );

    return {
      commitId: data.commits?.[0]?.commitId || '',
      refName: data.refUpdates?.[0]?.name || `refs/heads/${branchName}`,
    };
  }

  /** Create a pull request. */
  async createPullRequest(opts: {
    sourceBranch: string;
    targetBranch?: string;
    title: string;
    description: string;
  }): Promise<PrResult> {
    const { sourceBranch, title, description } = opts;
    const targetBranch = opts.targetBranch || this.baseBranch;

    const data = await this.request<{
      pullRequestId: number;
      url: string;
      repository: { webUrl: string };
    }>('POST', '/pullrequests', {
      sourceRefName: `refs/heads/${sourceBranch}`,
      targetRefName: `refs/heads/${targetBranch}`,
      title,
      description,
    });

    const webUrl = `https://dev.azure.com/${this.config.org}/${this.config.project}/_git/${this.config.repo}/pullrequest/${data.pullRequestId}`;

    return {
      pullRequestId: data.pullRequestId,
      url: data.url,
      webUrl,
    };
  }

  /**
   * High-level: push brand settings files to a new branch and create a PR.
   */
  async pushBrandSettingsAndCreatePR(deliveryRef: string, files: FileChange[]): Promise<{
    branchName: string;
    prUrl: string;
    prId: number;
    commitId: string;
  }> {
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const branchName = `setup/${deliveryRef.toLowerCase()}-${timestamp}`;
    const commitMessage = `[N.O.V.A] Brand settings for ${deliveryRef}`;

    // Push commit with new branch
    const push = await this.pushCommit({
      branchName,
      files,
      commitMessage,
      createBranch: true,
    });

    // Create PR
    const pr = await this.createPullRequest({
      sourceBranch: branchName,
      title: `Brand settings: ${deliveryRef}`,
      description: `Automated brand settings push from N.O.V.A for delivery ${deliveryRef}.\n\nFiles:\n${files.map(f => `- ${f.path}`).join('\n')}`,
    });

    return {
      branchName,
      prUrl: pr.webUrl,
      prId: pr.pullRequestId,
      commitId: push.commitId,
    };
  }
}
