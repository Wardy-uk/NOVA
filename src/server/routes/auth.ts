import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { UserQueries } from '../db/queries.js';
import { authMiddleware, type AuthPayload } from '../middleware/auth.js';

function signToken(user: { id: number; username: string; role: string }, secret: string): string {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, secret, { expiresIn: '7d' });
}

function safeUser(u: { id: number; username: string; display_name: string | null; email: string | null; role: string; auth_provider: string }) {
  return { id: u.id, username: u.username, display_name: u.display_name, email: u.email, role: u.role, auth_provider: u.auth_provider };
}

export function createAuthRoutes(userQueries: UserQueries, jwtSecret: string): Router {
  const router = Router();

  // POST /api/auth/login
  router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username?.trim() || !password) {
      res.status(400).json({ ok: false, error: 'Username and password are required' });
      return;
    }

    const user = userQueries.getByUsername(username.trim().toLowerCase());
    if (!user) {
      res.status(401).json({ ok: false, error: 'Invalid username or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ ok: false, error: 'Invalid username or password' });
      return;
    }

    const token = signToken(user, jwtSecret);
    res.json({ ok: true, data: { token, user: safeUser(user) } });
  });

  // POST /api/auth/register — only allowed if no users exist (first user setup) or caller is admin
  router.post('/register', async (req, res) => {
    const { username, password, display_name, email } = req.body;
    if (!username?.trim() || !password) {
      res.status(400).json({ ok: false, error: 'Username and password are required' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
      return;
    }

    const userCount = userQueries.count();

    // If users already exist, only admin can create new users
    if (userCount > 0) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(403).json({ ok: false, error: 'Registration is restricted. Contact an admin.' });
        return;
      }
      try {
        const payload = jwt.verify(authHeader.slice(7), jwtSecret) as AuthPayload;
        if (payload.role !== 'admin') {
          res.status(403).json({ ok: false, error: 'Only admins can create new users' });
          return;
        }
      } catch {
        res.status(403).json({ ok: false, error: 'Invalid token' });
        return;
      }
    }

    const normalizedUsername = username.trim().toLowerCase();
    if (userQueries.getByUsername(normalizedUsername)) {
      res.status(409).json({ ok: false, error: 'Username already taken' });
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    const role = userCount === 0 ? 'admin' : 'user'; // First user is admin
    const id = userQueries.create({
      username: normalizedUsername,
      display_name: display_name?.trim() || normalizedUsername,
      email: email?.trim() || undefined,
      password_hash: hash,
      role,
    });

    const user = userQueries.getById(id)!;
    const token = signToken(user, jwtSecret);
    res.json({ ok: true, data: { token, user: safeUser(user), firstUser: userCount === 0 } });
  });

  // GET /api/auth/me — requires valid token
  router.get('/me', authMiddleware(jwtSecret), (req, res) => {
    const user = userQueries.getById(req.user!.id);
    if (!user) {
      res.status(401).json({ ok: false, error: 'User not found' });
      return;
    }
    res.json({ ok: true, data: { user: safeUser(user) } });
  });

  return router;
}
