import { Router } from 'express';
import crypto from 'crypto';
import type { Database } from 'sql.js';
import { EmailService } from '../services/email.js';
import { FileSettingsQueries } from '../db/settings-store.js';
import { isAdmin } from '../utils/role-helpers.js';

// ── Query helpers ──────────────────────────────────────────────────────

interface SurveyRow {
  id: number; title: string; description: string | null; team_name: string;
  status: string; start_date: string | null; end_date: string | null;
  invite_send_date: string | null; reminder_interval_days: number;
  created_at: string; closed_at: string | null; created_by: string;
}

interface QuestionRow {
  id: number; survey_id: number; order_index: number;
  question_text: string; question_type: string; required: number;
}

interface RecipientRow {
  id: number; survey_id: number; display_name: string; email: string;
  token: string; invite_sent: number; last_reminder_sent: string | null;
  completed: number; completed_at: string | null;
}

interface ResponseRow {
  id: number; survey_id: number; token: string;
  submitted_at: string; answers: string;
}

function rowToObj<T>(columns: string[], values: (string | number | null | Uint8Array)[]): T {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) obj[columns[i]] = values[i];
  return obj as T;
}

function queryAll<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  const result = db.exec(sql, params as (string | number | null | Uint8Array)[]);
  if (!result.length) return [];
  return result[0].values.map(v => rowToObj<T>(result[0].columns, v));
}

function queryOne<T>(db: Database, sql: string, params: unknown[] = []): T | null {
  const rows = queryAll<T>(db, sql, params);
  return rows[0] ?? null;
}

// ── Email helpers ──────────────────────────────────────────────────────

function getSurveyBaseUrl(settingsQueries: FileSettingsQueries): string {
  const s = settingsQueries.getAll();
  return s.app_base_url || s.sso_base_url || process.env.FRONTEND_URL || 'http://localhost:5173';
}

function buildSurveyInviteHtml(title: string, teamName: string, description: string | null, link: string): string {
  return `
    <div style="font-family: 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #f8fafc; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 42px; height: 42px; background: linear-gradient(135deg, #3eaab4, #7c3aed); border-radius: 12px; color: white; font-size: 22px; font-weight: 800; line-height: 42px; font-family: 'Plus Jakarta Sans', sans-serif;">n</div>
      </div>
      <h2 style="color: #1a1f36; margin: 0 0 8px; font-size: 20px; text-align: center;">You've been invited to complete a survey</h2>
      <p style="color: #475569; text-align: center; margin: 0 0 20px; font-size: 14px;">${teamName}</p>
      <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #e8edf3;">
        <h3 style="color: #1a1f36; margin: 0 0 8px; font-size: 16px;">${title}</h3>
        ${description ? `<p style="color: #475569; margin: 0 0 16px; font-size: 14px;">${description}</p>` : ''}
        <p style="color: #475569; font-size: 13px; margin: 0;">Your response is <strong>completely anonymous</strong>. No one will be able to see who gave which answers.</p>
      </div>
      <div style="text-align: center;">
        <a href="${link}" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #3eaab4, #5ec1ca); color: white; text-decoration: none; border-radius: 40px; font-weight: 600; font-size: 14px;">Complete Survey</a>
      </div>
      <p style="color: #94a3b8; font-size: 11px; text-align: center; margin-top: 24px;">This link is unique to you and can only be used once.</p>
    </div>`;
}

function buildReminderHtml(title: string, teamName: string, link: string): string {
  return `
    <div style="font-family: 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; background: #f8fafc; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 42px; height: 42px; background: linear-gradient(135deg, #3eaab4, #7c3aed); border-radius: 12px; color: white; font-size: 22px; font-weight: 800; line-height: 42px; font-family: 'Plus Jakarta Sans', sans-serif;">n</div>
      </div>
      <h2 style="color: #1a1f36; margin: 0 0 8px; font-size: 20px; text-align: center;">Reminder: Survey still open</h2>
      <p style="color: #475569; text-align: center; margin: 0 0 20px; font-size: 14px;">${teamName} — ${title}</p>
      <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #e8edf3;">
        <p style="color: #475569; font-size: 14px; margin: 0;">We haven't received your response yet. Your feedback is valued and <strong>completely anonymous</strong>.</p>
      </div>
      <div style="text-align: center;">
        <a href="${link}" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #3eaab4, #5ec1ca); color: white; text-decoration: none; border-radius: 40px; font-weight: 600; font-size: 14px;">Complete Survey</a>
      </div>
    </div>`;
}

