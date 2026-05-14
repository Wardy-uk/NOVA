import React, { useEffect, useState } from 'react';

interface Props {
  token: string;
}

export default function PortalCSAT({ token }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticketKey, setTicketKey] = useState('');
  const [summary, setSummary] = useState('');
  const [csatScore, setCsatScore] = useState(0);
  const [easeScore, setEaseScore] = useState(0);
  const [effortScore, setEffortScore] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch(`/api/portal/csat/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setTicketKey(data.data.ticketKey);
          setSummary(data.data.summary);
        } else {
          setError(data.error === 'already_responded' ? 'This survey has already been completed.' :
                   data.error === 'expired' ? 'This survey has expired.' :
                   'Survey not found.');
        }
      })
      .catch(() => setError('Failed to load survey.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async () => {
    if (csatScore === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/csat/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csatScore,
          easeScore: easeScore || undefined,
          effortScore: effortScore || undefined,
          comment: comment.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSubmitted(true);
      } else {
        setError(data.error === 'already_responded' ? 'This survey has already been completed.' : 'Failed to submit.');
      }
    } catch {
      setError('Failed to submit survey.');
    }
    setSubmitting(false);
  };

  const StarRow = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>{label}</div>
      <div style={{ display: 'flex', gap: '8px' }}>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            onClick={() => onChange(n)}
            style={{
              width: '44px', height: '44px', borderRadius: '8px', border: '2px solid',
              borderColor: n <= value ? '#0d9488' : '#d1d5db',
              background: n <= value ? '#0d9488' : 'white',
              color: n <= value ? 'white' : '#6b7280',
              fontSize: '18px', cursor: 'pointer', fontWeight: 600,
              transition: 'all 0.15s',
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9ca3af', marginTop: '4px', paddingLeft: '4px', paddingRight: '4px' }}>
        <span>Poor</span><span>Excellent</span>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <div style={{ color: '#9ca3af' }}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px', padding: '40px 24px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
            {error}
          </div>
          <div style={{ fontSize: '14px', color: '#6b7280' }}>
            If you believe this is an error, please contact support.
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px', padding: '40px 24px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: '28px' }}>✓</div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>Thank you!</div>
          <div style={{ fontSize: '14px', color: '#6b7280' }}>
            Your feedback helps us improve our service. You can close this page.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', padding: '24px' }}>
      <div style={{ maxWidth: '480px', width: '100%', background: 'white', borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '13px', color: '#0d9488', fontWeight: 600, marginBottom: '4px' }}>CUSTOMER SATISFACTION SURVEY</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>How did we do?</div>
          <div style={{ fontSize: '14px', color: '#6b7280' }}>
            Regarding ticket <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0d9488' }}>{ticketKey}</span>
          </div>
          <div style={{ fontSize: '13px', color: '#9ca3af', marginTop: '4px' }}>{summary}</div>
        </div>

        <StarRow label="How satisfied are you with the resolution? *" value={csatScore} onChange={setCsatScore} />
        <StarRow label="How easy was it to get help?" value={easeScore} onChange={setEaseScore} />
        <StarRow label="How much effort did you have to put in?" value={effortScore} onChange={setEffortScore} />

        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>Any additional comments?</div>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Tell us more about your experience..."
            rows={3}
            style={{ width: '100%', padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', resize: 'none', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={csatScore === 0 || submitting}
          style={{
            width: '100%', padding: '12px', background: csatScore === 0 ? '#d1d5db' : '#0d9488',
            color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 600,
            cursor: csatScore === 0 ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
          }}
        >
          {submitting ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </div>
    </div>
  );
}
