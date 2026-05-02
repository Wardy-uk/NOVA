export const CHINESE_TO_ENGLISH: Record<string, string> = {
  '打开': 'Open',
  '待办': 'To Do',
  '正在进行': 'In Progress',
  '已解决': 'Resolved',
  '完成': 'Done',
  '已拒绝': 'Rejected',
  '已关闭': 'Closed',
  '已重新打开': 'Reopened',
  '已取消': 'Cancelled',
  '等待客户': 'Waiting for Customer',
  '等待支持': 'Waiting for Support',
  '无类别': 'No Category',
};

export function normalizeJiraStatus(value: string): string {
  return CHINESE_TO_ENGLISH[value] ?? value;
}

export function normalizeStatusFields(issue: any): void {
  const status = issue?.fields?.status;
  if (!status) return;
  if (status.name && CHINESE_TO_ENGLISH[status.name]) {
    status.name = CHINESE_TO_ENGLISH[status.name];
  }
  const cat = status.statusCategory;
  if (cat?.name && CHINESE_TO_ENGLISH[cat.name]) {
    cat.name = CHINESE_TO_ENGLISH[cat.name];
  }
}

console.log(`[JiraLocale] Loaded ${Object.keys(CHINESE_TO_ENGLISH).length} translations`);
