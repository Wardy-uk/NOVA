export function JiraNotConnected() {
  return (
    <div className="mx-5 mb-3 px-3 py-3 bg-red-950/30 border border-red-900/40 rounded-lg">
      <div className="text-xs text-red-400 font-medium mb-1">Jira account not connected</div>
      <div className="text-[11px] text-red-400/70 mb-2">
        You need to connect your Jira account before taking actions. Go to My Settings → Jira Account.
      </div>
      <button
        onClick={() => {
          window.location.hash = 'focus';
          setTimeout(() => document.querySelector<HTMLButtonElement>('[data-settings-tab="jira"]')?.click(), 200);
        }}
        className="px-3 py-1 text-[11px] bg-red-900/40 text-red-300 rounded hover:bg-red-900/60 transition-colors"
      >
        Open Jira Settings
      </button>
    </div>
  );
}

export function isJiraNotConnected(error: string | null, code?: string): boolean {
  return code === 'JIRA_NOT_CONNECTED' || (error?.includes('Jira account not connected') ?? false);
}
