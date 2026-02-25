/**
 * File-based user store — temporary workaround for flaky in-memory SQLite.
 * Stores users in users.json in the project root.
 * Drop-in replacement for UserQueries (same method signatures).
 *
 * TODO: Replace with a proper database (PostgreSQL/MySQL) when deploying to server.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../../');
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
}
