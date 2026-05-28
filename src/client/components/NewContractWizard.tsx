import { useState, useEffect, useCallback, useMemo } from 'react';
import type { AdobeSignLibraryDocument, AdobeSignFormField, ContractTerm, BcCustomerLite } from '../../shared/types.js';

interface Props {
  onNavigateToAgreements: () => void;
}

type Step = 'template' | 'fields' | 'terms' | 'recipients' | 'review';
const STEPS: { key: Step; label: string }[] = [
  { key: 'template', label: 'Select Templates' },
  { key: 'fields', label: 'Fill Fields' },
  { key: 'terms', label: 'Terms' },
  { key: 'recipients', label: 'Recipients' },
  { key: 'review', label: 'Review & Send' },
];

// Same normalisation/match logic as the backend so the wizard preview matches what the server does.
function normaliseFieldName(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
}
function fieldMatchesPrefix(fieldName: string, prefix: string): boolean {
  const n = normaliseFieldName(fieldName);
  const p = normaliseFieldName(prefix);
  return p.length > 0 && n.startsWith(p);
}

const inputCls = 'bg-[#272C33] text-neutral-200 text-[11px] rounded px-2.5 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';
const labelCls = 'text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block';
const btnPrimary = 'text-[11px] px-4 py-2 rounded bg-[#5ec1ca] text-[#272C33] font-medium hover:bg-[#4db0b9] transition-colors disabled:opacity-40';
const btnSecondary = 'text-[11px] px-4 py-2 rounded bg-[#2f353d] text-neutral-300 hover:bg-[#3a424d] transition-colors';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

type InputKind = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'radio' | 'email';

function normaliseType(s: string | undefined): string {
  return (s ?? '').toUpperCase().replace(/[_\-\s]/g, '');
}

function inputTypeFor(field: AdobeSignFormField): InputKind {
  if (field.multiLine === true || field.isMultiLine === true) return 'textarea';

  const ct = normaliseType(field.contentType);
  const it = normaliseType(field.inputType);
  const both = `${ct} ${it}`;

  if (both.includes('MULTILINE') || both.includes('TEXTAREA') || both.includes('PARAGRAPH')) return 'textarea';
  if (both.includes('CHECKBOX') || both.includes('CHECKMARK')) return 'checkbox';
  if (both.includes('RADIO')) return 'radio';
  if (both.includes('DROPDOWN') || both.includes('COMBOBOX') || both.includes('LIST')) return 'select';
  if (both.includes('DATE')) return 'date';
  if (both.includes('EMAIL')) return 'email';
  if (both.includes('NUMBER') || both.includes('NUMERIC')) return 'number';

  return 'text';
}

// A form field aggregated across the selected templates. originNames captures which
// templates contributed this field (Adobe links fields with the same name across docs).
type MergedField = AdobeSignFormField & { originNames: string[] };

// Adobe assigns each field to a participant role. NOVA's design follows
// Adobe's standard convention:
//   • PREFILL / SENDER / no assignee → filled by NOVA via mergeFieldInfo
//   • recipient0 onward → filled by the signer(s) in Adobe's signing UI
// Signature/initial/date-of-signing fields never reach here — backend filters
// them via SIGNER_ONLY_FIELD_TYPES.
function isSenderField(f: AdobeSignFormField): boolean {
  const raw = (f.assignee ?? '').trim().toUpperCase();
  return raw === '' || raw === 'PREFILL' || raw === 'SENDER';
}

