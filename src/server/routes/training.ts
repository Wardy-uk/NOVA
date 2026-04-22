import { Router, type Request, type Response } from 'express';
import type { TrainingQueries } from '../db/queries.js';
import type { UserQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { isAdmin } from '../utils/role-helpers.js';
import type { AreaAccessGuard } from '../middleware/auth.js';
import { sendTrainingReminders } from '../services/training-reminder.js';

export function createTrainingRoutes(
  trainingQueries: TrainingQueries,
  userQueries: UserQueries,
  requireAreaAccess: AreaAccessGuard,
  settingsQueries?: SettingsQueries,
): Router {
  const router = Router();

  // All training routes require at least view access
  router.use(requireAreaAccess('training', 'view'));

  // ── Categories ──

  router.get('/categories', async (_req: Request, res: Response) => {
    const categories = await trainingQueries.getCategories();
    res.json({ ok: true, data: categories });
  });

  router.post('/categories', async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    const { name, sort_order } = req.body;
    if (!name) { res.status(400).json({ ok: false, error: 'Name required' }); return; }
    const id = await trainingQueries.createCategory(name, sort_order ?? 0);
    res.json({ ok: true, data: { id } });
  });

  router.put('/categories/:id', async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    const { name, sort_order } = req.body;
    await trainingQueries.updateCategory(Number(req.params.id), name, sort_order ?? 0);
    res.json({ ok: true });
  });

  router.delete('/categories/:id', async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    await trainingQueries.deleteCategory(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Items ──

  router.get('/items', async (req: Request, res: Response) => {
    const categoryId = req.query.category ? Number(req.query.category) : undefined;
    const items = await trainingQueries.getItems(categoryId);
    res.json({ ok: true, data: items });
  });

  router.post('/items', async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    const { category_id, section, name, tech_lead, max_score, sort_order } = req.body;
    if (!category_id || !name) { res.status(400).json({ ok: false, error: 'category_id and name required' }); return; }
    const id = await trainingQueries.createItem({
      category_id, section: section ?? '', name,
      tech_lead: tech_lead ?? null, max_score: max_score ?? 5, sort_order: sort_order ?? 0,
    });
    res.json({ ok: true, data: { id } });
  });

  router.put('/items/:id', async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    await trainingQueries.updateItem(Number(req.params.id), req.body);
    res.json({ ok: true });
  });

  router.delete('/items/:id', async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    await trainingQueries.deleteItem(Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Scores ──

  router.get('/scores', async (req: Request, res: Response) => {
    const categoryId = req.query.category ? Number(req.query.category) : undefined;
    const userId = req.query.user ? Number(req.query.user) : undefined;
    const scores = await trainingQueries.getScores(categoryId, userId);
    res.json({ ok: true, data: scores });
  });

  router.put('/scores', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const { scores } = req.body as { scores: Array<{ item_id: number; user_id: number; score: number }> };
    if (!scores?.length) { res.status(400).json({ ok: false, error: 'scores array required' }); return; }

    const admin = isAdmin(req.user.role);
    // Non-admins can only edit their own scores
    if (!admin) {
      const hasOtherUsers = scores.some(s => s.user_id !== req.user!.id);
      if (hasOtherUsers) {
        res.status(403).json({ ok: false, error: 'You can only edit your own scores' });
        return;
      }
    }

    await trainingQueries.bulkUpsertScores(scores);
    res.json({ ok: true });
  });

  // ── Users (people in the matrix) ──

  router.get('/users', async (_req: Request, res: Response) => {
    // Only return users who are training members (imported from spreadsheet)
    const memberIds = await trainingQueries.getMembers();
    if (memberIds.length === 0) {
      // No members table yet — fall back to all users
      const allUsers = await userQueries.getAll();
      res.json({ ok: true, data: allUsers.map(u => ({ id: u.id, username: u.username, display_name: u.display_name })) });
      return;
    }
    const memberSet = new Set(memberIds);
    const allUsers = await userQueries.getAll();
    // Preserve the sort order from training_members
    const users = memberIds
      .map(id => allUsers.find(u => u.id === id))
      .filter(Boolean)
      .map(u => ({ id: u!.id, username: u!.username, display_name: u!.display_name }));
    res.json({ ok: true, data: users });
  });

  // ── XLSX import (client uploads parsed sheet data) ──
  // Body: { sheets: Array<{ name: string, rows: any[][] }> }
  // Each sheet becomes a category. Row 0 = headers. Section headers detected automatically.

  // Spreadsheet column name → display name / username fuzzy matching
  const COLUMN_ALIASES: Record<string, string[]> = {
    'Hiedi': ['Heidi Power', 'heidi'],
    'Willem': ['Willem Kruger', 'willem'],
    'Willem Kruger': ['Willem', 'willem'],
    'Stephen': ['Stephen Mitchell', 'stephen'],
    'Naomi': ['Naomi Wentworth', 'naomi'],
    'Zoe': ['Zoe Rees', 'zoe'],
    'Hope': ['Hope Goodall', 'hope'],
    'Arman': ['Arman Shazad', 'arman'],
    'Abdi': ['Abdi Mohamed', 'abdi'],
    'Luke': ['Luke Scaife', 'luke'],
    'Seb': ['Sebastian Broome', 'seb'],
    'Nick Ward': ['Nick W', 'nickw'],
    'Nathan Rutland': ['Nathan Rutland', 'nathan'],
    'Kayleigh Russell': ['Kayleigh Russell', 'kayleigh'],
    'Isabel Busk': ['Isabel Busk', 'isabel'],
  };

  function matchUser(colName: string, allUsers: Array<{ id: number; username: string; display_name: string | null }>): number | null {
    const norm = colName.trim().toLowerCase();
    // Direct match on display_name or username
    for (const u of allUsers) {
      if ((u.display_name || '').toLowerCase() === norm) return u.id;
      if (u.username.toLowerCase() === norm) return u.id;
    }
    // First-name match
    const firstName = norm.split(' ')[0];
    for (const u of allUsers) {
      if (u.username.toLowerCase() === firstName) return u.id;
      if ((u.display_name || '').toLowerCase().startsWith(firstName + ' ')) return u.id;
      if ((u.display_name || '').toLowerCase() === firstName) return u.id;
    }
    // Alias match
    const aliases = COLUMN_ALIASES[colName.trim()];
    if (aliases) {
      for (const alias of aliases) {
        const a = alias.toLowerCase();
        for (const u of allUsers) {
          if ((u.display_name || '').toLowerCase() === a) return u.id;
          if (u.username.toLowerCase() === a) return u.id;
          if ((u.display_name || '').toLowerCase().startsWith(a)) return u.id;
        }
      }
    }
    return null;
  }

  router.post('/import-xlsx', async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }

    const { sheets } = req.body as { sheets: Array<{ name: string; rows: unknown[][] }> };
    if (!sheets?.length) {
      res.status(400).json({ ok: false, error: 'No sheet data provided' });
      return;
    }

    const allUsers = await userQueries.getAll();
    const skipCols = new Set(['Knowledge Item', 'Total', 'Team Total Score', 'Tech Lead', 'Udemy', '']);

    // Clear existing data
    await trainingQueries.deleteAllData();

    let totalCategories = 0, totalItems = 0, totalScores = 0;
    const unmatchedColumns: string[] = [];
    const matchedUserIds = new Set<number>();

    for (let catIdx = 0; catIdx < sheets.length; catIdx++) {
      const sheet = sheets[catIdx];
      if (!sheet.rows || sheet.rows.length < 2) continue;

      // Create category
      const catId = await trainingQueries.createCategory(sheet.name, catIdx);
      totalCategories++;

      // Parse headers — find person columns
      const headers = sheet.rows[0].map(h => String(h ?? '').trim());
      const techLeadCol = headers.findIndex(h => h === 'Tech Lead');
      const personCols: Array<{ colIdx: number; userId: number; name: string }> = [];

      for (let c = 0; c < headers.length; c++) {
        const h = headers[c];
        if (!h || skipCols.has(h)) continue;
        const uid = matchUser(h, allUsers);
        if (uid != null) {
          personCols.push({ colIdx: c, userId: uid, name: h });
          matchedUserIds.add(uid);
        } else if (!unmatchedColumns.includes(h)) {
          unmatchedColumns.push(h);
        }
      }

      // Parse rows
      let currentSection = '';
      let sortOrder = 0;

      for (let r = 1; r < sheet.rows.length; r++) {
        const row = sheet.rows[r];
        const raw = String(row[0] ?? '').trim();
        if (!raw || /^\d+(\.\d+)?$/.test(raw)) continue;

        const allEmpty = personCols.every(p => {
          const v = row[p.colIdx];
          return v === '' || v === undefined || v === null;
        });

        // Detect section headers
        const endsWithColon = raw.endsWith(':');
        const totalColIdx = headers.indexOf('Total') >= 0 ? headers.indexOf('Total') :
          headers.indexOf('Team Total Score') >= 0 ? headers.indexOf('Team Total Score') : 1;
        const totalVal = row[totalColIdx];

        if (allEmpty && (endsWithColon || totalVal === '' || totalVal === undefined || totalVal === null || totalVal === 0)) {
          currentSection = raw.replace(/:$/, '').trim();
          continue;
        }

        const cleanName = raw.replace(/:$/, '').trim();
        if (!cleanName) continue;

        const techLead = techLeadCol >= 0 ? String(row[techLeadCol] ?? '').trim() || null : null;

        const itemId = await trainingQueries.createItem({
          category_id: catId, section: currentSection, name: cleanName,
          tech_lead: techLead, max_score: 5, sort_order: sortOrder++,
        });
        totalItems++;

        // Insert scores
        const scoreBatch: Array<{ item_id: number; user_id: number; score: number }> = [];
        for (const pc of personCols) {
          const rawScore = row[pc.colIdx];
          if (rawScore === '' || rawScore === undefined || rawScore === null) continue;
          const score = Number(rawScore);
          if (!Number.isFinite(score) || score < 0) continue;
          scoreBatch.push({ item_id: itemId, user_id: pc.userId, score: Math.min(score, 5) });
        }
        if (scoreBatch.length > 0) {
          await trainingQueries.bulkUpsertScores(scoreBatch);
          totalScores += scoreBatch.length;
        }
      }
    }

    // Save matched users as training members (preserving spreadsheet column order)
    let memberOrder = 0;
    for (const uid of matchedUserIds) {
      await trainingQueries.addMember(uid, memberOrder++);
    }

    res.json({
      ok: true,
      data: { categories: totalCategories, items: totalItems, scores: totalScores, members: matchedUserIds.size, unmatchedColumns },
    });
  });

  // ── Summary stats ──

  router.get('/summary', async (_req: Request, res: Response) => {
    const categories = await trainingQueries.getCategories();
    const items = await trainingQueries.getItems();
    const scores = await trainingQueries.getScores();
    const allUsers = await userQueries.getAll();

    // Only include training members (from spreadsheet import)
    const memberIds = await trainingQueries.getMembers();
    const memberSet = memberIds.length > 0 ? new Set(memberIds) : null;
    const activeUsers = memberSet ? allUsers.filter(u => memberSet.has(u.id)) : allUsers;

    // Per-user, per-category stats
    const summary = activeUsers.map(u => {
      const userScores = scores.filter(s => s.user_id === u.id);
      const categoryStats = categories.map(cat => {
        const catItems = items.filter(i => i.category_id === cat.id);
        const catScores = userScores.filter(s => catItems.some(i => i.id === s.item_id));
        const totalPossible = catItems.reduce((sum, i) => sum + i.max_score, 0);
        const totalScored = catScores.reduce((sum, s) => sum + s.score, 0);
        return {
          category_id: cat.id,
          category_name: cat.name,
          items_count: catItems.length,
          scored_count: catScores.filter(s => s.score > 0).length,
          total_possible: totalPossible,
          total_scored: totalScored,
          percentage: totalPossible > 0 ? Math.round((totalScored / totalPossible) * 100) : 0,
        };
      });
      const overallPossible = categoryStats.reduce((s, c) => s + c.total_possible, 0);
      const overallScored = categoryStats.reduce((s, c) => s + c.total_scored, 0);
      return {
        user_id: u.id,
        username: u.username,
        display_name: u.display_name,
        categories: categoryStats,
        overall_percentage: overallPossible > 0 ? Math.round((overallScored / overallPossible) * 100) : 0,
        overall_scored: overallScored,
        overall_possible: overallPossible,
      };
    });

    res.json({ ok: true, data: { categories, summary } });
  });

  // ── Manual reminder trigger (admin only) ──

  router.post('/send-reminders', async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) {
      res.status(403).json({ ok: false, error: 'Admin only' });
      return;
    }
    if (!settingsQueries) {
      res.status(500).json({ ok: false, error: 'Settings not available' });
      return;
    }
    const result = await sendTrainingReminders(trainingQueries, userQueries, settingsQueries);
    res.json({ ok: true, data: result });
  });

  return router;
}