// ── Shared send helpers ────────────────────────────────────────────────

async function sendInvites(db: Database, surveyId: number, emailService: EmailService, baseUrl: string): Promise<number> {
  const survey = queryOne<SurveyRow>(db, 'SELECT * FROM surveys WHERE id = ?', [surveyId]);
  if (!survey) return 0;

  const recipients = queryAll<RecipientRow>(
    db, 'SELECT * FROM survey_recipients WHERE survey_id = ? AND invite_sent = 0', [surveyId]
  );

  let sent = 0;
  for (const r of recipients) {
    const link = `${baseUrl}/survey/${r.token}`;
    const html = buildSurveyInviteHtml(survey.title, survey.team_name, survey.description, link);
    try {
      await emailService.send({
        to: r.email,
        subject: `Survey: ${survey.title}`,
        text: `You've been invited to complete a survey: ${survey.title}. Visit ${link} to respond. Your response is anonymous.`,
        html,
      });
      db.run('UPDATE survey_recipients SET invite_sent = 1 WHERE id = ?', [r.id]);
      sent++;
    } catch (err) {
      console.error(`[Surveys] Failed to send invite to ${r.email}:`, err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

async function sendReminders(db: Database, surveyId: number, emailService: EmailService, baseUrl: string): Promise<number> {
  const survey = queryOne<SurveyRow>(db, 'SELECT * FROM surveys WHERE id = ?', [surveyId]);
  if (!survey || survey.status !== 'active') return 0;

  const intervalDays = survey.reminder_interval_days || 2;
  const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000).toISOString();

  const recipients = queryAll<RecipientRow>(
    db,
    `SELECT * FROM survey_recipients WHERE survey_id = ? AND completed = 0
     AND (last_reminder_sent IS NULL OR last_reminder_sent < ?)`,
    [surveyId, cutoff]
  );

  let sent = 0;
  for (const r of recipients) {
    const link = `${baseUrl}/survey/${r.token}`;
    const html = buildReminderHtml(survey.title, survey.team_name, link);
    try {
      await emailService.send({
        to: r.email,
        subject: `Reminder: ${survey.title}`,
        text: `Reminder: please complete the survey "${survey.title}". Visit ${link}. Your response is anonymous.`,
        html,
      });
      db.run('UPDATE survey_recipients SET last_reminder_sent = datetime(\'now\') WHERE id = ?', [r.id]);
      sent++;
    } catch (err) {
      console.error(`[Surveys] Failed to send reminder to ${r.email}:`, err instanceof Error ? err.message : err);
    }
  }
  return sent;
}

// ── Helper: aggregate results for a survey (anonymised) ────────────────

function aggregateResults(db: Database, surveyId: number, questions: QuestionRow[]) {
  const responses = queryAll<ResponseRow>(db, 'SELECT * FROM survey_responses WHERE survey_id = ?', [surveyId]);
  return questions.map(q => {
    const answers = responses
      .map(r => {
        const parsed = JSON.parse(r.answers) as Array<{ question_id: number; value: string | number }>;
        return parsed.find(a => a.question_id === q.id);
      })
      .filter(Boolean) as Array<{ question_id: number; value: string | number }>;

    if (q.question_type === 'scale_5') {
      const values = answers.map(a => Number(a.value)).filter(v => !isNaN(v));
      const distribution = [0, 0, 0, 0, 0];
      for (const v of values) if (v >= 1 && v <= 5) distribution[v - 1]++;
      const avg = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
      return { question_id: q.id, question_text: q.question_text, question_type: q.question_type, average: Math.round(avg * 100) / 100, distribution, response_count: values.length };
    } else {
      const texts = answers.map(a => String(a.value)).filter(t => t.trim());
      for (let i = texts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [texts[i], texts[j]] = [texts[j], texts[i]];
      }
      return { question_id: q.id, question_text: q.question_text, question_type: q.question_type, responses: texts, response_count: texts.length };
    }
  });
}

// ── Route factory ──────────────────────────────────────────────────────

interface UserLookup {
  getById(id: number): { id: number; username: string; email: string | null; team_id: number | null; role: string } | undefined;
}

interface TeamLookup {
  getById(id: number): { id: number; name: string } | undefined;
}

export function createSurveyRoutes(db: Database, settingsQueries: FileSettingsQueries, userQueries: UserLookup, teamQueries: TeamLookup): Router {
  const router = Router();
  const emailService = new EmailService(() => settingsQueries.getAll());

  /** Resolve the team name(s) the current user belongs to */
  function getUserTeamName(userId: number): string | null {
    const user = userQueries.getById(userId);
    if (!user?.team_id) return null;
    const team = teamQueries.getById(user.team_id);
    return team?.name ?? null;
  }

  /** Check if the user is admin and can manage this survey's team */
  function canManageSurvey(req: Express.Request, survey: SurveyRow): boolean {
    if (!req.user) return false;
    if (isAdmin(req.user.role)) return true; // admin can manage all
    return false;
  }

  // ── List surveys ──
  // Admins: see surveys for their team (or all if no team)
  // Non-admins: see surveys they've been invited to
  router.get('/', (req, res) => {
    if (!req.user) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }

    const admin = isAdmin(req.user.role);
    let surveys: SurveyRow[];

    if (admin) {
      // Admin: all surveys (they can manage any team)
      surveys = queryAll<SurveyRow>(db, 'SELECT * FROM surveys ORDER BY created_at DESC');
    } else {
      // Non-admin: only surveys they've been invited to (match by email)
      const user = userQueries.getById(req.user.id);
      if (!user?.email) {
        res.json({ ok: true, data: [] }); return;
      }
      surveys = queryAll<SurveyRow>(
        db,
        `SELECT DISTINCT s.* FROM surveys s
         JOIN survey_recipients sr ON sr.survey_id = s.id
         WHERE sr.email = ? ORDER BY s.created_at DESC`,
        [user.email]
      );
    }

    const data = surveys.map(s => {
      const total = queryOne<{ c: number }>(db, 'SELECT COUNT(*) as c FROM survey_recipients WHERE survey_id = ?', [s.id])?.c ?? 0;
      const done = queryOne<{ c: number }>(db, 'SELECT COUNT(*) as c FROM survey_recipients WHERE survey_id = ? AND completed = 1', [s.id])?.c ?? 0;
      return { ...s, recipients_total: total, recipients_completed: done };
    });
    res.json({ ok: true, data, is_admin: admin });
  });

  // ── Get available teams (for team selector in create form) ──
  router.get('/teams', (req, res) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    const teams = queryAll<{ id: number; name: string }>(db, 'SELECT id, name FROM teams ORDER BY name');
    res.json({ ok: true, data: teams });
  });

  // ── Get survey detail ──
  router.get('/:id', (req, res) => {
    if (!req.user) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }

    const survey = queryOne<SurveyRow>(db, 'SELECT * FROM surveys WHERE id = ?', [req.params.id]);
    if (!survey) { res.status(404).json({ ok: false, error: 'Survey not found' }); return; }

    const admin = isAdmin(req.user.role);

    // Non-admins can only view surveys they're invited to
    if (!admin) {
      const user = userQueries.getById(req.user.id);
      if (!user?.email) { res.status(403).json({ ok: false, error: 'Access denied' }); return; }
      const invited = queryOne<RecipientRow>(
        db, 'SELECT * FROM survey_recipients WHERE survey_id = ? AND email = ?', [survey.id, user.email]
      );
      if (!invited) { res.status(403).json({ ok: false, error: 'Access denied' }); return; }
    }

    const questions = queryAll<QuestionRow>(db, 'SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY order_index', [survey.id]);

    // Only admins see recipient list
    const recipients = admin
      ? queryAll<RecipientRow>(db, 'SELECT id, survey_id, display_name, email, invite_sent, completed, completed_at FROM survey_recipients WHERE survey_id = ?', [survey.id])
      : [];

    const aggregated = aggregateResults(db, survey.id, questions);

    const total = queryOne<{ c: number }>(db, 'SELECT COUNT(*) as c FROM survey_recipients WHERE survey_id = ?', [survey.id])?.c ?? 0;
    const done = queryOne<{ c: number }>(db, 'SELECT COUNT(*) as c FROM survey_recipients WHERE survey_id = ? AND completed = 1', [survey.id])?.c ?? 0;

    res.json({
      ok: true,
      data: {
        ...survey,
        questions,
        recipients,
        results: aggregated,
        recipients_total: total,
        recipients_completed: done,
        is_admin: admin,
      },
    });
  });

  // ── Admin: create survey ──
  router.post('/', (req, res) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const { title, description, team_name, start_date, end_date, invite_send_date, reminder_interval_days, questions, recipients } = req.body;
    if (!title || !team_name || !questions?.length || !recipients?.length) {
      res.status(400).json({ ok: false, error: 'Missing required fields: title, team_name, questions, recipients' });
      return;
    }

    db.run(
      `INSERT INTO surveys (title, description, team_name, start_date, end_date, invite_send_date, reminder_interval_days, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description || null, team_name, start_date || null, end_date || null, invite_send_date || null, reminder_interval_days ?? 2, req.user.username]
    );

    const surveyId = (db.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number);

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      db.run(
        `INSERT INTO survey_questions (survey_id, order_index, question_text, question_type, required) VALUES (?, ?, ?, ?, ?)`,
        [surveyId, i, q.question_text, q.question_type, q.required !== false ? 1 : 0]
      );
    }

    for (const r of recipients) {
      const token = crypto.randomUUID();
      db.run(
        `INSERT INTO survey_recipients (survey_id, display_name, email, token) VALUES (?, ?, ?, ?)`,
        [surveyId, r.display_name, r.email, token]
      );
    }

    res.json({ ok: true, data: { id: surveyId } });
  });

  // ── Admin: update draft survey ──
  router.put('/:id', (req, res) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const survey = queryOne<SurveyRow>(db, 'SELECT * FROM surveys WHERE id = ?', [req.params.id]);
    if (!survey) { res.status(404).json({ ok: false, error: 'Survey not found' }); return; }
    if (survey.status !== 'draft') { res.status(400).json({ ok: false, error: 'Only draft surveys can be edited' }); return; }

    const { title, description, team_name, start_date, end_date, invite_send_date, reminder_interval_days, questions, recipients } = req.body;

    db.run(
      `UPDATE surveys SET title = ?, description = ?, team_name = ?, start_date = ?, end_date = ?, invite_send_date = ?, reminder_interval_days = ? WHERE id = ?`,
      [title ?? survey.title, description ?? survey.description, team_name ?? survey.team_name,
       start_date ?? survey.start_date, end_date ?? survey.end_date, invite_send_date ?? survey.invite_send_date,
       reminder_interval_days ?? survey.reminder_interval_days, survey.id]
    );

    if (questions) {
      db.run('DELETE FROM survey_questions WHERE survey_id = ?', [survey.id]);
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        db.run(
          `INSERT INTO survey_questions (survey_id, order_index, question_text, question_type, required) VALUES (?, ?, ?, ?, ?)`,
          [survey.id, i, q.question_text, q.question_type, q.required !== false ? 1 : 0]
        );
      }
    }

    if (recipients) {
      db.run('DELETE FROM survey_recipients WHERE survey_id = ?', [survey.id]);
      for (const r of recipients) {
        const token = crypto.randomUUID();
        db.run(
          `INSERT INTO survey_recipients (survey_id, display_name, email, token) VALUES (?, ?, ?, ?)`,
          [survey.id, r.display_name, r.email, token]
        );
      }
    }

    res.json({ ok: true });
  });

  // ── Admin: activate survey ──
  router.post('/:id/activate', async (req, res) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const survey = queryOne<SurveyRow>(db, 'SELECT * FROM surveys WHERE id = ?', [req.params.id]);
    if (!survey) { res.status(404).json({ ok: false, error: 'Survey not found' }); return; }
    if (survey.status !== 'draft' && survey.status !== 'scheduled') {
      res.status(400).json({ ok: false, error: 'Only draft or scheduled surveys can be activated' }); return;
    }

    db.run(`UPDATE surveys SET status = 'active', start_date = COALESCE(start_date, datetime('now')) WHERE id = ?`, [survey.id]);

    const baseUrl = getSurveyBaseUrl(settingsQueries);
    const sent = await sendInvites(db, survey.id, emailService, baseUrl);

    res.json({ ok: true, data: { invites_sent: sent } });
  });

  // ── Admin: close survey ──
  router.post('/:id/close', (req, res) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const survey = queryOne<SurveyRow>(db, 'SELECT * FROM surveys WHERE id = ?', [req.params.id]);
    if (!survey) { res.status(404).json({ ok: false, error: 'Survey not found' }); return; }

    db.run(`UPDATE surveys SET status = 'closed', closed_at = datetime('now') WHERE id = ?`, [survey.id]);
    res.json({ ok: true });
  });

  // ── Admin: delete draft survey ──
  router.delete('/:id', (req, res) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const survey = queryOne<SurveyRow>(db, 'SELECT * FROM surveys WHERE id = ?', [req.params.id]);
    if (!survey) { res.status(404).json({ ok: false, error: 'Survey not found' }); return; }
    if (survey.status !== 'draft') { res.status(400).json({ ok: false, error: 'Only draft surveys can be deleted' }); return; }

    db.run('DELETE FROM survey_responses WHERE survey_id = ?', [survey.id]);
    db.run('DELETE FROM survey_recipients WHERE survey_id = ?', [survey.id]);
    db.run('DELETE FROM survey_questions WHERE survey_id = ?', [survey.id]);
    db.run('DELETE FROM surveys WHERE id = ?', [survey.id]);
    res.json({ ok: true });
  });

  // ── Admin: send reminders ──
  router.post('/:id/send-reminders', async (req, res) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const survey = queryOne<SurveyRow>(db, 'SELECT * FROM surveys WHERE id = ?', [req.params.id]);
    if (!survey) { res.status(404).json({ ok: false, error: 'Survey not found' }); return; }
    if (survey.status !== 'active') { res.status(400).json({ ok: false, error: 'Survey is not active' }); return; }

    const baseUrl = getSurveyBaseUrl(settingsQueries);
    const sent = await sendReminders(db, survey.id, emailService, baseUrl);
    res.json({ ok: true, data: { reminders_sent: sent } });
  });

  // ── Admin: export CSV ──
  router.get('/:id/export', (req, res) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }

    const survey = queryOne<SurveyRow>(db, 'SELECT * FROM surveys WHERE id = ?', [req.params.id]);
    if (!survey) { res.status(404).json({ ok: false, error: 'Survey not found' }); return; }

    const questions = queryAll<QuestionRow>(db, 'SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY order_index', [survey.id]);
    const responses = queryAll<ResponseRow>(db, 'SELECT * FROM survey_responses WHERE survey_id = ?', [survey.id]);

    // Shuffle responses to prevent ordering-based identification
    for (let i = responses.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [responses[i], responses[j]] = [responses[j], responses[i]];
    }

    const header = ['Response #', ...questions.map(q => q.question_text)];
    const rows = responses.map((r, idx) => {
      const answers = JSON.parse(r.answers) as Array<{ question_id: number; value: string | number }>;
      const cells = questions.map(q => {
        const a = answers.find(a => a.question_id === q.id);
        const val = a ? String(a.value) : '';
        return `"${val.replace(/"/g, '""')}"`;
      });
      return [idx + 1, ...cells].join(',');
    });

    const csv = [header.map(h => `"${String(h).replace(/"/g, '""')}"`).join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="survey-${survey.id}-results.csv"`);
    res.send(csv);
  });

  return router;
}

// ── Public routes (no auth) ────────────────────────────────────────────

export function createSurveyPublicRoutes(db: Database): Router {
  const router = Router();

  // GET survey by token
  router.get('/:token', (req, res) => {
    const { token } = req.params;

    const recipient = queryOne<RecipientRow>(db, 'SELECT * FROM survey_recipients WHERE token = ?', [token]);
    if (!recipient) { res.status(404).json({ ok: false, error: 'This link is not valid or the survey is no longer open.' }); return; }
    if (recipient.completed) { res.status(410).json({ ok: false, error: 'This survey link has already been submitted.' }); return; }

    const survey = queryOne<SurveyRow>(db, 'SELECT * FROM surveys WHERE id = ?', [recipient.survey_id]);
    if (!survey || survey.status !== 'active') {
      res.status(410).json({ ok: false, error: 'This link is not valid or the survey is no longer open.' }); return;
    }

    const questions = queryAll<QuestionRow>(db, 'SELECT id, order_index, question_text, question_type, required FROM survey_questions WHERE survey_id = ? ORDER BY order_index', [survey.id]);

    res.json({
      ok: true,
      data: {
        title: survey.title,
        description: survey.description,
        team_name: survey.team_name,
        questions,
      },
    });
  });

  // POST submit response
  router.post('/:token', (req, res) => {
    const { token } = req.params;
    const { answers } = req.body;

    if (!answers || !Array.isArray(answers)) {
      res.status(400).json({ ok: false, error: 'Missing answers' }); return;
    }

    const recipient = queryOne<RecipientRow>(db, 'SELECT * FROM survey_recipients WHERE token = ?', [token]);
    if (!recipient) { res.status(404).json({ ok: false, error: 'This link is not valid or the survey is no longer open.' }); return; }
    if (recipient.completed) { res.status(410).json({ ok: false, error: 'This survey link has already been submitted.' }); return; }

    const survey = queryOne<SurveyRow>(db, 'SELECT * FROM surveys WHERE id = ?', [recipient.survey_id]);
    if (!survey || survey.status !== 'active') {
      res.status(410).json({ ok: false, error: 'This link is not valid or the survey is no longer open.' }); return;
    }

    db.run(
      `INSERT INTO survey_responses (survey_id, token, answers) VALUES (?, ?, ?)`,
      [survey.id, token, JSON.stringify(answers)]
    );

    db.run(
      `UPDATE survey_recipients SET completed = 1, completed_at = datetime('now') WHERE token = ?`,
      [token]
    );

    res.json({ ok: true });
  });

  return router;
}

// ── Background scheduler ───────────────────────────────────────────────

export function runSurveyScheduler(db: Database, settingsQueries: FileSettingsQueries): void {
  const emailService = new EmailService(() => settingsQueries.getAll());
  const baseUrl = getSurveyBaseUrl(settingsQueries);

  (async () => {
    try {
      const now = new Date().toISOString();

      // Auto-activate scheduled surveys whose start_date has passed
      const toActivate = queryAll<SurveyRow>(
        db, `SELECT * FROM surveys WHERE status = 'scheduled' AND start_date IS NOT NULL AND start_date <= ?`, [now]
      );
      for (const s of toActivate) {
        db.run(`UPDATE surveys SET status = 'active' WHERE id = ?`, [s.id]);
        const sent = await sendInvites(db, s.id, emailService, baseUrl);
        console.log(`[Surveys] Auto-activated survey "${s.title}" — ${sent} invites sent`);
      }

      // Send advance invites for scheduled surveys whose invite_send_date has passed
      const toInvite = queryAll<SurveyRow>(
        db, `SELECT * FROM surveys WHERE status = 'scheduled' AND invite_send_date IS NOT NULL AND invite_send_date <= ?
             AND id NOT IN (SELECT survey_id FROM survey_recipients WHERE invite_sent = 1 GROUP BY survey_id)`, [now]
      );
      for (const s of toInvite) {
        const sent = await sendInvites(db, s.id, emailService, baseUrl);
        if (sent > 0) console.log(`[Surveys] Sent advance invites for "${s.title}" — ${sent} emails`);
      }

      // Auto-close active surveys whose end_date has passed
      const toClose = queryAll<SurveyRow>(
        db, `SELECT * FROM surveys WHERE status = 'active' AND end_date IS NOT NULL AND end_date <= ?`, [now]
      );
      for (const s of toClose) {
        db.run(`UPDATE surveys SET status = 'closed', closed_at = datetime('now') WHERE id = ?`, [s.id]);
        console.log(`[Surveys] Auto-closed survey "${s.title}"`);
      }

      // Send reminders for active surveys
      const active = queryAll<SurveyRow>(db, `SELECT * FROM surveys WHERE status = 'active'`);
      for (const s of active) {
        const sent = await sendReminders(db, s.id, emailService, baseUrl);
        if (sent > 0) console.log(`[Surveys] Sent ${sent} reminders for "${s.title}"`);
      }
    } catch (err) {
      console.error('[Surveys] Scheduler error:', err instanceof Error ? err.message : err);
    }
  })();
}