// Map an Adobe form-field name (e.g. "COMPANY NAME BYM", "address_line_1_yomdel")
// to a BC customer property. Brand suffixes (BYM, YOMDEL, LEADPRO, etc.) are
// ignored — the patterns just look for the meaningful substring. First match wins.
const BC_FIELD_PATTERNS: Array<[RegExp, keyof BcCustomerLite]> = [
  [/customer\s*(?:no\.?|number|num|id)/i,    'number'],
  [/company\s*name|business\s*name|^company$/i, 'display_name'],
  [/reg(?:istration)?\s*(?:no\.?|number|num)|tax\s*reg(?:istration)?|vat\s*(?:no|number|reg)?/i, 'tax_registration_number'],
  [/address\s*(?:line\s*)?2/i,               'address_line_2'],
  [/address\s*(?:line\s*)?1|^address$|street/i, 'address'],
  [/post(?:al)?\s*code|^postcode$|zip\s*code|^zip$/i, 'postal_code'],
  [/^city$|^town$/i,                          'city'],
  [/county|state|province|region/i,           'state'],
  [/country/i,                                'country'],
  [/e[\-_]?mail/i,                            'email'],
  [/mobile|cell(?:phone)?/i,                  'phone_number'],  // Phase 2 will use a dedicated mobile field from contacts
  [/tel(?:ephone)?|^phone$|landline/i,        'phone_number'],
  [/contact\s*name|primary\s*contact|^contact$/i, 'primary_contact_name'],
];

// Returns the BC property name to fill from for a given Adobe field, or null if
// the field doesn't match any BC field — caller leaves those untouched.
function mapAdobeFieldToBcKey(adobeName: string): keyof BcCustomerLite | null {
  for (const [pattern, key] of BC_FIELD_PATTERNS) {
    if (pattern.test(adobeName)) return key;
  }
  return null;
}

