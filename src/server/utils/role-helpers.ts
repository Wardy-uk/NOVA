/** Parse a comma-separated role string into an array of role IDs. */
export function parseRoles(roleStr: string): string[] {
  return roleStr.split(',').map(r => r.trim()).filter(Boolean);
}

/** Check if a comma-separated role string contains a specific role. */
export function hasRole(roleStr: string, target: string): boolean {
  return parseRoles(roleStr).includes(target);
}

/** Check if a comma-separated role string includes admin. */
export function isAdmin(roleStr: string): boolean {
  return hasRole(roleStr, 'admin');
}
