import React, { useEffect, useState } from 'react';

interface Props {
  token: string; // either a legacy hex token or a Jira issue key (NT-1234)
}

const TEAL = '#0d9488';
const RATING_LABELS = ['', 'Poor', 'Below par', 'OK', 'Good', 'Excellent'];

export default function PortalCSAT({ token }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticketKey, setTicketKey] = useState('');
  const [summary, setSummary] = useState('');

  const [rating, setRating] = useState(0); // banked rating
  const [hover, setHover] = useState(0);
  const [banking, setBanking] = useState(false);
  const [banked, setBanked] = useState(false);

  const [comment, setComment] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentDone, setCommentDone] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false); // rating was revised on this visit

  useEffect(() => {
    fetch(`/api/portal/csat/${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setTicketKey(data.data.ticketKey);
          setSummary(data.data.summary);
          // Already rated: land on the thank-you with their rating shown, still changeable.
          if (data.data.existingRating) {
            setRating(data.data.existingRating);
            setBanked(true);
            if (data.data.existingComment) {
              setComment(data.data.existingComment);
              setCommentDone(true);
            }
          }
        } else {
          setError(
            data.error === 'expired' ? 'This feedback link has expired.' :
            data.error === 'rate_limited' ? 'Too many requests — please try again in a minute.' :
            'We could not find this feedback request.',
          );
        }
      })
      .catch(() => setError('Something went wrong loading this page.'))
      .finally(() => setLoading(false));
  }, [token]);

  // Rating is banked the instant it is chosen — no separate submit step. Tapping a
  // different star later revises it: opinions change, and mis-taps need fixing.
  const pickRating = async (n: number) => {
    if (banking || n === rating) return;
    const previous = rating;
    setRating(n);
    setBanking(true);
    try {
      const res = await fetch(`/api/portal/csat/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csatScore: n }),
      });
      const data = await res.json();
      if (data.ok) {
        setBanked(true);
        if (previous) setChanged(true);
      } else {
        setError('We could not record your rating. Please try again.');
        setRating(previous);
      }
    } catch {
      setError('We could not record your rating. Please try again.');
      setRating(previous);
    }
    setBanking(false);
  };

  const sendComment = async () => {
    const text = comment.trim();
    if (!text) return;
    setCommentSaving(true);
    setCommentError(null);
    try {
      const res = await fetch(`/api/portal/csat/${encodeURIComponent(token)}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: text }),
      });
      const data = await res.json().catch(() => null);
      // A rejected save must never render as "shared with the team" — the customer
      // would walk away believing they had been heard when nothing was stored.
      if (data?.ok) setCommentDone(true);
      else setCommentError(
        data?.error === 'expired'
          ? 'This feedback window has closed, so we could not save your comment. Your rating is safe.'
          : 'We could not save your comment. Your rating is safe — please try again.',
      );
    } catch {
      setCommentError('We could not save your comment. Your rating is safe — please try again.');
    }
    setCommentSaving(false);
  };

  const shell = (children: React.ReactNode) => (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f4f6f8', padding: '20px', boxSizing: 'border-box',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: '440px' }}>
        <div style={{ textAlign: 'center', marginBottom: '14px', letterSpacing: '0.14em', fontSize: '12px', fontWeight: 700, color: TEAL }}>
          NURTUR&nbsp;SUPPORT
        </div>
        <div style={{ background: 'white', borderRadius: '18px', boxShadow: '0 6px 24px rgba(15,23,42,0.08)', padding: '28px 24px' }}>
          {children}
        </div>
        <div style={{ textAlign: 'center', marginTop: '14px', fontSize: '12px', color: '#94a3b8' }}>
          Nurtur · Customer Support
        </div>
      </div>
    </div>
  );

  if (loading) {
    return shell(<div style={{ textAlign: 'center', color: '#94a3b8', padding: '24px 0' }}>Loading…</div>);
  }

  if (error) {
    return shell(
      <div style={{ textAlign: 'center', padding: '12px 0' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>💬</div>
        <div style={{ fontSize: '17px', fontWeight: 600, color: '#1e293b' }}>{error}</div>
      </div>,
    );
  }

  // Star row — the whole interaction. Tapping a star banks the rating.
  const Stars = ({ interactive }: { interactive: boolean }) => (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
      {[1, 2, 3, 4, 5].map(n => {
        const active = n <= (hover || rating);
        return (
          <button
            key={n}
            onClick={() => interactive && pickRating(n)}
            onMouseEnter={() => interactive && setHover(n)}
            onMouseLeave={() => interactive && setHover(0)}
            disabled={!interactive || banking}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            style={{
              background: 'none', border: 'none', padding: '2px',
              cursor: interactive && !banking ? 'pointer' : 'default',
              fontSize: '44px', lineHeight: 1,
              color: active ? '#f59e0b' : '#d1d5db',
              transition: 'color 0.12s, transform 0.12s',
              transform: interactive && hover === n ? 'scale(1.12)' : 'scale(1)',
            }}
          >
            ★
          </button>
        );
      })}
    </div>
  );

  // ── Banked: thank-you + optional comment ──
  if (banked) {
    return shell(
      <div>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '50%', background: '#d1fae5',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '26px',
          }}>✓</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
            {changed ? 'Rating updated' : 'Thank you!'}
          </div>
          <div style={{ fontSize: '14px', color: '#64748b', marginBottom: '18px' }}>
            You rated your experience <strong style={{ color: '#0f172a' }}>{rating}/5</strong>{RATING_LABELS[rating] ? ` — ${RATING_LABELS[rating]}` : ''}.
          </div>
          <Stars interactive={true} />
          <div style={{ marginTop: '10px', fontSize: '12px', color: '#94a3b8' }}>
            {banking ? 'Saving…' : 'Changed your mind? Tap a different star to update it.'}
          </div>
        </div>

        {commentDone ? (
          <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: '#64748b' }}>
            Your comment has been shared with the team. You can close this page.
            <div>
              <button
                onClick={() => setCommentDone(false)}
                style={{
                  background: 'none', border: 'none', padding: '6px 0', marginTop: '2px',
                  color: TEAL, fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Change your comment
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: '22px', borderTop: '1px solid #eef2f6', paddingTop: '18px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>
              Anything you'd like to add? <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
            </div>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Tell us more about your experience…"
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '10px',
                fontSize: '14px', resize: 'none', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
              }}
            />
            {commentError && (
              <div style={{ marginTop: '8px', fontSize: '13px', color: '#b91c1c' }}>{commentError}</div>
            )}
            <button
              onClick={sendComment}
              disabled={!comment.trim() || commentSaving}
              style={{
                width: '100%', marginTop: '10px', padding: '11px', borderRadius: '10px', border: 'none',
                background: !comment.trim() ? '#cbd5e1' : TEAL, color: 'white', fontSize: '14px', fontWeight: 600,
                cursor: !comment.trim() ? 'default' : 'pointer',
              }}
            >
              {commentSaving ? 'Sending…' : 'Send comment'}
            </button>
          </div>
        )}
      </div>,
    );
  }

  // ── Initial: single rating, above the fold, captured on tap ──
  return shell(
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '19px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
        How did we do?
      </div>
      <div style={{ fontSize: '14px', color: '#64748b', marginBottom: '4px' }}>
        Tap a star to rate the help you received on
      </div>
      <div style={{ fontSize: '13px', color: TEAL, fontWeight: 600, fontFamily: 'monospace', marginBottom: '2px' }}>
        {ticketKey}
      </div>
      {summary && summary !== ticketKey && (
        <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '20px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary}
        </div>
      )}
      <div style={{ marginTop: '18px', marginBottom: '8px' }}>
        <Stars interactive={true} />
      </div>
      <div style={{ height: '18px', fontSize: '13px', fontWeight: 600, color: '#f59e0b' }}>
        {RATING_LABELS[hover || rating] || ''}
      </div>
    </div>,
  );
}