export function NewContractWizard({ onNavigateToAgreements }: Props) {
  const [step, setStep] = useState<Step>('template');
  const [templates, setTemplates] = useState<AdobeSignLibraryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Multi-select: order matters — Adobe concatenates the bundle in this order.
  const [selectedTemplates, setSelectedTemplates] = useState<AdobeSignLibraryDocument[]>([]);
  // Cache form fields per template ID — fetched on first selection, kept across reorders/deselects.
  const [templateFields, setTemplateFields] = useState<Map<string, AdobeSignFormField[]>>(new Map());
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  const [contractName, setContractName] = useState('');
  const [signers, setSigners] = useState<Array<{ email: string; name: string }>>([{ email: '', name: '' }]);
  const [ccEmails, setCcEmails] = useState('');
  const [message, setMessage] = useState('');
  const [expirationDays, setExpirationDays] = useState('');
  const [sending, setSending] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState('');

  // Pre-approved contract terms
  const [allTerms, setAllTerms] = useState<ContractTerm[]>([]);
  const [selectedTermIds, setSelectedTermIds] = useState<Set<number>>(new Set());
  const [termsFieldPrefix, setTermsFieldPrefix] = useState<string>('contract terms');

  // BC customer picker — typeahead search over the local bc_customers cache.
  // Selecting a customer auto-fills any sender-fillable field whose name matches
  // a BC property (see BC_FIELD_PATTERNS).
  const [bcSearch, setBcSearch] = useState('');
  const [bcResults, setBcResults] = useState<BcCustomerLite[]>([]);
  const [bcSearchOpen, setBcSearchOpen] = useState(false);
  const [bcSearchLoading, setBcSearchLoading] = useState(false);
  const [selectedBcCustomer, setSelectedBcCustomer] = useState<BcCustomerLite | null>(null);
  const [autoFilledKeys, setAutoFilledKeys] = useState<Set<string>>(new Set());

  // Merged field list — union of all selected templates' fields, deduped by name, with origin tracking.
  const mergedFields = useMemo<MergedField[]>(() => {
    const map = new Map<string, MergedField>();
    for (const t of selectedTemplates) {
      const fields = templateFields.get(t.id) ?? [];
      for (const f of fields) {
        const existing = map.get(f.name);
        if (existing) {
          if (!existing.originNames.includes(t.name)) existing.originNames.push(t.name);
        } else {
          map.set(f.name, { ...f, originNames: [t.name] });
        }
      }
    }
    return Array.from(map.values());
  }, [selectedTemplates, templateFields]);

  // Split fields by who fills them. Sender fields appear as wizard inputs; signer
  // fields appear as a read-only "Signer will fill" panel so the user can see the
  // full picture but doesn't accidentally fill them.
  const senderFields = useMemo(() => mergedFields.filter(isSenderField), [mergedFields]);
  const signerFields = useMemo(() => mergedFields.filter(f => !isSenderField(f)), [mergedFields]);

  const fetchTemplates = useCallback(async (force = false) => {
    setLoading(true);
    setLoadError(null);
    try {
      const url = force ? '/api/adobe-sign/library-documents?refresh=1' : '/api/adobe-sign/library-documents';
      const res = await fetch(url);
      const json = await res.json();
      if (json.ok) {
        setTemplates(json.data ?? []);
      } else if (res.status === 429) {
        const retry = typeof json.retryAfter === 'number' ? json.retryAfter : 60;
        setLoadError(`Adobe Sign is rate-limiting us. Try again in ${retry}s.`);
      } else {
        setLoadError(json.error ?? 'Failed to load templates from Adobe Sign');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load templates');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(false); }, [fetchTemplates]);

  // Fetch terms catalog + prefix once on mount
  useEffect(() => {
    fetch('/api/contract-terms?activeOnly=1')
      .then(r => r.json())
      .then(j => { if (j.ok) setAllTerms(j.data ?? []); })
      .catch(() => { /* terms step will just show empty */ });
    fetch('/api/adobe-sign/terms-prefix')
      .then(r => r.json())
      .then(j => { if (j.ok && typeof j.data?.prefix === 'string') setTermsFieldPrefix(j.data.prefix); })
      .catch(() => { /* fall back to default */ });
  }, []);

  // BC customer search — debounced 250ms so we don't hammer the backend on each keystroke.
  // Empty query closes the dropdown without searching.
  useEffect(() => {
    const q = bcSearch.trim();
    if (!q) { setBcResults([]); return; }
    setBcSearchLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contracts/customers?search=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (json.ok) setBcResults((json.data ?? []).slice(0, 30));
      } catch { /* keep stale results — non-fatal */ }
      setBcSearchLoading(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [bcSearch]);

  // Auto-fill matching sender fields from a BC customer. Walks every sender-fillable
  // field, runs the field name through BC_FIELD_PATTERNS, and writes the BC value if
  // a match exists AND the BC field has a non-empty value. Records which fields were
  // auto-filled so we can show a visual indicator.
  const applyBcCustomer = useCallback((customer: BcCustomerLite) => {
    setSelectedBcCustomer(customer);
    setBcSearchOpen(false);
    setBcSearch(customer.display_name);
    setFieldValues(prev => {
      const next = { ...prev };
      const filled = new Set<string>();
      for (const f of senderFields) {
        const key = mapAdobeFieldToBcKey(f.name);
        if (!key) continue;
        const val = customer[key];
        if (val !== null && val !== undefined && String(val).trim() !== '') {
          next[f.name] = String(val);
          filled.add(f.name);
        }
      }
      setAutoFilledKeys(filled);
      return next;
    });
  }, [senderFields]);

  const clearBcCustomer = useCallback(() => {
    setSelectedBcCustomer(null);
    setBcSearch('');
    setBcResults([]);
    setAutoFilledKeys(new Set());
    // Don't wipe field values — sender may have edited them after auto-fill.
  }, []);

  // Concatenated terms text — selected terms joined by blank lines, in catalog order
  const concatenatedTerms = useMemo(() => {
    const selected = allTerms.filter(t => selectedTermIds.has(t.id));
    return selected.map(t => t.body.trim()).filter(b => b.length > 0).join('\n\n');
  }, [allTerms, selectedTermIds]);

  // Which fields across the selected templates will receive the terms
  const termsTargetFields = useMemo<Array<{ templateName: string; fieldName: string }>>(() => {
    const out: Array<{ templateName: string; fieldName: string }> = [];
    for (const t of selectedTemplates) {
      const fields = templateFields.get(t.id) ?? [];
      for (const f of fields) {
        if (fieldMatchesPrefix(f.name, termsFieldPrefix)) {
          out.push({ templateName: t.name, fieldName: f.name });
        }
      }
    }
    return out;
  }, [selectedTemplates, templateFields, termsFieldPrefix]);

  const filteredTemplates = templates.filter((t) =>
    !templateSearch.trim() ||
    t.name.toLowerCase().includes(templateSearch.toLowerCase())
  );

  const canProceed = (s: Step): boolean => {
    switch (s) {
      case 'template': return selectedTemplates.length > 0;
      // Only sender-filled required fields gate the wizard. Required signer fields
      // are the signer's problem, not ours. Required PREFILL fields left empty would
      // cause Adobe to park the agreement awaiting prefill, so we block here.
      case 'fields': return senderFields.filter(f => f.required).every(f => (fieldValues[f.name] ?? '').trim());
      case 'terms': return true;
      case 'recipients': return contractName.trim() !== '' && signers.some(s => s.email.trim());
      case 'review': return true;
      default: return false;
    }
  };

  const stepIdx = STEPS.findIndex(s => s.key === step);
  const goNext = () => { if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1].key); };
  const goBack = () => { if (stepIdx > 0) setStep(STEPS[stepIdx - 1].key); };

  const fetchTemplateFields = useCallback(async (templateId: string): Promise<AdobeSignFormField[]> => {
    try {
      const res = await fetch(`/api/adobe-sign/library-documents/${encodeURIComponent(templateId)}/form-fields`);
      const json = await res.json();
      if (json.ok) return json.data ?? [];
    } catch { /* Step 2 will fall back to empty state */ }
    return [];
  }, []);

  const toggleTemplate = useCallback(async (t: AdobeSignLibraryDocument) => {
    const wasSelected = selectedTemplates.some(s => s.id === t.id);
    if (wasSelected) {
      setSelectedTemplates(prev => prev.filter(s => s.id !== t.id));
      return;
    }
    // Adding: append to ordered list
    const newSelection = [...selectedTemplates, t];
    setSelectedTemplates(newSelection);
    // Auto-populate contract name from the first template (user can still edit)
    if (!contractName.trim() && newSelection.length === 1) setContractName(t.name);

    // Fetch this template's fields if not already cached
    if (!templateFields.has(t.id)) {
      setFieldsLoading(true);
      const fields = await fetchTemplateFields(t.id);
      setTemplateFields(prev => new Map(prev).set(t.id, fields));
      // Seed any default values for newly-discovered fields (don't overwrite user input)
      setFieldValues(prev => {
        const next = { ...prev };
        for (const f of fields) {
          if (f.defaultValue && next[f.name] === undefined) next[f.name] = f.defaultValue;
        }
        return next;
      });
      setFieldsLoading(false);
    }
  }, [selectedTemplates, templateFields, contractName, fetchTemplateFields]);

  const moveTemplateUp = (idx: number) => {
    if (idx <= 0) return;
    setSelectedTemplates(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveTemplateDown = (idx: number) => {
    setSelectedTemplates(prev => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const removeFromSelection = (idx: number) => {
    setSelectedTemplates(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSend = async () => {
    setSending(true);
    try {
      // Only send merge values for sender-assigned fields. Sending a value for a
      // signer-assigned field would overwrite what the signer is expected to enter
      // and confuse Adobe's routing.
      const mergeFields = senderFields.length > 0
        ? senderFields
            .filter(f => (fieldValues[f.name] ?? '').trim())
            .map(f => ({ fieldName: f.name, defaultValue: fieldValues[f.name] }))
        : undefined;

      const res = await fetch('/api/adobe-sign/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          library_document_ids: selectedTemplates.map(t => t.id),
          // bc_customer_id carries the BC link forward — once signed, the post-sign
          // handler reads this to know which BC customer the contract belongs to.
          bc_customer_id: selectedBcCustomer?.bc_id ?? undefined,
          name: contractName,
          signer_emails: signers.filter(s => s.email.trim()).map(s => s.email.trim()),
          cc_emails: ccEmails.split(',').map(e => e.trim()).filter(Boolean),
          message: message || undefined,
          merge_fields: mergeFields,
          expiration_days: expirationDays ? parseInt(expirationDays, 10) : undefined,
          contract_terms_text: concatenatedTerms || undefined,
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

  const resetWizard = () => {
    setSentId(null);
    setStep('template');
    setSelectedTemplates([]);
    setTemplateFields(new Map());
    setFieldValues({});
    setSigners([{ email: '', name: '' }]);
    setContractName('');
    setCcEmails('');
    setMessage('');
    setExpirationDays('');
    setSelectedTermIds(new Set());
  };

  const toggleTerm = (id: number) => {
    setSelectedTermIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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
            <button onClick={resetWizard} className={btnSecondary}>
              Send Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selectedCount = selectedTemplates.length;
  const isSelected = (t: AdobeSignLibraryDocument) => selectedTemplates.some(s => s.id === t.id);
  const orderIndex = (t: AdobeSignLibraryDocument) => selectedTemplates.findIndex(s => s.id === t.id);

  return (
    <div className="flex flex-col h-full">
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
                  {i < stepIdx ? '✓' : i + 1}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <div className="w-8 h-px bg-[#3a424d] mx-1" />}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {step === 'template' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-[14px] font-semibold text-neutral-100">Select Templates</h2>
                <p className="text-[11px] text-neutral-500 mt-0.5">
                  Pick one or more templates. They'll be bundled into a single agreement in the order shown below.
                </p>
              </div>
              <button onClick={() => fetchTemplates(true)} className={btnSecondary} disabled={loading}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            <input
              type="text"
              placeholder="Search templates..."
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              className={`${inputCls} max-w-sm mb-4`}
            />

            {/* Selected templates — ordered bundle list with reorder controls */}
            {selectedCount > 0 && (
              <div className="mb-5 rounded-lg border border-[#5ec1ca]/30 bg-[#5ec1ca]/5 p-3">
                <div className="text-[10px] text-[#5ec1ca] uppercase tracking-wider mb-2">
                  Bundle order — {selectedCount} {selectedCount === 1 ? 'template' : 'templates'}
                </div>
                <div className="space-y-1">
                  {selectedTemplates.map((t, idx) => (
                    <div key={t.id} className="flex items-center gap-2 bg-[#1e2228] rounded px-2 py-1.5 border border-[#3a424d]">
                      <span className="text-[10px] text-neutral-500 font-mono w-5">{idx + 1}.</span>
                      <span className="text-[11px] text-neutral-200 flex-1 truncate">{t.name}</span>
                      <button
                        onClick={() => moveTemplateUp(idx)}
                        disabled={idx === 0}
                        className="text-neutral-500 hover:text-[#5ec1ca] disabled:opacity-20 disabled:hover:text-neutral-500 text-[12px] leading-none px-1"
                        title="Move up"
                      >▲</button>
                      <button
                        onClick={() => moveTemplateDown(idx)}
                        disabled={idx === selectedCount - 1}
                        className="text-neutral-500 hover:text-[#5ec1ca] disabled:opacity-20 disabled:hover:text-neutral-500 text-[12px] leading-none px-1"
                        title="Move down"
                      >▼</button>
                      <button
                        onClick={() => removeFromSelection(idx)}
                        className="text-neutral-500 hover:text-red-400 text-sm leading-none px-1"
                        title="Remove from bundle"
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loading ? (
              <div className="text-neutral-500 text-[12px] py-8 text-center">Loading templates from Adobe Sign...</div>
            ) : loadError ? (
              <div className="text-amber-400 text-[12px] py-8 text-center max-w-md mx-auto">
                {loadError}
                <div className="text-neutral-500 text-[11px] mt-2">
                  Check that Adobe Sign is connected in Admin &gt; Integrations.
                </div>
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-neutral-500 text-[12px] py-8 text-center">
                {templates.length === 0
                  ? 'No library documents found in Adobe Sign. Create a template in Adobe Sign first.'
                  : 'No templates match your search.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredTemplates.map((t) => {
                  const sel = isSelected(t);
                  const order = orderIndex(t);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleTemplate(t)}
                      className={`text-left p-4 rounded-lg border transition-colors relative ${
                        sel
                          ? 'bg-[#5ec1ca]/10 border-[#5ec1ca]/40'
                          : 'bg-[#1e2228] border-[#3a424d] hover:border-[#5ec1ca]/30'
                      }`}
                    >
                      {sel && (
                        <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#5ec1ca] text-[#272C33] text-[10px] font-bold flex items-center justify-center">
                          {order + 1}
                        </span>
                      )}
                      <div className="text-[12px] font-medium text-neutral-200 mb-1 pr-7">{t.name}</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {(t.templateTypes ?? []).map((tt) => (
                          <span key={tt} className="text-[9px] px-1.5 py-0.5 rounded bg-[#2f353d] text-neutral-400">
                            {tt.replace(/_/g, ' ').toLowerCase()}
                          </span>
                        ))}
                      </div>
                      <div className="text-[10px] text-neutral-600 mt-2">Modified {fmtDate(t.modifiedDate)}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === 'fields' && selectedCount > 0 && (
          <div className="max-w-lg">
            <h2 className="text-[14px] font-semibold text-neutral-100 mb-1">Fill in Contract Details</h2>
            <p className="text-[11px] text-neutral-500 mb-4">
              {selectedCount === 1
                ? `Template: ${selectedTemplates[0].name}`
                : `Bundle of ${selectedCount} templates — fields with the same name across templates are linked.`}
            </p>

            {/* BC customer picker — search by name or customer number, auto-fills matching fields */}
            <div className="mb-5 rounded-lg border border-[#3a424d] bg-[#1e2228] p-3 relative">
              <div className="flex items-center justify-between mb-2">
                <label className={labelCls + ' mb-0'}>Auto-fill from Business Central customer</label>
                {selectedBcCustomer && (
                  <button onClick={clearBcCustomer} className="text-[10px] text-neutral-500 hover:text-red-400">
                    Clear
                  </button>
                )}
              </div>
              <input
                type="text"
                className={inputCls}
                placeholder="Search by company name or customer number..."
                value={bcSearch}
                onChange={(e) => { setBcSearch(e.target.value); setBcSearchOpen(true); }}
                onFocus={() => { if (bcResults.length > 0) setBcSearchOpen(true); }}
                onBlur={() => { setTimeout(() => setBcSearchOpen(false), 150); }}
              />
              {bcSearchOpen && (bcSearchLoading || bcResults.length > 0) && (
                <div className="absolute left-3 right-3 mt-1 max-h-72 overflow-auto rounded-lg border border-[#3a424d] bg-[#272C33] shadow-xl z-10">
                  {bcSearchLoading && (
                    <div className="px-3 py-2 text-[11px] text-neutral-500">Searching BC cache...</div>
                  )}
                  {!bcSearchLoading && bcResults.length === 0 && (
                    <div className="px-3 py-2 text-[11px] text-neutral-500">No matches in BC cache.</div>
                  )}
                  {bcResults.map((c) => (
                    <button
                      key={c.bc_id}
                      onMouseDown={() => applyBcCustomer(c)}
                      className="w-full text-left px-3 py-2 hover:bg-[#3a424d] border-b border-[#3a424d] last:border-b-0"
                    >
                      <div className="text-[11px] text-neutral-200">{c.display_name}</div>
                      <div className="text-[10px] text-neutral-500">
                        {c.number ? `#${c.number}` : 'No customer number'}
                        {c.city ? ` · ${c.city}` : ''}
                        {c.country ? `, ${c.country}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selectedBcCustomer && (
                <div className="mt-2 text-[10px] text-[#5ec1ca]">
                  ✓ Auto-filled {autoFilledKeys.size} {autoFilledKeys.size === 1 ? 'field' : 'fields'} from <span className="font-medium">{selectedBcCustomer.display_name}</span>
                  {autoFilledKeys.size === 0 && ' — no fields on this template matched BC customer properties.'}
                  . You can still edit any field below.
                </div>
              )}
            </div>

            {fieldsLoading ? (
              <div className="text-[12px] text-neutral-500 py-4">Loading fields from Adobe Sign...</div>
            ) : senderFields.length === 0 && signerFields.length === 0 ? (
              <div className="text-[12px] text-neutral-500 py-4">
                No merge fields on the selected templates. Signers will fill any fields directly when signing.
              </div>
            ) : (
              <div className="space-y-3">
                {senderFields.length === 0 && (
                  <div className="text-[12px] text-neutral-500 py-2">
                    Nothing for you to fill — every field on this template is assigned to the signer.
                  </div>
                )}
                {senderFields.map((f) => {
                  const inputType = inputTypeFor(f);
                  const value = fieldValues[f.name] ?? '';
                  const showOrigins = selectedCount > 1;
                  return (
                    <div key={f.name}>
                      <label className={labelCls}>
                        {f.displayLabel || f.name} {f.required && <span className="text-red-400">*</span>}
                        {autoFilledKeys.has(f.name) && (
                          <span className="ml-2 text-[9px] text-[#5ec1ca] normal-case">from BC</span>
                        )}
                      </label>
                      {inputType === 'select' ? (
                        <select
                          className={inputCls}
                          value={value}
                          onChange={(e) => setFieldValues({ ...fieldValues, [f.name]: e.target.value })}
                        >
                          <option value="">Select...</option>
                          {(f.options ?? []).map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : inputType === 'checkbox' ? (
                        <label className="flex items-center gap-2 text-[11px] text-neutral-300">
                          <input
                            type="checkbox"
                            checked={value === 'true' || value === 'on'}
                            onChange={(e) => setFieldValues({ ...fieldValues, [f.name]: e.target.checked ? 'true' : 'false' })}
                            className="accent-[#5ec1ca]"
                          />
                          {f.displayLabel || f.name}
                        </label>
                      ) : inputType === 'radio' && (f.options ?? []).length > 0 ? (
                        <div className="space-y-1">
                          {(f.options ?? []).map((opt) => (
                            <label key={opt} className="flex items-center gap-2 text-[11px] text-neutral-300">
                              <input
                                type="radio"
                                name={f.name}
                                value={opt}
                                checked={value === opt}
                                onChange={(e) => setFieldValues({ ...fieldValues, [f.name]: e.target.value })}
                                className="accent-[#5ec1ca]"
                              />
                              {opt}
                            </label>
                          ))}
                        </div>
                      ) : inputType === 'textarea' ? (
                        <textarea
                          ref={(el) => {
                            if (el) {
                              el.style.height = 'auto';
                              el.style.height = `${Math.max(el.scrollHeight, 60)}px`;
                            }
                          }}
                          className={`${inputCls} resize-none overflow-hidden`}
                          rows={3}
                          value={value}
                          onChange={(e) => {
                            setFieldValues({ ...fieldValues, [f.name]: e.target.value });
                            const t = e.currentTarget;
                            t.style.height = 'auto';
                            t.style.height = `${t.scrollHeight}px`;
                          }}
                          placeholder={f.defaultValue ?? ''}
                        />
                      ) : (
                        <input
                          className={inputCls}
                          type={inputType === 'date' ? 'date' : inputType === 'email' ? 'email' : inputType === 'number' ? 'number' : 'text'}
                          value={value}
                          onChange={(e) => setFieldValues({ ...fieldValues, [f.name]: e.target.value })}
                          placeholder={f.defaultValue ?? ''}
                        />
                      )}
                      {showOrigins && (
                        <div className="text-[9px] text-neutral-600 mt-1">
                          in: {f.originNames.join(', ')}
                        </div>
                      )}
                    </div>
                  );
                })}

                {signerFields.length > 0 && (
                  <div className="mt-6 rounded-lg border border-[#3a424d] bg-[#1e2228] p-3">
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-2">
                      Signer will fill ({signerFields.length})
                    </div>
                    <ul className="space-y-1">
                      {signerFields.map(f => (
                        <li key={f.name} className="text-[11px] text-neutral-400 flex items-baseline gap-2">
                          <span className="text-neutral-300">{f.displayLabel || f.name}</span>
                          {f.required && <span className="text-red-400">*</span>}
                          <span className="text-[9px] text-neutral-600 ml-auto">{f.assignee}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="text-[10px] text-neutral-600 mt-2">
                      These fields appear in the agreement for the signer to fill when they open it in Adobe Sign.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'terms' && (
          <div className="max-w-2xl">
            <h2 className="text-[14px] font-semibold text-neutral-100 mb-1">Contract Terms</h2>
            <p className="text-[11px] text-neutral-500 mb-4">
              Tick pre-approved terms to include in the contract. Selected terms get concatenated and inserted into any field on your selected template(s) whose name starts with <code className="text-neutral-300">{termsFieldPrefix}</code>.
            </p>

            {allTerms.length === 0 ? (
              <div className="text-[12px] text-neutral-500 py-4">
                No pre-approved terms configured yet. An admin can add them in Admin &gt; Adobe Sign &gt; Contract Terms.
              </div>
            ) : (
              <div className="space-y-2 mb-5">
                {allTerms.map((t) => {
                  const isChecked = selectedTermIds.has(t.id);
                  return (
                    <label
                      key={t.id}
                      className={`block p-3 rounded-lg border cursor-pointer transition-colors ${
                        isChecked ? 'bg-[#5ec1ca]/10 border-[#5ec1ca]/40' : 'bg-[#1e2228] border-[#3a424d] hover:border-[#5ec1ca]/30'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleTerm(t.id)}
                          className="accent-[#5ec1ca] mt-0.5 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium text-neutral-200 mb-1">{t.label}</div>
                          <div className="text-[10px] text-neutral-500 whitespace-pre-wrap line-clamp-3">{t.body}</div>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            {/* Live target diagnostic */}
            {selectedTermIds.size > 0 && (
              <div className="rounded-lg border border-[#3a424d] bg-[#1e2228] p-3 mb-3">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Target fields</div>
                {termsTargetFields.length === 0 ? (
                  <div className="text-[11px] text-amber-400">
                    None of your selected templates have a field starting with <code>{termsFieldPrefix}</code>. The selected terms won't appear in the signed contract.
                  </div>
                ) : (
                  <ul className="text-[11px] text-neutral-300 space-y-0.5">
                    {termsTargetFields.map((t, i) => (
                      <li key={i}><span className="text-neutral-500">{t.templateName} →</span> <code className="text-[#5ec1ca]">{t.fieldName}</code></li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {selectedTermIds.size > 0 && termsTargetFields.length > 0 && (
              <div className="rounded-lg border border-[#3a424d] bg-[#272C33] p-3">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Preview</div>
                <pre className="text-[11px] text-neutral-300 whitespace-pre-wrap font-sans">{concatenatedTerms}</pre>
              </div>
            )}
          </div>
        )}

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

        {step === 'review' && (
          <div className="max-w-lg">
            <h2 className="text-[14px] font-semibold text-neutral-100 mb-4">Review & Send</h2>

            <div className="space-y-4 bg-[#1e2228] rounded-lg border border-[#3a424d] p-4">
              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">
                  {selectedCount === 1 ? 'Template' : `Bundle (${selectedCount} templates, in order)`}
                </span>
                <div className="space-y-0.5">
                  {selectedTemplates.map((t, i) => (
                    <div key={t.id} className="text-[11px] text-neutral-200">
                      <span className="text-neutral-500 font-mono mr-2">{i + 1}.</span>{t.name}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">Agreement Name</span>
                <span className="text-[12px] text-neutral-200">{contractName}</span>
              </div>

              {senderFields.length > 0 && (
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">Pre-filled by NOVA</span>
                  <div className="space-y-1">
                    {senderFields.map((f) => (
                      <div key={f.name} className="flex items-baseline gap-2 text-[11px]">
                        <span className="text-neutral-500 min-w-[120px]">{f.displayLabel || f.name}:</span>
                        <span className="text-neutral-200">{fieldValues[f.name] || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {signerFields.length > 0 && (
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">Signer will fill ({signerFields.length})</span>
                  <div className="text-[11px] text-neutral-400">
                    {signerFields.map(f => f.displayLabel || f.name).join(', ')}
                  </div>
                </div>
              )}

              {selectedTermIds.size > 0 && (
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">
                    Contract Terms ({selectedTermIds.size} selected → {termsTargetFields.length} {termsTargetFields.length === 1 ? 'field' : 'fields'})
                  </span>
                  <div className="text-[11px] text-neutral-300">
                    {allTerms.filter(t => selectedTermIds.has(t.id)).map(t => t.label).join(', ')}
                  </div>
                  {termsTargetFields.length === 0 && (
                    <div className="text-[10px] text-amber-400 mt-1">
                      ⚠ No matching merge field on the selected templates — these terms won't appear in the signed contract.
                    </div>
                  )}
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
    </div>
  );
}
