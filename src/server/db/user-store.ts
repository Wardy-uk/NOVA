/**
 * File-based user store — temporary workaround for flaky in-memory SQLite.
 * Stores users in users.json in the project root.
 * Drop-in replacement for UserQueries (same method signatures).
 *
 * TODO: Replace with a proper database (PostgreSQL/MySQL) when deploying to server.
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const USERS_FILE = path.join(DATA_DIR, 'users.json');

export interface User {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  password_hash: string;
  role: string;
  auth_provider: string;
  provider_id: string | null;
  team_id: number | null;
  created_at: string;
  updated_at: string;
}

interface UsersData {
  nextId: number;
  users: User[];
}

function load(): UsersData {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf-8');
      return JSON.parse(raw) as UsersData;
    }
  } catch {
    console.error('[UserStore] Failed to read users.json, starting fresh');
  }
  return { nextId: 1, users: [] };
}

function save(data: UsersData): void {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export class FileUserQueries {
  getByUsername(username: string): User | undefined {
    return load().users.find((u) => u.username === username);
  }

  getById(id: number): User | undefined {
    return load().users.find((u) => u.id === id);
  }

  getByProviderId(provider: string, providerId: string): User | undefined {
    return load().users.find((u) => u.auth_provider === provider && u.provider_id === providerId);
  }

  getByEmail(email: string): User | undefined {
    return load().users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  }

  create(user: {
    username: string;
    display_name?: string;
    email?: string;
    password_hash: string;
    role?: string;
    auth_provider?: string;
    provider_id?: string;
  }): number {
    const data = load();
    const now = new Date().toISOString();
    const newUser: User = {
      id: data.nextId,
      username: user.username,
      display_name: user.display_name ?? null,
      email: user.email ?? null,
      password_hash: user.password_hash,
      role: user.role ?? 'viewer',
      auth_provider: user.auth_provider ?? 'local',
      provider_id: user.provider_id ?? null,
      team_id: null,
      created_at: now,
      updated_at: now,
    };
    data.users.push(newUser);
    data.nextId++;
    save(data);
    return newUser.id;
  }

  update(id: number, updates: Partial<Omit<User, 'id' | 'created_at'>>): boolean {
    const data = load();
    const idx = data.users.findIndex((u) => u.id === id);
    if (idx === -1) return false;
    const user = data.users[idx];
    for (const [key, val] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'created_at') {
        (user as unknown as Record<string, unknown>)[key] = val ?? null;
      }
    }
    user.updated_at = new Date().toISOString();
    save(data);
    return true;
  }

  count(): number {
    return load().users.length;
  }

  getAll(): Omit<User, 'password_hash'>[] {
    return load().users.map(({ password_hash: _, ...rest }) => rest);
  }

  delete(id: number): boolean {
    const data = load();
    const idx = data.users.findIndex((u) => u.id === id);
    if (idx === -1) return false;
    data.users.splice(idx, 1);
    save(data);
    return true;
  }

  /**
   * Ensure a service account exists with the given username + bcrypt hash.
   * Creates the user on first startup if missing; leaves it alone on subsequent
   * starts so an admin can rotate the password without redeploying.
   *
   * Returns true if a new user was created, false if it already existed.
   */
  ensureServiceAccount(spec: {
    username: string;
    password_hash: string;
    role: string;
    display_name?: string;
  }): boolean {
    const data = load();
    const existing = data.users.find((u) => u.username === spec.username);
    if (existing) return false;
    const now = new Date().toISOString();
    data.users.push({
      id: data.nextId,
      username: spec.username,
      display_name: spec.display_name ?? spec.username,
      email: null,
      password_hash: spec.password_hash,
      role: spec.role,
      auth_provider: 'local',
      provider_id: null,
      team_id: null,
      created_at: now,
      updated_at: now,
    });
    data.nextId++;
    save(data);
    return true;
  }
}
