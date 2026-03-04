/**
 * Customer Setup Portal — standalone public wizard.
 * Renders outside the NOVA app chrome. Token-validated, no login required.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { BrandSettingDef, LogoTypeDef } from '../../shared/brand-settings-defs.js';

const API = '/api/public/setup';

interface PortalInfo {
  account: string;
  product: string;
  completed_at: string | null;
  progress: Record<string, boolean>;
  brandSettingDefs: BrandSettingDef[];
  brandSettingGroups: Array<{ id: string; label: string }>;
  logoTypeDefs: LogoTypeDef[];
}

interface Branch {
  id: number;
  delivery_id: number;
  is_default: number;
  name: string;
  sales_email: string | null;
  sales_phone: string | null;
  lettings_email: string | null;
  lettings_phone: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  town: string | null;
  post_code1: string | null;
  post_code2: string | null;
}

interface LogoMeta {
  id: number;
  logo_type: number;
  logo_label: string;
  mime_type: string;
  file_name: string | null;
  file_size: number | null;
}

interface PortalAccount {
  id: number;
  delivery_id: number;
  portal_name: string;
}

interface BranchDistrict {
  id: number;
  branch_id: number;
  delivery_id: number;
  district_name: string;
  all_sectors: number;
  sectors_json: string;
}

const STEPS = [
  { key: 'company', label: 'Company Info' },
  { key: 'colors', label: 'Colours & Theme' },
  { key: 'branches', label: 'Branches' },
  { key: 'logos', label: 'Logos & Images' },
  { key: 'build', label: 'Build' },
  { key: 'social', label: 'Social & URLs' },
  { key: 'review', label: 'Review & Submit' },
] as const;

// Groups mapped to each wizard step
const STEP_GROUPS: Record<string, string[]> = {
  company: ['company'],
  colors: ['colors'],
  social: ['social', 'urls', 'analytics', 'cta'],
};

export function SetupPortal({ token }: { token: string }) {
  const [info, setInfo] = useState<PortalInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [branches, setBranches] = useState<Branch[]>([]);
  const [logos, setLogos] = useState<LogoMeta[]>([]);
  const [portalAccounts, setPortalAccounts] = useState<PortalAccount[]>([]);
  const [districts, setDistricts] = useState<BranchDistrict[]>([]);
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const q = `?token=${token}`;

  // Load initial data
  useEffect(() => {
    Promise.all([
      fetch(`${API}/info${q}`).then(r => r.json()),
      fetch(`${API}/brand-settings${q}`).then(r => r.json()),
      fetch(`${API}/branches${q}`).then(r => r.json()),
      fetch(`${API}/logos${q}`).then(r => r.json()),
      fetch(`${API}/portal-accounts${q}`).then(r => r.json()),
      fetch(`${API}/districts${q}`).then(r => r.json()),
    ]).then(([infoRes, brandRes, branchRes, logoRes, portalRes, districtRes]) => {
      if (!infoRes.ok) {
        setError(infoRes.error === 'expired' ? 'This link has expired or is no longer valid.' : (infoRes.error || 'Invalid link'));
        return;
      }
      setInfo(infoRes.data);
      setSettings(brandRes.data || {});
      setBranches(branchRes.data || []);
      setLogos(logoRes.data || []);
      if (portalRes.ok) setPortalAccounts(portalRes.data || []);
      if (districtRes.ok) setDistricts(districtRes.data || []);
      setProgress(infoRes.data.progress || {});
      if (infoRes.data.completed_at) {
        setSubmitted(true);
        setStep(STEPS.length - 1);
      } else {
        // Resume at first incomplete step
        const prog: Record<string, boolean> = infoRes.data.progress || {};
        const idx = STEPS.findIndex(s => !prog[s.key]);
        if (idx >= 0) setStep(idx);
      }
    }).catch(() => setError('Failed to load. Please check your internet connection.'));
  }, [token]);

  // Auto-save a single brand setting with debounce
  const autoSave = useCallback((key: string, value: string) => {
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      fetch(`${API}/brand-settings/${key}${q}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
    }, 800);
  }, [q]);

  // Save progress
  const saveProgress = useCallback((newProgress: Record<string, boolean>) => {
    setProgress(newProgress);
    fetch(`${API}/progress${q}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: newProgress }),
    });
  }, [q]);

  const goNext = () => {
    const newProg = { ...progress, [STEPS[step].key]: true };
    saveProgress(newProg);
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  };
  const goBack = () => setStep(s => Math.max(s - 1, 0));

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Bulk save all settings
      await fetch(`${API}/brand-settings${q}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      // Mark all steps complete
      const allComplete = Object.fromEntries(STEPS.map(s => [s.key, true]));
      await fetch(`${API}/progress${q}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress: allComplete }),
      });
      await fetch(`${API}/complete${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      setSubmitted(true);
    } catch {
      alert('Failed to submit. Please try again.');
    }
    setSubmitting(false);
  };

  // Accent colour from customer's primary colour
  const accent = settings['theme.colourPrimary'] || '#5ec1ca';

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 40, maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#128279;</div>
          <h2 style={{ color: '#1e293b', marginBottom: 8 }}>Link Unavailable</h2>
          <p style={{ color: '#64748b' }}>{error}</p>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 24 }}>If you believe this is a mistake, please contact your account manager.</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' }}>
        <div style={{ color: '#64748b' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Header */}
      <header style={{ backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, color: '#1e293b' }}>{info.account}</h1>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>Account Setup</span>
        </div>
        <span style={{ fontSize: 10, color: '#cbd5e1', letterSpacing: 1 }}>Powered by Nurtur</span>
      </header>

      {/* Progress bar */}
      <div style={{ backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0', padding: '12px 24px', display: 'flex', gap: 4, overflowX: 'auto' }}>
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => !submitted && setStep(i)}
            style={{
              flex: 1,
              minWidth: 90,
              padding: '8px 4px',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: i === step ? 600 : 400,
              cursor: submitted ? 'default' : 'pointer',
              backgroundColor: i === step ? accent : progress[s.key] ? '#ecfdf5' : '#f1f5f9',
              color: i === step ? '#fff' : progress[s.key] ? '#059669' : '#64748b',
              transition: 'all 0.15s',
            }}
          >
            {progress[s.key] && i !== step ? '\u2713 ' : ''}{s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
        {submitted ? (
          <SubmittedView account={info.account} settings={settings} branches={branches} logos={logos} portalAccounts={portalAccounts} districts={districts} info={info} token={token} />
        ) : (
          <>
            {step === 0 && <BrandFieldsStep defs={info.brandSettingDefs} groups={STEP_GROUPS.company} settings={settings} setSettings={setSettings} autoSave={autoSave} />}
            {step === 1 && <BrandFieldsStep defs={info.brandSettingDefs} groups={STEP_GROUPS.colors} settings={settings} setSettings={setSettings} autoSave={autoSave} />}
            {step === 2 && <BranchStep branches={branches} setBranches={setBranches} q={q} />}
            {step === 3 && <LogoStep logos={logos} setLogos={setLogos} logoTypeDefs={info.logoTypeDefs} q={q} />}
            {step === 4 && <BuildStep portalAccounts={portalAccounts} setPortalAccounts={setPortalAccounts} districts={districts} setDistricts={setDistricts} branches={branches} q={q} />}
            {step === 5 && <BrandFieldsStep defs={info.brandSettingDefs} groups={STEP_GROUPS.social} settings={settings} setSettings={setSettings} autoSave={autoSave} />}
            {step === 6 && <ReviewStep settings={settings} branches={branches} logos={logos} portalAccounts={portalAccounts} districts={districts} info={info} onSubmit={handleSubmit} submitting={submitting} />}

            {/* Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
              <button onClick={goBack} disabled={step === 0} style={navBtnStyle(step === 0)}>Back</button>
              {step < STEPS.length - 1 ? (
                <button onClick={goNext} style={{ ...navBtnStyle(false), backgroundColor: accent, color: '#fff' }}>Continue</button>
              ) : null}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '10px 28px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
    backgroundColor: '#fff', color: '#374151', transition: 'all 0.15s',
  };
}

// ── Brand Fields Step ──

function BrandFieldsStep({ defs, groups, settings, setSettings, autoSave }: {
  defs: BrandSettingDef[];
  groups: string[];
  settings: Record<string, string>;
  setSettings: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
  autoSave: (key: string, value: string) => void;
}) {
  const fields = defs.filter(d => groups.includes(d.group));

  return (
    <div>
      {fields.map(def => (
        <div key={def.key} style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
            {def.label}{def.required && <span style={{ color: '#ef4444' }}> *</span>}
          </label>
          {def.type === 'color' ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="color"
                value={settings[def.key] || '#000000'}
                onChange={e => {
                  const v = e.target.value;
                  setSettings(prev => ({ ...prev, [def.key]: v }));
                  autoSave(def.key, v);
                }}
                style={{ width: 48, height: 36, border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', padding: 2 }}
              />
              <input
                type="text"
                value={settings[def.key] || ''}
                onChange={e => {
                  const v = e.target.value;
                  setSettings(prev => ({ ...prev, [def.key]: v }));
                  autoSave(def.key, v);
                }}
                placeholder="#000000"
                style={inputStyle()}
              />
            </div>
          ) : (
            <input
              type={def.type === 'url' ? 'url' : def.type === 'email' ? 'email' : 'text'}
              value={settings[def.key] || ''}
              onChange={e => {
                const v = e.target.value;
                setSettings(prev => ({ ...prev, [def.key]: v }));
                autoSave(def.key, v);
              }}
              placeholder={def.placeholder || ''}
              style={inputStyle()}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Branch Step ──

function BranchStep({ branches, setBranches, q }: {
  branches: Branch[];
  setBranches: (b: Branch[]) => void;
  q: string;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Branch>>({});

  const saveBranch = async () => {
    if (!form.name?.trim()) return;
    try {
      let res;
      if (editId) {
        res = await fetch(`${API}/branches/${editId}${q}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      } else {
        res = await fetch(`${API}/branches${q}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
      }
      const json = await res.json();
      if (json.ok) setBranches(json.data);
      setAdding(false);
      setEditId(null);
      setForm({});
    } catch { /* ignore */ }
  };

  const deleteBranch = async (id: number) => {
    if (!confirm('Delete this branch?')) return;
    const res = await fetch(`${API}/branches/${id}${q}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.ok) setBranches(json.data);
  };

  const startEdit = (b: Branch) => {
    setEditId(b.id);
    setForm(b);
    setAdding(true);
  };

  const branchFields: Array<{ key: keyof Branch; label: string }> = [
    { key: 'name', label: 'Branch Name' },
    { key: 'sales_email', label: 'Sales Email' },
    { key: 'sales_phone', label: 'Sales Phone' },
    { key: 'lettings_email', label: 'Lettings Email' },
    { key: 'lettings_phone', label: 'Lettings Phone' },
    { key: 'address1', label: 'Address Line 1' },
    { key: 'address2', label: 'Address Line 2' },
    { key: 'town', label: 'Town' },
    { key: 'post_code1', label: 'Postcode' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>Add your office branches with contact details.</p>
        {!adding && (
          <button onClick={() => { setAdding(true); setForm({}); setEditId(null); }} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, cursor: 'pointer', backgroundColor: '#fff', color: '#374151' }}>
            + Add Branch
          </button>
        )}
      </div>

      {adding && (
        <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          {branchFields.map(f => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 3 }}>{f.label}</label>
              <input
                type="text"
                value={(form as Record<string, unknown>)[f.key] as string || ''}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                style={inputStyle()}
              />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={saveBranch} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', backgroundColor: '#059669', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
              {editId ? 'Update' : 'Save'}
            </button>
            <button onClick={() => { setAdding(false); setEditId(null); setForm({}); }} style={{ padding: '8px 20px', borderRadius: 6, border: '1px solid #d1d5db', backgroundColor: '#fff', fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {branches.length === 0 && !adding && (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No branches added yet</div>
      )}

      {branches.map(b => (
        <div key={b.id} style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 14 }}>{b.name}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {[b.sales_email, b.sales_phone, b.town].filter(Boolean).join(' | ') || 'No details'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => startEdit(b)} style={{ fontSize: 12, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
            <button onClick={() => deleteBranch(b.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Logo Step ──

function LogoCard({ def, existing, uploading, onUpload, onDelete, apiBase, query }: {
  def: LogoTypeDef;
  existing: LogoMeta | undefined;
  uploading: boolean;
  onUpload: (logoType: number, file: File) => void;
  onDelete: (logoType: number) => void;
  apiBase: string;
  query: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const imgSrc = existing ? `${apiBase}/logos/${existing.id}/image${query}` : null;

  return (
    <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>{def.label}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>{def.description}</div>
      {imgSrc ? (
        <div>
          <img src={imgSrc} alt={def.label} style={{ maxWidth: '100%', maxHeight: 80, objectFit: 'contain', marginBottom: 8 }} />
          <div>
            <button onClick={() => onDelete(def.type)} style={{ fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          style={{ padding: '20px 8px', border: '2px dashed #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#64748b' }}
        >
          {uploading ? 'Uploading...' : 'Click to upload'}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0 }}
            onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(def.type, f); e.target.value = ''; }}
          />
        </div>
      )}
    </div>
  );
}

function LogoStep({ logos, setLogos, logoTypeDefs, q }: {
  logos: LogoMeta[];
  setLogos: (l: LogoMeta[]) => void;
  logoTypeDefs: LogoTypeDef[];
  q: string;
}) {
  const [uploading, setUploading] = useState<number | null>(null);

  const handleUpload = async (logoType: number, file: File) => {
    if (file.size > 2 * 1024 * 1024) { alert('File too large (max 2MB)'); return; }
    const allowed = ['image/png', 'image/jpeg', 'image/svg+xml'];
    if (!allowed.includes(file.type)) { alert('Unsupported format. Use PNG, JPEG, or SVG.'); return; }

    setUploading(logoType);
    try {
      const data = await fileToBase64(file);
      const res = await fetch(`${API}/logos/${logoType}${q}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: data, mime_type: file.type, file_name: file.name, file_size: file.size }),
      });
      const json = await res.json();
      if (json.ok) {
        setLogos(json.data);
      } else {
        alert(`Upload failed: ${json.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Upload error: ${err instanceof Error ? err.message : 'Network or server error'}`);
    }
    setUploading(null);
  };

  const handleDelete = async (logoType: number) => {
    const res = await fetch(`${API}/logos/${logoType}${q}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.ok) setLogos(json.data);
  };

  return (
    <div>
      <p style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>Upload your brand logos. Accepted formats: PNG, JPEG, SVG (max 2MB).</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {logoTypeDefs.map(def => (
          <LogoCard
            key={def.type}
            def={def}
            existing={logos.find(l => l.logo_type === def.type)}
            uploading={uploading === def.type}
            onUpload={handleUpload}
            onDelete={handleDelete}
            apiBase={API}
            query={q}
          />
        ))}
      </div>
    </div>
  );
}

// ── Build Step ──

function BuildStep({ portalAccounts, setPortalAccounts, districts, setDistricts, branches, q }: {
  portalAccounts: PortalAccount[];
  setPortalAccounts: (a: PortalAccount[]) => void;
  districts: BranchDistrict[];
  setDistricts: (d: BranchDistrict[]) => void;
  branches: Branch[];
  q: string;
}) {
  // Portal accounts state
  const [newPortal, setNewPortal] = useState('');
  const [addingPortal, setAddingPortal] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  // Districts state
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [addingDistrict, setAddingDistrict] = useState(false);
  const [editingDistrictId, setEditingDistrictId] = useState<number | null>(null);
  const [districtForm, setDistrictForm] = useState({ district_name: '', all_sectors: false, sectors: [] as string[], currentSector: '' });

  // ── Portal Account actions ──

  const addPortalAccount = async () => {
    if (!newPortal.trim()) return;
    try {
      const res = await fetch(`${API}/portal-accounts${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portal_name: newPortal.trim() }),
      });
      const json = await res.json();
      if (json.ok) { setPortalAccounts(json.data); setNewPortal(''); setAddingPortal(false); }
      else alert(json.error || 'Failed to add');
    } catch { alert('Network error'); }
  };

  const deletePortalAccount = async (id: number) => {
    const res = await fetch(`${API}/portal-accounts/${id}${q}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.ok) setPortalAccounts(json.data);
  };

  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { alert('CSV must have a header row and at least one data row'); return; }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const nameIdx = headers.indexOf('name');
    if (nameIdx === -1) { alert('CSV must have a "name" column'); return; }
    const names = lines.slice(1).map(l => l.split(',')[nameIdx]?.trim()).filter(Boolean);
    if (names.length === 0) { alert('No valid names found in CSV'); return; }

    try {
      const res = await fetch(`${API}/portal-accounts/import${q}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      const json = await res.json();
      if (json.ok) { setPortalAccounts(json.data); alert(`Imported ${names.length} portal account(s)`); }
      else alert(json.error || 'Import failed');
    } catch { alert('Network error'); }
    e.target.value = '';
    setImportingCsv(false);
  };

  // ── District actions ──

  const resetDistrictForm = () => setDistrictForm({ district_name: '', all_sectors: false, sectors: [], currentSector: '' });

  const addSector = () => {
    const s = districtForm.currentSector.trim();
    if (!s) return;
    if (districtForm.sectors.includes(s)) { alert('Sector already added'); return; }
    setDistrictForm(prev => ({ ...prev, sectors: [...prev.sectors, s], currentSector: '' }));
  };

  const removeSector = (sector: string) => {
    setDistrictForm(prev => ({ ...prev, sectors: prev.sectors.filter(s => s !== sector) }));
  };

  const saveDistrict = async () => {
    if (!districtForm.district_name.trim()) { alert('District name is required'); return; }
    if (!districtForm.all_sectors && districtForm.sectors.length === 0) { alert('Add at least one sector or toggle "All Sectors"'); return; }

    const payload = {
      branch_id: selectedBranchId,
      district_name: districtForm.district_name.trim(),
      all_sectors: districtForm.all_sectors,
      sectors: districtForm.sectors,
    };

    try {
      const url = editingDistrictId
        ? `${API}/districts/${editingDistrictId}${q}`
        : `${API}/districts${q}`;
      const res = await fetch(url, {
        method: editingDistrictId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.ok) { setDistricts(json.data); setAddingDistrict(false); setEditingDistrictId(null); resetDistrictForm(); }
      else alert(json.error || 'Failed to save district');
    } catch { alert('Network error'); }
  };

  const deleteDistrict = async (id: number) => {
    if (!confirm('Delete this district?')) return;
    const res = await fetch(`${API}/districts/${id}${q}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.ok) setDistricts(json.data);
  };

  const startEditDistrict = (d: BranchDistrict) => {
    setEditingDistrictId(d.id);
    setAddingDistrict(true);
    let sectors: string[] = [];
    try { sectors = JSON.parse(d.sectors_json || '[]'); } catch { /* ignore */ }
    setDistrictForm({ district_name: d.district_name, all_sectors: !!d.all_sectors, sectors, currentSector: '' });
  };

  const branchDistricts = selectedBranchId ? districts.filter(d => d.branch_id === selectedBranchId) : [];

  return (
    <div>
      {/* ── Section 1: Portal Accounts ── */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ color: '#1e293b', margin: '0 0 4px', fontSize: 15, fontWeight: 600 }}>Portal Accounts</h3>
        <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 12px' }}>
          Add the portal account names for this instance (e.g. Estates, Residential, Commercial).
        </p>

        {/* Chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {portalAccounts.map(a => (
            <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', backgroundColor: '#f1f5f9', borderRadius: 20, fontSize: 13, color: '#334155' }}>
              {a.portal_name}
              <button onClick={() => deletePortalAccount(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14, lineHeight: 1, padding: 0 }} title="Remove">&times;</button>
            </span>
          ))}
          {portalAccounts.length === 0 && !addingPortal && (
            <span style={{ color: '#94a3b8', fontSize: 13 }}>No portal accounts added yet</span>
          )}
        </div>

        {/* Add form */}
        {addingPortal ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              type="text"
              value={newPortal}
              onChange={e => setNewPortal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addPortalAccount()}
              placeholder="Portal account name"
              autoFocus
              style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, outline: 'none' }}
            />
            <button onClick={addPortalAccount} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', backgroundColor: '#059669', color: '#fff', fontSize: 13, cursor: 'pointer' }}>Add</button>
            <button onClick={() => { setAddingPortal(false); setNewPortal(''); }} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #d1d5db', backgroundColor: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setAddingPortal(true)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, cursor: 'pointer', backgroundColor: '#fff', color: '#374151' }}>+ Add Portal Account</button>
            <button onClick={() => csvRef.current?.click()} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, cursor: 'pointer', backgroundColor: '#fff', color: '#374151' }}>Import CSV</button>
            <input ref={csvRef} type="file" accept=".csv" hidden onChange={handleCsvImport} />
          </div>
        )}
      </div>

      {/* ── Section 2: Branch Districts & Sectors ── */}
      <div>
        <h3 style={{ color: '#1e293b', margin: '0 0 4px', fontSize: 15, fontWeight: 600 }}>Branch Districts &amp; Sectors</h3>
        <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 12px' }}>
          Select a branch and configure the districts and sectors it covers.
        </p>

        {branches.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13, backgroundColor: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            Add branches in the Branches step first.
          </div>
        ) : (
          <>
            {/* Branch selector */}
            <select
              value={selectedBranchId ?? ''}
              onChange={e => { setSelectedBranchId(e.target.value ? Number(e.target.value) : null); setAddingDistrict(false); setEditingDistrictId(null); resetDistrictForm(); }}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, marginBottom: 16, outline: 'none', color: '#1e293b', backgroundColor: '#fff' }}
            >
              <option value="">Select a branch...</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>

            {selectedBranchId && (
              <>
                {/* District list */}
                {branchDistricts.length === 0 && !addingDistrict && (
                  <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No districts for this branch</div>
                )}

                {branchDistricts.map(d => {
                  let sectors: string[] = [];
                  try { sectors = JSON.parse(d.sectors_json || '[]'); } catch { /* ignore */ }
                  return (
                    <div key={d.id} style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 14, textTransform: 'uppercase' }}>{d.district_name}</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => startEditDistrict(d)} style={{ fontSize: 12, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                          <button onClick={() => deleteDistrict(d.id)} style={{ fontSize: 12, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
                        </div>
                      </div>
                      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {d.all_sectors ? (
                          <span style={{ fontSize: 11, padding: '3px 8px', backgroundColor: '#dbeafe', color: '#1e40af', borderRadius: 12, fontWeight: 500 }}>All Sectors</span>
                        ) : sectors.length > 0 ? (
                          sectors.map(s => (
                            <span key={s} style={{ fontSize: 11, padding: '3px 8px', backgroundColor: '#f1f5f9', color: '#475569', borderRadius: 12 }}>{s}</span>
                          ))
                        ) : (
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>No sectors</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Add/Edit district form */}
                {addingDistrict ? (
                  <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginTop: 8 }}>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 3 }}>District Name</label>
                      <input
                        type="text"
                        value={districtForm.district_name}
                        onChange={e => setDistrictForm(prev => ({ ...prev, district_name: e.target.value }))}
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>

                    <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontSize: 12, fontWeight: 500, color: '#374151' }}>All Sectors</label>
                      <button
                        onClick={() => setDistrictForm(prev => ({ ...prev, all_sectors: !prev.all_sectors }))}
                        style={{
                          width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', position: 'relative',
                          backgroundColor: districtForm.all_sectors ? '#059669' : '#d1d5db', transition: 'background-color 0.2s',
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: 2, left: districtForm.all_sectors ? 20 : 2,
                          width: 18, height: 18, borderRadius: '50%', backgroundColor: '#fff', transition: 'left 0.2s',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        }} />
                      </button>
                    </div>

                    {!districtForm.all_sectors && (
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 3 }}>Sectors</label>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <input
                            type="text"
                            value={districtForm.currentSector}
                            onChange={e => setDistrictForm(prev => ({ ...prev, currentSector: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSector())}
                            placeholder="Enter sector code"
                            style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, outline: 'none' }}
                          />
                          <button onClick={addSector} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', backgroundColor: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Add</button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {districtForm.sectors.map(s => (
                            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', backgroundColor: '#f1f5f9', borderRadius: 12, fontSize: 12, color: '#334155' }}>
                              {s}
                              <button onClick={() => removeSector(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 13, lineHeight: 1, padding: 0 }}>&times;</button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={saveDistrict} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', backgroundColor: '#059669', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
                        {editingDistrictId ? 'Update' : 'Save'}
                      </button>
                      <button onClick={() => { setAddingDistrict(false); setEditingDistrictId(null); resetDistrictForm(); }} style={{ padding: '8px 20px', borderRadius: 6, border: '1px solid #d1d5db', backgroundColor: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setAddingDistrict(true); resetDistrictForm(); }} style={{ marginTop: 8, padding: '8px 16px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, cursor: 'pointer', backgroundColor: '#fff', color: '#374151' }}>+ Add District</button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Review Step ──

function ReviewStep({ settings, branches, logos, portalAccounts, districts, info, onSubmit, submitting }: {
  settings: Record<string, string>;
  branches: Branch[];
  logos: LogoMeta[];
  portalAccounts: PortalAccount[];
  districts: BranchDistrict[];
  info: PortalInfo;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const filled = Object.entries(settings).filter(([, v]) => v?.trim());
  const requiredDefs = info.brandSettingDefs.filter(d => d.required);
  const missing = requiredDefs.filter(d => !settings[d.key]?.trim());

  return (
    <div>
      <h3 style={{ color: '#1e293b', margin: '0 0 16px', fontSize: 16 }}>Review Your Information</h3>

      <SummarySection title="Brand Settings" count={`${filled.length} fields completed`}>
        {missing.length > 0 && (
          <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 12, marginBottom: 12, fontSize: 13, color: '#b91c1c' }}>
            Missing required fields: {missing.map(d => d.label).join(', ')}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 13 }}>
          {filled.slice(0, 12).map(([key, val]) => {
            const def = info.brandSettingDefs.find(d => d.key === key);
            return (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ color: '#64748b' }}>{def?.label || key}</span>
                {def?.type === 'color' ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, backgroundColor: val, border: '1px solid #d1d5db' }} />
                    <span style={{ color: '#1e293b', fontFamily: 'monospace', fontSize: 12 }}>{val}</span>
                  </span>
                ) : (
                  <span style={{ color: '#1e293b', textAlign: 'right', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
                )}
              </div>
            );
          })}
        </div>
        {filled.length > 12 && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>+ {filled.length - 12} more fields</div>}
      </SummarySection>

      <SummarySection title="Branches" count={`${branches.length} branches`}>
        {branches.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No branches added</div>
        ) : (
          branches.map(b => (
            <div key={b.id} style={{ fontSize: 13, padding: '4px 0', color: '#374151' }}>{b.name}{b.town ? ` (${b.town})` : ''}</div>
          ))
        )}
      </SummarySection>

      <SummarySection title="Logos" count={`${logos.length} of ${info.logoTypeDefs.length} uploaded`}>
        {logos.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No logos uploaded</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {logos.map(l => (
              <span key={l.id} style={{ fontSize: 12, padding: '4px 8px', backgroundColor: '#f1f5f9', borderRadius: 4, color: '#374151' }}>{l.logo_label}</span>
            ))}
          </div>
        )}
      </SummarySection>

      <SummarySection title="Portal Accounts" count={`${portalAccounts.length} accounts`}>
        {portalAccounts.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No portal accounts added</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {portalAccounts.map(a => (
              <span key={a.id} style={{ fontSize: 12, padding: '4px 8px', backgroundColor: '#f1f5f9', borderRadius: 4, color: '#374151' }}>{a.portal_name}</span>
            ))}
          </div>
        )}
      </SummarySection>

      <SummarySection title="Districts & Sectors" count={`${districts.length} districts`}>
        {districts.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>No districts configured</div>
        ) : (
          districts.map(d => {
            const branch = branches.find(b => b.id === d.branch_id);
            return (
              <div key={d.id} style={{ fontSize: 13, padding: '4px 0', color: '#374151', borderBottom: '1px solid #f1f5f9' }}>
                <strong>{d.district_name}</strong>
                <span style={{ color: '#94a3b8', marginLeft: 8 }}>({branch?.name || 'Unknown branch'})</span>
                {d.all_sectors ? (
                  <span style={{ marginLeft: 8, fontSize: 11, backgroundColor: '#dbeafe', color: '#1d4ed8', padding: '2px 6px', borderRadius: 4 }}>All Sectors</span>
                ) : d.sectors_json && JSON.parse(d.sectors_json).length > 0 ? (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#64748b' }}>Sectors: {JSON.parse(d.sectors_json).join(', ')}</span>
                ) : null}
              </div>
            );
          })
        )}
      </SummarySection>

      <div style={{ marginTop: 24, textAlign: 'center' }}>
        {missing.length > 0 && (
          <p style={{ color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>Please complete all required fields before submitting.</p>
        )}
        <button
          onClick={onSubmit}
          disabled={submitting || missing.length > 0}
          style={{
            padding: '12px 48px', borderRadius: 8, border: 'none', fontSize: 15, fontWeight: 600,
            cursor: submitting || missing.length > 0 ? 'not-allowed' : 'pointer',
            backgroundColor: missing.length > 0 ? '#d1d5db' : '#059669', color: '#fff',
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

// ── Submitted View ──

function SubmittedView({ account, settings, branches, logos, portalAccounts, districts, info, token }: {
  account: string;
  settings: Record<string, string>;
  branches: Branch[];
  logos: LogoMeta[];
  portalAccounts: PortalAccount[];
  districts: BranchDistrict[];
  info: PortalInfo;
  token: string;
}) {
  const _ = token; // Available for future logo previews
  const filled = Object.entries(settings).filter(([, v]) => v?.trim());

  return (
    <div>
      <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #86efac', borderRadius: 8, padding: 24, textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>&#10003;</div>
        <h2 style={{ color: '#065f46', margin: '0 0 8px', fontSize: 18 }}>Thank You!</h2>
        <p style={{ color: '#047857', fontSize: 14, margin: 0 }}>Your setup details for <strong>{account}</strong> have been submitted. Our team will review and begin configuring your account.</p>
      </div>

      <SummarySection title="Brand Settings" count={`${filled.length} fields`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 13 }}>
          {filled.map(([key, val]) => {
            const def = info.brandSettingDefs.find(d => d.key === key);
            return (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ color: '#64748b' }}>{def?.label || key}</span>
                {def?.type === 'color' ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, backgroundColor: val, border: '1px solid #d1d5db' }} />
                    <span style={{ color: '#1e293b', fontFamily: 'monospace', fontSize: 12 }}>{val}</span>
                  </span>
                ) : (
                  <span style={{ color: '#1e293b', textAlign: 'right', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
                )}
              </div>
            );
          })}
        </div>
      </SummarySection>

      <SummarySection title="Branches" count={`${branches.length}`}>
        {branches.map(b => (
          <div key={b.id} style={{ fontSize: 13, padding: '4px 0', color: '#374151' }}>{b.name}{b.town ? ` (${b.town})` : ''}</div>
        ))}
      </SummarySection>

      <SummarySection title="Logos" count={`${logos.length}`}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {logos.map(l => (
            <span key={l.id} style={{ fontSize: 12, padding: '4px 8px', backgroundColor: '#f1f5f9', borderRadius: 4, color: '#374151' }}>{l.logo_label}</span>
          ))}
        </div>
      </SummarySection>

      {portalAccounts.length > 0 && (
        <SummarySection title="Portal Accounts" count={`${portalAccounts.length}`}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {portalAccounts.map(a => (
              <span key={a.id} style={{ fontSize: 12, padding: '4px 8px', backgroundColor: '#f1f5f9', borderRadius: 4, color: '#374151' }}>{a.portal_name}</span>
            ))}
          </div>
        </SummarySection>
      )}

      {districts.length > 0 && (
        <SummarySection title="Districts & Sectors" count={`${districts.length}`}>
          {districts.map(d => {
            const branch = branches.find(b => b.id === d.branch_id);
            return (
              <div key={d.id} style={{ fontSize: 13, padding: '4px 0', color: '#374151' }}>
                {d.district_name} <span style={{ color: '#94a3b8' }}>({branch?.name || '?'})</span>
              </div>
            );
          })}
        </SummarySection>
      )}
    </div>
  );
}

// ── Summary Section ──

function SummarySection({ title, count, children }: { title: string; count: string; children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 14 }}>{title}</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{count}</span>
      </div>
      {children}
    </div>
  );
}

// ── Helpers ──

function inputStyle(): React.CSSProperties {
  return {
    width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db',
    fontSize: 14, color: '#1e293b', backgroundColor: '#fff', outline: 'none',
    boxSizing: 'border-box',
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data:image/...;base64, prefix
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
