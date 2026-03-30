import { useState, useEffect, useCallback } from 'react';
import type { ContractTemplate, ContractTemplateFieldDef } from '../../shared/types.js';

interface Props {
  onNavigateToAgreements: () => void;
}

type Step = 'template' | 'fields' | 'recipients' | 'review';
const STEPS: { key: Step; label: string }[] = [
  { key: 'template', label: 'Select Template' },
  { key: 'fields', label: 'Fill Fields' },
  { key: 'recipients', label: 'Recipients' },
  { key: 'review', label: 'Review & Send' },
];

const inputCls = 'bg-[#272C33] text-neutral-200 text-[11px] rounded px-2.5 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';
const labelCls = 'text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block';
const btnPrimary = 'text-[11px] px-4 py-2 rounded bg-[#5ec1ca] text-[#272C33] font-medium hover:bg-[#4db0b9] transition-colors disabled:opacity-40';
const btnSecondary = 'text-[11px] px-4 py-2 rounded bg-[#2f353d] text-neutral-300 hover:bg-[#3a424d] transition-colors';

// ── Template Management Modal ──

function TemplateFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [adobeLibraryDocId, setAdobeLibraryDocId] = useState('');
  const [fields, setFields] = useState<ContractTemplateFieldDef[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const addField = () => {
    setFields([...fields, { key: `field_${fields.length + 1}`, label: '', type: 'text', required: false }]);
  };

  const updateField = (idx: number, updates: Partial<ContractTemplateFieldDef>) => {
    setFields(fields.map((f, i) => i === idx ? { ...f, ...updates } : f));
  };

  const removeField = (idx: number) => {
    setFields(fields.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);

    let fileBase64: string | undefined;
    let fileName: string | undefined;
    let fileMime: string | undefined;

    if (file) {
      const buf = await file.arrayBuffer();
      fileBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      fileName = file.name;
      fileMime = file.type;
    }

    try {
      const res = await fetch('/api/adobe-sign/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, description, category,
          fields_schema: fields.length > 0 ? fields : undefined,
          adobe_library_doc_id: adobeLibraryDocId || undefined,
          file_base64: fileBase64,
          file_name: fileName,
          file_mime: fileMime,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        onSaved();
        onClose();
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[#1e2228] rounded-xl border border-[#3a424d] w-[600px] max-h-[85vh] overflow-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3a424d]">
          <h3 className="text-[14px] font-semibold text-neutral-100">New Template</h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-lg">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={labelCls}>Name *</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard Service Agreement" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Category</label>
              <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. sales, nda, service" />
            </div>
            <div>
              <label className={labelCls}>Adobe Library Doc ID</label>
              <input className={inputCls} value={adobeLibraryDocId} onChange={(e) => setAdobeLibraryDocId(e.target.value)} placeholder="Optional — from Adobe Sign library" />
            </div>
          </div>

          <div>
            <label className={labelCls}>Description</label>
            <textarea className={`${inputCls} resize-none`} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this template used for?" />
          </div>

          <div>
            <label className={labelCls}>Document File</label>
            <input
              type="file"
              accept=".pdf,.docx,.doc"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-[11px] text-neutral-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-[11px] file:bg-[#2f353d] file:text-neutral-300 file:cursor-pointer hover:file:bg-[#3a424d]"
            />
            {!file && !adobeLibraryDocId && (
              <p className="text-[10px] text-amber-500/70 mt-1">Upload a PDF/DOCX or provide an Adobe Library Document ID</p>
            )}
          </div>

          {/* Dynamic Fields Definition */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls}>Merge Fields</label>
              <button onClick={addField} className="text-[10px] text-[#5ec1ca] hover:text-[#4db0b9]">+ Add Field</button>
            </div>
            {fields.length === 0 && (
              <p className="text-[10px] text-neutral-600">No fields defined. Add merge fields that users will fill in when creating a contract.</p>
            )}
            <div className="space-y-2">
              {fields.map((f, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-[#272C33] rounded p-2 border border-[#3a424d]">
                  <input
                    className="bg-transparent text-neutral-200 text-[11px] outline-none flex-1 min-w-0"
                    value={f.key}
                    onChange={(e) => updateField(idx, { key: e.target.value })}
                    placeholder="field_key"
                  />
                  <input
                    className="bg-transparent text-neutral-200 text-[11px] outline-none flex-1 min-w-0"
                    value={f.label}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                    placeholder="Display Label"
                  />
                  <select
                    className="bg-[#1e2228] text-neutral-300 text-[10px] rounded px-1.5 py-1 border border-[#3a424d] outline-none"
                    value={f.type}
                    onChange={(e) => updateField(idx, { type: e.target.value as ContractTemplateFieldDef['type'] })}
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="email">Email</option>
                    <option value="textarea">Textarea</option>
                    <option value="select">Select</option>
                  </select>
                  <label className="flex items-center gap-1 text-[10px] text-neutral-500">
                    <input
                      type="checkbox"
                      checked={f.required ?? false}
                      onChange={(e) => updateField(idx, { required: e.target.checked })}
                      className="accent-[#5ec1ca]"
                    />
                    Req
                  </label>
                  <button onClick={() => removeField(idx)} className="text-neutral-600 hover:text-red-400 text-sm">&times;</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#3a424d]">
          <button onClick={onClose} className={btnSecondary}>Cancel</button>
          <button onClick={handleSave} disabled={!name.trim() || saving} className={btnPrimary}>
            {saving ? 'Saving...' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Wizard ──

export function NewContractWizard({ onNavigateToAgreements }: Props) {
  const [step, setStep] = useState<Step>('template');
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTemplateForm, setShowTemplateForm] = useState(false);

  // Wizard state
  const [selectedTemplate, setSelectedTemplate] = useState<ContractTemplate | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [contractName, setContractName] = useState('');
  const [signers, setSigners] = useState<Array<{ email: string; name: string }>>([{ email: '', name: '' }]);
  const [ccEmails, setCcEmails] = useState('');
  const [message, setMessage] = useState('');
  const [expirationDays, setExpirationDays] = useState('');
  const [sending, setSending] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState('');

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/adobe-sign/templates?status=active');
      const json = await res.json();
      if (json.ok) setTemplates(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const parsedFields: ContractTemplateFieldDef[] = (() => {
    if (!selectedTemplate?.fields_schema) return [];
    try { return JSON.parse(selectedTemplate.fields_schema); } catch { return []; }
  })();

  const filteredTemplates = templates.filter((t) =>
    !templateSearch.trim() ||
    t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
    (t.category ?? '').toLowerCase().includes(templateSearch.toLowerCase())
  );

  // Step validation
  const canProceed = (s: Step): boolean => {
    switch (s) {
      case 'template': return selectedTemplate !== null;
      case 'fields': return parsedFields.filter(f => f.required).every(f => fieldValues[f.key]?.trim());
      case 'recipients': return contractName.trim() !== '' && signers.some(s => s.email.trim());
      case 'review': return true;
      default: return false;
    }
  };

  const stepIdx = STEPS.findIndex(s => s.key === step);
  const goNext = () => { if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1].key); };
  const goBack = () => { if (stepIdx > 0) setStep(STEPS[stepIdx - 1].key); };

  const handleSelectTemplate = (t: ContractTemplate) => {
    setSelectedTemplate(t);
    // Pre-populate field defaults
    try {
      const fields: ContractTemplateFieldDef[] = JSON.parse(t.fields_schema ?? '[]');
      const defaults: Record<string, string> = {};
      for (const f of fields) {
        if (f.defaultValue) defaults[f.key] = f.defaultValue;
      }
      setFieldValues(defaults);
    } catch { setFieldValues({}); }
    setContractName(t.name);
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const mergeFields = parsedFields.length > 0
        ? parsedFields.map(f => ({ fieldName: f.key, defaultValue: fieldValues[f.key] ?? '' }))
        : undefined;

      const res = await fetch('/api/adobe-sign/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: selectedTemplate?.id,
          name: contractName,
          signer_emails: signers.filter(s => s.email.trim()).map(s => s.email.trim()),
          cc_emails: ccEmails.split(',').map(e => e.trim()).filter(Boolean),
          message: message || undefined,
          merge_fields: mergeFields,
          expiration_days: expirationDays ? parseInt(expirationDays, 10) : undefined,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSentId(json.data.agreement_id);
      } else {
        alert(json.error ?? 'Failed to send agreement');
      }
    } catch (err) {
      alert('Failed to send: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    setSending(false);
  };

  const addSigner = () => setSigners([...signers, { email: '', name: '' }]);
  const removeSigner = (idx: number) => setSigners(signers.filter((_, i) => i !== idx));
  const updateSigner = (idx: number, updates: Partial<{ email: string; name: string }>) => {
    setSigners(signers.map((s, i) => i === idx ? { ...s, ...updates } : s));
  };

  // ── Sent confirmation ──
  if (sentId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-green-900/30 border border-green-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-[16px] font-semibold text-neutral-100">Agreement Sent</h2>
          <p className="text-[12px] text-neutral-400 max-w-sm">
            Your agreement has been sent for signature via Adobe Sign. Track its status in the Adobe Sign tab.
          </p>
          <p className="text-[10px] text-neutral-600 font-mono">{sentId}</p>
          <div className="flex justify-center gap-3 pt-2">
            <button onClick={onNavigateToAgreements} className={btnPrimary}>
              View Agreements
            </button>
            <button onClick={() => { setSentId(null); setStep('template'); setSelectedTemplate(null); setFieldValues({}); setSigners([{ email: '', name: '' }]); setContractName(''); }} className={btnSecondary}>
              Send Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Step Indicator */}
      <div className="px-6 pt-4 pb-3 border-b border-[#3a424d]">
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <button
                onClick={() => { if (i <= stepIdx) setStep(s.key); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-[11px] transition-colors ${
                  step === s.key
                    ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] border border-[#5ec1ca]/30'
                    : i < stepIdx
                    ? 'text-neutral-300 hover:text-[#5ec1ca]'
                    : 'text-neutral-600'
                }`}
                disabled={i > stepIdx}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium ${
                  i < stepIdx ? 'bg-[#5ec1ca] text-[#272C33]' : i === stepIdx ? 'bg-[#5ec1ca]/20 text-[#5ec1ca]' : 'bg-[#2f353d] text-neutral-600'
                }`}>
                  {i < stepIdx ? '\u2713' : i + 1}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <div className="w-8 h-px bg-[#3a424d] mx-1" />}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Step 1: Select Template */}
        {step === 'template' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-[14px] font-semibold text-neutral-100">Select a Template</h2>
                <p className="text-[11px] text-neutral-500 mt-0.5">Choose a contract template to begin</p>
              </div>
              <button onClick={() => setShowTemplateForm(true)} className={btnSecondary}>
                + New Template
              </button>
            </div>

            <input
              type="text"
              placeholder="Search templates..."
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              className={`${inputCls} max-w-sm mb-4`}
            />

            {loading ? (
              <div className="text-neutral-500 text-[12px] py-8 text-center">Loading templates...</div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-neutral-500 text-[12px] py-8 text-center">
                No templates yet. Create one to get started.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredTemplates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleSelectTemplate(t)}
                    className={`text-left p-4 rounded-lg border transition-colors ${
                      selectedTemplate?.id === t.id
                        ? 'bg-[#5ec1ca]/10 border-[#5ec1ca]/40'
                        : 'bg-[#1e2228] border-[#3a424d] hover:border-[#5ec1ca]/30'
                    }`}
                  >
                    <div className="text-[12px] font-medium text-neutral-200 mb-1">{t.name}</div>
                    {t.description && <div className="text-[10px] text-neutral-500 mb-2 line-clamp-2">{t.description}</div>}
                    <div className="flex items-center gap-2">
                      {t.category && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#2f353d] text-neutral-400">{t.category}</span>
                      )}
                      {(t.file_name || t.adobe_library_doc_id) && (
                        <span className="text-[9px] text-neutral-600">{t.file_name ?? 'Adobe Library'}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Fill Fields */}
        {step === 'fields' && selectedTemplate && (
          <div className="max-w-lg">
            <h2 className="text-[14px] font-semibold text-neutral-100 mb-1">Fill in Contract Details</h2>
            <p className="text-[11px] text-neutral-500 mb-4">Template: {selectedTemplate.name}</p>

            {parsedFields.length === 0 ? (
              <div className="text-[12px] text-neutral-500 py-4">
                This template has no merge fields. You can proceed to the next step.
              </div>
            ) : (
              <div className="space-y-3">
                {parsedFields.map((f) => (
                  <div key={f.key}>
                    <label className={labelCls}>
                      {f.label || f.key} {f.required && <span className="text-red-400">*</span>}
                    </label>
                    {f.type === 'textarea' ? (
                      <textarea
                        className={`${inputCls} resize-none`}
                        rows={3}
                        value={fieldValues[f.key] ?? ''}
                        onChange={(e) => setFieldValues({ ...fieldValues, [f.key]: e.target.value })}
                        placeholder={f.defaultValue ?? ''}
                      />
                    ) : f.type === 'select' ? (
                      <select
                        className={inputCls}
                        value={fieldValues[f.key] ?? ''}
                        onChange={(e) => setFieldValues({ ...fieldValues, [f.key]: e.target.value })}
                      >
                        <option value="">Select...</option>
                        {(f.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={inputCls}
                        type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'}
                        value={fieldValues[f.key] ?? ''}
                        onChange={(e) => setFieldValues({ ...fieldValues, [f.key]: e.target.value })}
                        placeholder={f.defaultValue ?? ''}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Recipients */}
        {step === 'recipients' && (
          <div className="max-w-lg">
            <h2 className="text-[14px] font-semibold text-neutral-100 mb-4">Recipients</h2>

            <div className="mb-4">
              <label className={labelCls}>Agreement Name *</label>
              <input
                className={inputCls}
                value={contractName}
                onChange={(e) => setContractName(e.target.value)}
                placeholder="e.g. Service Agreement — Acme Corp"
              />
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className={labelCls}>Signers *</label>
                <button onClick={addSigner} className="text-[10px] text-[#5ec1ca] hover:text-[#4db0b9]">+ Add Signer</button>
              </div>
              <div className="space-y-2">
                {signers.map((s, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      className={`${inputCls} flex-1`}
                      placeholder="Email address"
                      type="email"
                      value={s.email}
                      onChange={(e) => updateSigner(idx, { email: e.target.value })}
                    />
                    <input
                      className={`${inputCls} flex-1`}
                      placeholder="Name (optional)"
                      value={s.name}
                      onChange={(e) => updateSigner(idx, { name: e.target.value })}
                    />
                    {signers.length > 1 && (
                      <button onClick={() => removeSigner(idx)} className="text-neutral-600 hover:text-red-400 text-sm">&times;</button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-neutral-600 mt-1">Signers will receive the document in order (1st signer signs first)</p>
            </div>

            <div className="mb-4">
              <label className={labelCls}>CC Emails</label>
              <input
                className={inputCls}
                value={ccEmails}
                onChange={(e) => setCcEmails(e.target.value)}
                placeholder="Comma-separated email addresses"
              />
            </div>

            <div className="mb-4">
              <label className={labelCls}>Message to Signers</label>
              <textarea
                className={`${inputCls} resize-none`}
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Optional message included in the signing email"
              />
            </div>

            <div>
              <label className={labelCls}>Expiration (days)</label>
              <input
                className={`${inputCls} max-w-[120px]`}
                type="number"
                min="1"
                value={expirationDays}
                onChange={(e) => setExpirationDays(e.target.value)}
                placeholder="e.g. 30"
              />
            </div>
          </div>
        )}

        {/* Step 4: Review & Send */}
        {step === 'review' && (
          <div className="max-w-lg">
            <h2 className="text-[14px] font-semibold text-neutral-100 mb-4">Review & Send</h2>

            <div className="space-y-4 bg-[#1e2228] rounded-lg border border-[#3a424d] p-4">
              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">Template</span>
                <span className="text-[12px] text-neutral-200">{selectedTemplate?.name}</span>
              </div>

              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">Agreement Name</span>
                <span className="text-[12px] text-neutral-200">{contractName}</span>
              </div>

              {parsedFields.length > 0 && (
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">Merge Fields</span>
                  <div className="space-y-1">
                    {parsedFields.map((f) => (
                      <div key={f.key} className="flex items-baseline gap-2 text-[11px]">
                        <span className="text-neutral-500 min-w-[120px]">{f.label || f.key}:</span>
                        <span className="text-neutral-200">{fieldValues[f.key] || '\u2014'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">Signers</span>
                {signers.filter(s => s.email.trim()).map((s, i) => (
                  <div key={i} className="text-[11px] text-neutral-200">
                    {i + 1}. {s.email} {s.name && <span className="text-neutral-500">({s.name})</span>}
                  </div>
                ))}
              </div>

              {ccEmails.trim() && (
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">CC</span>
                  <span className="text-[11px] text-neutral-300">{ccEmails}</span>
                </div>
              )}

              {message && (
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">Message</span>
                  <span className="text-[11px] text-neutral-300">{message}</span>
                </div>
              )}

              {expirationDays && (
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">Expires In</span>
                  <span className="text-[11px] text-neutral-300">{expirationDays} days</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-[#3a424d]">
        <div>
          {stepIdx > 0 && (
            <button onClick={goBack} className={btnSecondary}>Back</button>
          )}
        </div>
        <div>
          {step === 'review' ? (
            <button onClick={handleSend} disabled={sending} className={btnPrimary}>
              {sending ? 'Sending...' : 'Send for Signature'}
            </button>
          ) : (
            <button onClick={goNext} disabled={!canProceed(step)} className={btnPrimary}>
              Continue
            </button>
          )}
        </div>
      </div>

      {/* Template Form Modal */}
      {showTemplateForm && (
        <TemplateFormModal
          onClose={() => setShowTemplateForm(false)}
          onSaved={fetchTemplates}
        />
      )}
    </div>
  );
}
