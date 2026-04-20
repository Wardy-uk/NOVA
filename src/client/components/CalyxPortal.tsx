import React, { useState, useEffect, useCallback } from 'react';

// ── Shared Types ──
interface PortalUser { id: number; name: string; email: string; organisation_name: string | null; open_ticket_count: number }
interface Ticket { id: number; reference: string; title: string; status: string; priority: string; created_at: string; updated_at: string; frt_due_at: string | null; resolution_due_at: string | null }
interface TicketDetail extends Ticket { description: string; team_name: string | null; category_name: string | null; comments: Comment[] }
interface Comment { id: number; body: string; author_name: string; author_type: 'agent' | 'requester'; created_at: string }
interface KbArticle { id: number; title: string; slug: string; body?: string; view_count: number; created_at: string; updated_at: string }
interface CatalogueItem { id: number; name: string; description: string | null; icon: string | null; request_form_schema: string }
interface CsatInfo { reference: string; title: string; already_responded: boolean }

// ── API helpers ──
async function portalApi<T = any>(path: string, opts?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string; total?: number; message?: string }> {
  const res = await fetch(`/api/calyx/portal${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
  return res.json();
}

// ── Styles ──
const bg = '#0f1318';
const card = '#1a1f26';
const border = 'rgba(255,255,255,0.06)';
const accent = '#5ec1ca';
const textPrimary = '#e2e8f0';
const textSecondary = '#94a3b8';
const textMuted = '#64748b';

const styles = {
  page: { minHeight: '100vh', background: bg, color: textPrimary, fontFamily: 'Inter, system-ui, -apple-system, sans-serif' } as React.CSSProperties,
  container: { maxWidth: 960, margin: '0 auto', padding: '0 20px' } as React.CSSProperties,
  card: { background: card, border: `1px solid ${border}`, borderRadius: 12, padding: 24, marginBottom: 16 } as React.CSSProperties,
  btn: { display: 'inline-block', padding: '10px 24px', background: accent, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14, textDecoration: 'none' } as React.CSSProperties,
  btnSecondary: { display: 'inline-block', padding: '10px 24px', background: 'transparent', color: accent, border: `1px solid ${accent}`, borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14, textDecoration: 'none' } as React.CSSProperties,
  input: { width: '100%', padding: '10px 14px', background: '#0f1318', border: `1px solid ${border}`, borderRadius: 8, color: textPrimary, fontSize: 14, outline: 'none', boxSizing: 'border-box' as const } as React.CSSProperties,
  textarea: { width: '100%', padding: '10px 14px', background: '#0f1318', border: `1px solid ${border}`, borderRadius: 8, color: textPrimary, fontSize: 14, outline: 'none', minHeight: 120, resize: 'vertical' as const, boxSizing: 'border-box' as const } as React.CSSProperties,
  label: { display: 'block', marginBottom: 6, fontSize: 13, color: textSecondary, fontWeight: 500 } as React.CSSProperties,
};

function statusBadge(s: string) {
  const colors: Record<string, string> = { open: '#3b82f6', in_progress: '#8b5cf6', waiting_customer: '#f59e0b', waiting_third_party: '#f59e0b', resolved: '#22c55e', closed: '#64748b' };
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: colors[s] || '#64748b', color: '#fff' }}>{s.replace(/_/g, ' ')}</span>;
}

function priorityBadge(p: string) {
  const colors: Record<string, string> = { P1: '#dc2626', P2: '#ea580c', P3: '#ca8a04', P4: '#2563eb' };
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: colors[p] || '#64748b', color: '#fff' }}>{p}</span>;
}

function timeAgo(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}

function slaCountdown(due: string | null) {
  if (!due) return <span style={{ color: textMuted }}>--</span>;
  const ms = new Date(due).getTime() - Date.now();
  if (ms <= 0) return <span style={{ color: '#dc2626', fontWeight: 600 }}>BREACHED</span>;
  const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000);
  const color = ms < 1800000 ? '#f59e0b' : '#22c55e';
  return <span style={{ color, fontWeight: 600 }}>{h}h {m}m</span>;
}

// ── Portal Layout ──
function PortalLayout({ children, user, onNavigate }: { children: React.ReactNode; user: PortalUser | null; onNavigate: (path: string) => void }) {
  return (
    <div style={styles.page}>
      <div style={{ background: card, borderBottom: `1px solid ${border}`, padding: '12px 0' }}>
        <div style={{ ...styles.container, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => onNavigate('/portal')}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', fontSize: 16 }}>N</div>
            <span style={{ fontWeight: 700, fontSize: 18, color: textPrimary }}>Nurtur Support</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {user && <button style={{ ...styles.btnSecondary, padding: '6px 14px', fontSize: 13 }} onClick={() => onNavigate('/portal/my-tickets')}>My Tickets</button>}
            {user && <button style={{ ...styles.btn, padding: '6px 14px', fontSize: 13 }} onClick={() => onNavigate('/portal/tickets/new')}>Raise Request</button>}
            {!user && <button style={{ ...styles.btn, padding: '6px 14px', fontSize: 13 }} onClick={() => onNavigate('/portal/login')}>Log in</button>}
          </div>
        </div>
      </div>
      <div style={{ ...styles.container, paddingTop: 32, paddingBottom: 48 }}>{children}</div>
    </div>
  );
}

// ── Pages ──

function LandingPage({ user, onNavigate }: { user: PortalUser | null; onNavigate: (p: string) => void }) {
  const [query, setQuery] = useState('');
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [featured, setFeatured] = useState<KbArticle[]>([]);

  useEffect(() => { portalApi<KbArticle[]>('/kb').then(r => { if (r.ok && r.data) setFeatured(r.data.slice(0, 5)); }); }, []);

  useEffect(() => {
    if (!query.trim()) { setArticles([]); return; }
    const t = setTimeout(() => { portalApi<KbArticle[]>(`/kb?q=${encodeURIComponent(query)}`).then(r => { if (r.ok && r.data) setArticles(r.data); }); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>How can we help?</h1>
        <p style={{ color: textSecondary, marginBottom: 24 }}>Search our knowledge base or raise a support request.</p>
        <input style={{ ...styles.input, maxWidth: 480, margin: '0 auto', textAlign: 'center', fontSize: 16, padding: '14px 20px' }}
          placeholder="Search for help..." value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      {articles.length > 0 && (
        <div style={{ ...styles.card, marginBottom: 32 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: textSecondary }}>Search Results</h3>
          {articles.map(a => (
            <div key={a.slug} style={{ padding: '10px 0', borderBottom: `1px solid ${border}`, cursor: 'pointer' }} onClick={() => onNavigate(`/portal/kb/${a.slug}`)}>
              <span style={{ color: accent }}>{a.title}</span>
              <span style={{ marginLeft: 8, fontSize: 12, color: textMuted }}>{a.view_count} views</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 40, flexWrap: 'wrap' }}>
        <button style={styles.btn} onClick={() => user ? onNavigate('/portal/my-tickets') : onNavigate('/portal/login')}>
          View my requests {user ? `(${user.open_ticket_count} open)` : ''}
        </button>
        <button style={styles.btnSecondary} onClick={() => user ? onNavigate('/portal/tickets/new') : onNavigate('/portal/login')}>
          Raise a new request
        </button>
      </div>

      {featured.length > 0 && (
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Popular Articles</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {featured.map(a => (
              <div key={a.slug} style={{ ...styles.card, cursor: 'pointer', marginBottom: 0 }} onClick={() => onNavigate(`/portal/kb/${a.slug}`)}>
                <h4 style={{ margin: '0 0 4px', fontSize: 14, color: accent }}>{a.title}</h4>
                <span style={{ fontSize: 12, color: textMuted }}>{a.view_count} views</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LoginPage({ onNavigate }: { onNavigate: (p: string) => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const params = new URLSearchParams(window.location.search);
  const urlError = params.get('error');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) { setError('Please enter a valid email'); return; }
    await portalApi('/request-access', { method: 'POST', body: JSON.stringify({ email }) });
    setSent(true);
  };

  return (
    <div style={{ maxWidth: 400, margin: '60px auto' }}>
      <div style={styles.card}>
        <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>Log in to Support Portal</h2>
        <p style={{ color: textSecondary, margin: '0 0 24px', fontSize: 14 }}>We'll send a magic link to your email address.</p>
        {urlError === 'invalid' && <div style={{ padding: '10px 14px', background: '#7f1d1d', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>Invalid or already-used login link. Please request a new one.</div>}
        {urlError === 'expired' && <div style={{ padding: '10px 14px', background: '#7f1d1d', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>Login link has expired. Please request a new one.</div>}
        {sent ? (
          <div style={{ padding: '16px', background: '#0f2922', borderRadius: 8, textAlign: 'center' }}>
            <p style={{ margin: 0, fontWeight: 600, color: '#22c55e' }}>Check your email</p>
            <p style={{ margin: '8px 0 0', color: textSecondary, fontSize: 13 }}>We've sent a login link. It expires in 15 minutes.</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label style={styles.label}>Email address</label>
            <input style={styles.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" autoFocus />
            {error && <p style={{ color: '#ef4444', fontSize: 13, margin: '8px 0 0' }}>{error}</p>}
            <button type="submit" style={{ ...styles.btn, width: '100%', marginTop: 16 }}>Send login link</button>
          </form>
        )}
      </div>
      <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: textMuted, cursor: 'pointer' }} onClick={() => onNavigate('/portal')}>
        &larr; Back to support home
      </p>
    </div>
  );
}

function MyTicketsPage({ onNavigate }: { onNavigate: (p: string) => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = filter ? `?status=${filter}` : '';
    portalApi<Ticket[]>(`/tickets${qs}`).then(r => { if (r.ok && r.data) setTickets(r.data); setLoading(false); });
  }, [filter]);

  const statuses = ['', 'open', 'in_progress', 'waiting_customer', 'resolved', 'closed'];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>My Requests</h2>
        <button style={styles.btn} onClick={() => onNavigate('/portal/tickets/new')}>Raise New Request</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {statuses.map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: '4px 12px', borderRadius: 16, fontSize: 13, cursor: 'pointer', border: `1px solid ${border}`,
            background: filter === s ? accent : 'transparent', color: filter === s ? '#fff' : textSecondary,
          }}>{s || 'All'}</button>
        ))}
      </div>

      {loading ? <p style={{ color: textMuted }}>Loading...</p> :
        tickets.length === 0 ? <div style={styles.card}><p style={{ color: textMuted, textAlign: 'center', margin: 0 }}>No requests found.</p></div> :
          <div style={styles.card}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}` }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: textMuted, fontWeight: 600 }}>Ref</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: textMuted, fontWeight: 600 }}>Title</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: textMuted, fontWeight: 600 }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: textMuted, fontWeight: 600 }}>Priority</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 12, color: textMuted, fontWeight: 600 }}>Updated</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 12, color: textMuted, fontWeight: 600 }}>SLA</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${border}`, cursor: 'pointer' }} onClick={() => onNavigate(`/portal/tickets/${t.reference}`)}>
                    <td style={{ padding: '10px 12px', fontSize: 13, fontFamily: 'monospace', color: accent }}>{t.reference}</td>
                    <td style={{ padding: '10px 12px', fontSize: 14 }}>{t.title}</td>
                    <td style={{ padding: '10px 12px' }}>{statusBadge(t.status)}</td>
                    <td style={{ padding: '10px 12px' }}>{priorityBadge(t.priority)}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12, color: textMuted, textAlign: 'right' }}>{timeAgo(t.updated_at)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13 }}>{slaCountdown(t.resolution_due_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }
    </div>
  );
}

function TicketDetailPage({ reference, onNavigate }: { reference: string; onNavigate: (p: string) => void }) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    portalApi<TicketDetail>(`/tickets/${reference}`).then(r => {
      if (r.ok && r.data) setTicket(r.data);
      else if (r.error === 'Access denied') setError('You do not have access to this ticket.');
      else setError(r.error || 'Ticket not found');
    });
  }, [reference]);

  useEffect(() => { load(); }, [load]);

  const sendReply = async () => {
    if (!reply.trim()) return;
    setSending(true);
    await portalApi(`/tickets/${reference}/reply`, { method: 'POST', body: JSON.stringify({ body: reply }) });
    setReply('');
    setSending(false);
    load();
  };

  if (error) return <div style={styles.card}><p style={{ color: '#ef4444', margin: 0 }}>{error}</p><button style={{ ...styles.btnSecondary, marginTop: 16 }} onClick={() => onNavigate('/portal/my-tickets')}>&larr; Back</button></div>;
  if (!ticket) return <p style={{ color: textMuted }}>Loading...</p>;

  return (
    <div>
      <button style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', padding: 0, marginBottom: 16, fontSize: 14 }} onClick={() => onNavigate('/portal/my-tickets')}>&larr; Back to My Requests</button>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* Main content */}
        <div style={{ flex: '1 1 600px', minWidth: 0 }}>
          <div style={styles.card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontFamily: 'monospace', color: accent, fontSize: 14 }}>{ticket.reference}</span>
              {statusBadge(ticket.status)}
              {priorityBadge(ticket.priority)}
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>{ticket.title}</h2>
            {ticket.description && <p style={{ color: textSecondary, fontSize: 14, margin: 0 }}>{ticket.description}</p>}
          </div>

          {/* SLA bars */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ ...styles.card, flex: 1, textAlign: 'center', marginBottom: 0, padding: 16 }}>
              <div style={{ fontSize: 12, color: textMuted, marginBottom: 4 }}>First Response</div>
              <div style={{ fontSize: 16 }}>{slaCountdown(ticket.frt_due_at)}</div>
            </div>
            <div style={{ ...styles.card, flex: 1, textAlign: 'center', marginBottom: 0, padding: 16 }}>
              <div style={{ fontSize: 12, color: textMuted, marginBottom: 4 }}>Resolution</div>
              <div style={{ fontSize: 16 }}>{slaCountdown(ticket.resolution_due_at)}</div>
            </div>
          </div>

          {/* Conversation */}
          <div style={styles.card}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Conversation</h3>
            {ticket.comments.length === 0 && <p style={{ color: textMuted, fontSize: 14, margin: 0 }}>No messages yet.</p>}
            {ticket.comments.map(c => (
              <div key={c.id} style={{
                marginBottom: 12, padding: 12, borderRadius: 8,
                ...(c.author_type === 'agent'
                  ? { borderLeft: `3px solid ${accent}`, background: 'rgba(94,193,202,0.05)', marginRight: 40 }
                  : { background: 'rgba(255,255,255,0.03)', marginLeft: 40 }),
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: c.author_type === 'agent' ? accent : textPrimary }}>{c.author_name}</span>
                  <span style={{ fontSize: 11, color: textMuted }}>{timeAgo(c.created_at)}</span>
                </div>
                <div style={{ fontSize: 14, color: textSecondary, whiteSpace: 'pre-wrap' }}>{c.body}</div>
              </div>
            ))}

            {!['resolved', 'closed'].includes(ticket.status) && (
              <div style={{ marginTop: 16 }}>
                <textarea style={styles.textarea} placeholder="Type your reply..." value={reply} onChange={e => setReply(e.target.value)} />
                <button style={{ ...styles.btn, marginTop: 8 }} onClick={sendReply} disabled={sending}>{sending ? 'Sending...' : 'Send Reply'}</button>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ flex: '0 0 240px' }}>
          <div style={styles.card}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, color: textMuted }}>Details</h4>
            <div style={{ marginBottom: 10 }}><span style={{ fontSize: 12, color: textMuted }}>Priority</span><br />{priorityBadge(ticket.priority)}</div>
            {ticket.team_name && <div style={{ marginBottom: 10 }}><span style={{ fontSize: 12, color: textMuted }}>Team</span><br /><span style={{ fontSize: 14 }}>{ticket.team_name}</span></div>}
            {ticket.category_name && <div style={{ marginBottom: 10 }}><span style={{ fontSize: 12, color: textMuted }}>Category</span><br /><span style={{ fontSize: 14 }}>{ticket.category_name}</span></div>}
            <div><span style={{ fontSize: 12, color: textMuted }}>Raised</span><br /><span style={{ fontSize: 14 }}>{new Date(ticket.created_at).toLocaleDateString()}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewTicketPage({ onNavigate }: { onNavigate: (p: string) => void }) {
  const [step, setStep] = useState(1);
  const [services, setServices] = useState<CatalogueItem[]>([]);
  const [selectedService, setSelectedService] = useState<CatalogueItem | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ reference: string } | null>(null);

  useEffect(() => { portalApi<CatalogueItem[]>('/catalogue').then(r => { if (r.ok && r.data) setServices(r.data); }); }, []);

  const selectService = (svc: CatalogueItem | null) => { setSelectedService(svc); setStep(2); };

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    const res = await portalApi('/tickets', {
      method: 'POST',
      body: JSON.stringify({ title, description, priority_label: priority, service_id: selectedService?.id ?? null }),
    });
    if (res.ok && res.data) { setResult(res.data as any); setStep(3); }
    setSubmitting(false);
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <button style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', padding: 0, marginBottom: 16, fontSize: 14 }} onClick={() => step > 1 && step < 3 ? setStep(step - 1) : onNavigate('/portal/my-tickets')}>&larr; Back</button>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[1, 2, 3].map(n => <div key={n} style={{ flex: 1, height: 4, borderRadius: 2, background: n <= step ? accent : border }} />)}
      </div>

      {step === 1 && (
        <div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>What do you need help with?</h2>
          <p style={{ color: textSecondary, marginBottom: 20, fontSize: 14 }}>Select a service or choose General Request.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <div style={{ ...styles.card, cursor: 'pointer', textAlign: 'center', marginBottom: 0, border: `2px solid ${accent}` }} onClick={() => selectService(null)}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>&#128172;</div>
              <h4 style={{ margin: 0, fontSize: 14 }}>General Request</h4>
            </div>
            {services.map(s => (
              <div key={s.id} style={{ ...styles.card, cursor: 'pointer', textAlign: 'center', marginBottom: 0 }} onClick={() => selectService(s)}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{s.icon || '&#128736;'}</div>
                <h4 style={{ margin: '0 0 4px', fontSize: 14 }}>{s.name}</h4>
                {s.description && <p style={{ margin: 0, fontSize: 12, color: textMuted }}>{s.description}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>Describe your request</h2>
          <p style={{ color: textSecondary, marginBottom: 20, fontSize: 14 }}>{selectedService ? selectedService.name : 'General Request'}</p>
          <div style={styles.card}>
            <div style={{ marginBottom: 16 }}>
              <label style={styles.label}>Title *</label>
              <input style={styles.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="Brief summary of your request" autoFocus />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={styles.label}>Description</label>
              <textarea style={styles.textarea} value={description} onChange={e => setDescription(e.target.value)} placeholder="Provide details about your request..." />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={styles.label}>Priority</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['Low', 'Medium', 'High'].map(p => (
                  <button key={p} onClick={() => setPriority(p)} style={{
                    padding: '6px 16px', borderRadius: 8, border: `1px solid ${border}`, cursor: 'pointer', fontSize: 13,
                    background: priority === p ? (p === 'High' ? '#dc2626' : p === 'Medium' ? '#ca8a04' : '#2563eb') : 'transparent',
                    color: priority === p ? '#fff' : textSecondary,
                  }}>{p}</button>
                ))}
              </div>
            </div>
            <button style={{ ...styles.btn, width: '100%' }} onClick={submit} disabled={submitting || !title.trim()}>
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ ...styles.card, padding: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#9989;</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>Request Submitted</h2>
            <p style={{ color: textSecondary, fontSize: 14, marginBottom: 20 }}>Your request has been logged with reference:</p>
            <div style={{ fontSize: 24, fontFamily: 'monospace', fontWeight: 700, color: accent, marginBottom: 24 }}>{result.reference}</div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button style={styles.btn} onClick={() => onNavigate(`/portal/tickets/${result.reference}`)}>View Request</button>
              <button style={styles.btnSecondary} onClick={() => onNavigate('/portal/my-tickets')}>My Requests</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KbListPage({ onNavigate }: { onNavigate: (p: string) => void }) {
  const [query, setQuery] = useState('');
  const [articles, setArticles] = useState<KbArticle[]>([]);

  useEffect(() => {
    const qs = query.trim() ? `?q=${encodeURIComponent(query)}` : '';
    const t = setTimeout(() => { portalApi<KbArticle[]>(`/kb${qs}`).then(r => { if (r.ok && r.data) setArticles(r.data); }); }, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div>
      <h2 style={{ margin: '0 0 16px', fontSize: 22 }}>Knowledge Base</h2>
      <input style={{ ...styles.input, marginBottom: 20 }} placeholder="Search articles..." value={query} onChange={e => setQuery(e.target.value)} />
      {articles.length === 0 ? <p style={{ color: textMuted }}>No articles found.</p> :
        <div style={{ display: 'grid', gap: 12 }}>
          {articles.map(a => (
            <div key={a.slug} style={{ ...styles.card, cursor: 'pointer', marginBottom: 0 }} onClick={() => onNavigate(`/portal/kb/${a.slug}`)}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, color: accent }}>{a.title}</h3>
              <span style={{ fontSize: 12, color: textMuted }}>{a.view_count} views &middot; Updated {timeAgo(a.updated_at)}</span>
            </div>
          ))}
        </div>
      }
    </div>
  );
}

function KbArticlePage({ slug, onNavigate }: { slug: string; onNavigate: (p: string) => void }) {
  const [article, setArticle] = useState<KbArticle | null>(null);

  useEffect(() => { portalApi<KbArticle>(`/kb/${slug}`).then(r => { if (r.ok && r.data) setArticle(r.data); }); }, [slug]);

  const sendFeedback = (helpful: boolean) => {
    fetch(`/api/calyx/kb/${article?.id}/${helpful ? 'helpful' : 'not-helpful'}`, { method: 'POST', credentials: 'include' });
  };

  if (!article) return <p style={{ color: textMuted }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <button style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', padding: 0, marginBottom: 16, fontSize: 14 }} onClick={() => onNavigate('/portal/kb')}>&larr; Back to Knowledge Base</button>
      <div style={styles.card}>
        <h1 style={{ margin: '0 0 16px', fontSize: 24 }}>{article.title}</h1>
        <div style={{ color: textSecondary, fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{article.body}</div>
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
        <button style={styles.btn} onClick={() => sendFeedback(true)}>&#128077; Helpful</button>
        <button style={styles.btnSecondary} onClick={() => sendFeedback(false)}>&#128078; Not helpful</button>
      </div>
    </div>
  );
}

function CsatPage({ token }: { token: string }) {
  const [info, setInfo] = useState<CsatInfo | null>(null);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [csat, setCsat] = useState(0);
  const [xla, setXla] = useState(0);
  const [effort, setEffort] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    portalApi<CsatInfo>(`/csat/${token}`).then(r => {
      if (r.ok && r.data) {
        if (r.data.already_responded) { setSubmitted(true); }
        setInfo(r.data);
      } else setError(r.error || 'Survey not found');
    });
  }, [token]);

  const submit = async () => {
    if (!csat) return;
    setSubmitting(true);
    const res = await portalApi(`/csat/${token}`, { method: 'POST', body: JSON.stringify({ csat_score: csat, xla_score: xla || null, effort_score: effort || null, comment: comment || null }) });
    if (res.ok) setSubmitted(true);
    else setError(res.error || 'Failed to submit');
    setSubmitting(false);
  };

  const StarRow = ({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) => (
    <div style={{ marginBottom: 20 }}>
      <label style={{ ...styles.label, marginBottom: 10 }}>{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => onChange(n)} style={{
            width: 48, height: 48, borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 22,
            background: n <= value ? '#fbbf24' : 'rgba(255,255,255,0.05)', color: n <= value ? '#fff' : textMuted,
          }}>&#9733;</button>
        ))}
      </div>
    </div>
  );

  if (error) return <div style={styles.page}><div style={{ ...styles.container, paddingTop: 60, textAlign: 'center' }}><div style={styles.card}><p style={{ color: '#ef4444', fontSize: 16 }}>{error === 'Survey not found or link has expired' ? 'This survey link has expired or is invalid.' : error}</p></div></div></div>;

  if (submitted) return (
    <div style={styles.page}><div style={{ ...styles.container, paddingTop: 60, textAlign: 'center' }}>
      <div style={{ ...styles.card, padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>&#127881;</div>
        <h2 style={{ margin: '0 0 8px' }}>Thank you for your feedback!</h2>
        <p style={{ color: textSecondary, margin: 0 }}>Your response has been recorded.</p>
      </div>
    </div></div>
  );

  if (!info) return <div style={styles.page}><div style={{ ...styles.container, paddingTop: 60 }}><p style={{ color: textMuted }}>Loading...</p></div></div>;

  return (
    <div style={styles.page}>
      <div style={{ ...styles.container, paddingTop: 40, maxWidth: 480 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', fontSize: 20, marginBottom: 12 }}>N</div>
          <h2 style={{ margin: '0 0 4px' }}>How did we do?</h2>
          <p style={{ color: textSecondary, fontSize: 14, margin: 0 }}>{info.reference} &mdash; {info.title}</p>
        </div>
        <div style={styles.card}>
          <StarRow label="Overall satisfaction (CSAT) *" value={csat} onChange={setCsat} />
          <StarRow label="How easy was it to get help? (XLA)" value={xla} onChange={setXla} />
          <StarRow label="How much effort did you put in?" value={effort} onChange={setEffort} />
          <div style={{ marginBottom: 20 }}>
            <label style={styles.label}>Comments (optional)</label>
            <textarea style={styles.textarea} value={comment} onChange={e => setComment(e.target.value)} placeholder="Any additional feedback..." />
          </div>
          <button style={{ ...styles.btn, width: '100%' }} onClick={submit} disabled={submitting || !csat}>{submitting ? 'Submitting...' : 'Submit Feedback'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Portal Router ──

export function CalyxPortal() {
  const [path, setPath] = useState(window.location.pathname);
  const [user, setUser] = useState<PortalUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    portalApi<PortalUser>('/me').then(r => {
      if (r.ok && r.data) setUser(r.data);
      setAuthChecked(true);
    }).catch(() => setAuthChecked(true));
  }, [path]);

  const navigate = useCallback((newPath: string) => {
    window.history.pushState(null, '', newPath);
    setPath(newPath);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  // CSAT page — no auth needed, standalone
  const csatMatch = path.match(/^\/portal\/csat\/([a-f0-9]+)$/);
  if (csatMatch) return <CsatPage token={csatMatch[1]} />;

  // Auth-required pages redirect to login
  const protectedPaths = ['/portal/my-tickets', '/portal/tickets/new'];
  const isProtected = protectedPaths.includes(path) || path.startsWith('/portal/tickets/');
  if (authChecked && !user && isProtected && path !== '/portal/login') {
    navigate('/portal/login');
    return null;
  }

  let page: React.ReactNode;

  if (path === '/portal/login') {
    page = <LoginPage onNavigate={navigate} />;
  } else if (path === '/portal/my-tickets') {
    page = <MyTicketsPage onNavigate={navigate} />;
  } else if (path === '/portal/tickets/new') {
    page = <NewTicketPage onNavigate={navigate} />;
  } else if (path.startsWith('/portal/tickets/')) {
    const ref = path.split('/portal/tickets/')[1];
    page = <TicketDetailPage reference={ref} onNavigate={navigate} />;
  } else if (path === '/portal/kb') {
    page = <KbListPage onNavigate={navigate} />;
  } else if (path.startsWith('/portal/kb/')) {
    const slug = path.split('/portal/kb/')[1];
    page = <KbArticlePage slug={slug} onNavigate={navigate} />;
  } else {
    page = <LandingPage user={user} onNavigate={navigate} />;
  }

  return <PortalLayout user={user} onNavigate={navigate}>{page}</PortalLayout>;
}
