import React, { useEffect, useState, useRef, useCallback } from 'react';

interface Props {
  onCreated: (ticketKey: string) => void;
}

interface Category {
  id: string;
  name: string;
  description?: string;
  children: Array<{ id: string; name: string }>;
}

interface UploadedFile {
  file: File;
  preview?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = '.png,.jpg,.jpeg,.gif,.pdf,.doc,.docx,.xlsx,.csv,.txt,.zip,.log';

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export default function PortalNewRequest({ onCreated }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [description, setDescription] = useState('');
  const [account, setAccount] = useState('');
  const [url, setUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [urgency, setUrgency] = useState<'Normal' | 'High' | 'Critical'>('Normal');
  const [contactPreference, setContactPreference] = useState<'portal' | 'email' | 'phone'>('portal');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [kbSuggestions, setKbSuggestions] = useState<Array<{ id: number; title: string; excerpt: string }>>([]);
  const [showKbSuggestions, setShowKbSuggestions] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    pf('/api/portal/categories')
      .then(r => r.json())
      .then(data => { if (data.ok) setCategories(data.data); })
      .catch(console.error);
  }, []);

  const selectedCategory = categories.find(c => c.id === category);
  const showUrl = ['website', 'leadpro', 'data_feeds', 'listings'].includes(category);
  const showBrowser = ['website'].includes(category);

  const browserInfo = `${navigator.userAgent.match(/Chrome\/[\d.]+|Firefox\/[\d.]+|Safari\/[\d.]+|Edge\/[\d.]+/)?.[0] || 'Unknown'}`;
  const osInfo = navigator.platform;

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const toAdd: UploadedFile[] = [];
    for (const file of Array.from(newFiles)) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`${file.name} exceeds 10MB limit`);
        continue;
      }
      const entry: UploadedFile = { file };
      if (isImageFile(file)) {
        entry.preview = URL.createObjectURL(file);
      }
      toAdd.push(entry);
    }
    setFiles(prev => [...prev, ...toAdd]);
  }, []);

  const removeFile = (index: number) => {
    setFiles(prev => {
      const removed = prev[index];
      if (removed.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handlePreSubmitKbCheck = async () => {
    if (subject.length < 5 && description.length < 10) return;

    try {
      const q = `${subject} ${category} ${description}`.slice(0, 200);
      const res = await pf(`/api/portal/kb/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.ok && data.data.articles.length > 0) {
        setKbSuggestions(data.data.articles.slice(0, 3));
        setShowKbSuggestions(true);
      }
    } catch { /* ignore */ }
  };

  const uploadAttachments = async (ticketKey: string) => {
    for (const { file } of files) {
      const formData = new FormData();
      formData.append('file', file);
      try {
        await pf(`/api/portal/tickets/${ticketKey}/attachments`, {
          method: 'POST',
          body: formData,
        });
      } catch {
        console.warn(`Failed to upload ${file.name}`);
      }
    }
  };

  const handleSubmit = async () => {
    if (!subject || !category || !description) {
      setError('Please fill in all required fields.');
      return;
    }

    if (!showKbSuggestions && kbSuggestions.length === 0) {
      await handlePreSubmitKbCheck();
      if (kbSuggestions.length > 0) return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await pf('/api/portal/tickets', {
        method: 'POST',
        body: JSON.stringify({
          subject,
          category,
          subcategory: subcategory || undefined,
          description,
          account: account || undefined,
          url: url || undefined,
          errorMessage: errorMessage || undefined,
          urgency,
          contactPreference,
          browser: showBrowser ? browserInfo : undefined,
          os: showBrowser ? osInfo : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (files.length > 0) {
          await uploadAttachments(data.data.ticketKey);
        }
        setSuccess(data.data.ticketKey);
      } else {
        setError(data.error || 'Failed to create ticket');
      }
    } catch {
      setError('Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Request Submitted</h2>
        <p className="text-gray-600 mb-6">
          Your ticket <span className="font-mono font-medium text-brand">{success}</span> has been created.
          Our team will review it shortly.
        </p>
        <button
          onClick={() => onCreated(success)}
          className="px-6 py-2 bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors"
        >
          View Ticket
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Support Request</h1>

      {/* KB Suggestions */}
      {showKbSuggestions && kbSuggestions.length > 0 && (
        <div className="mb-6 p-4 bg-teal-50 border border-teal-200 rounded-xl">
          <h3 className="text-sm font-medium text-teal-800 mb-3">
            We found some articles that might help:
          </h3>
          <div className="space-y-2">
            {kbSuggestions.map(a => (
              <div key={a.id} className="bg-white rounded-lg p-3 border border-teal-100">
                <div className="text-sm font-medium text-gray-900">{a.title}</div>
                <div className="text-xs text-gray-500 mt-1 line-clamp-2">{a.excerpt}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-3">
            <button
              onClick={() => { setShowKbSuggestions(false); setKbSuggestions([]); }}
              className="text-sm text-teal-700 font-medium hover:text-teal-800"
            >
              No, I still need help
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        {/* Subject */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Brief summary of your issue"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">What do you need help with? *</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {categories.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => { setCategory(c.id); setSubcategory(''); }}
                className={`text-left p-3 rounded-lg border transition-all text-sm ${
                  category === c.id
                    ? 'border-brand bg-brand/5 ring-1 ring-brand'
                    : 'border-gray-200 hover:border-brand/40 hover:bg-gray-50'
                }`}
              >
                <div className="font-medium text-gray-900">{c.name}</div>
                {c.description && (
                  <div className="text-xs text-gray-500 mt-0.5">{c.description}</div>
                )}
              </button>
            ))}
          </div>
        </div>
        {selectedCategory && selectedCategory.children.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">More specifically</label>
            <select
              value={subcategory}
              onChange={e => setSubcategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm"
            >
              <option value="">Select an option</option>
              {selectedCategory.children.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Account */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Account / Site</label>
          <input
            type="text"
            value={account}
            onChange={e => setAccount(e.target.value)}
            placeholder="Which account or site is affected?"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What should be happening vs what is happening?"
            rows={5}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm resize-none"
          />
        </div>

        {/* URL */}
        {showUrl && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL / Page</label>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm"
            />
          </div>
        )}

        {/* Error message */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Error message (if any)</label>
          <input
            type="text"
            value={errorMessage}
            onChange={e => setErrorMessage(e.target.value)}
            placeholder="Copy and paste the error message"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm"
          />
        </div>

        {/* File Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Screenshots / Files</label>
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragging ? 'border-brand bg-brand/5' : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <svg className="w-8 h-8 mx-auto text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-gray-600">Drop files here or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">Max 10MB per file</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES}
              onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
              className="hidden"
            />
          </div>

          {files.length > 0 && (
            <div className="mt-3 space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                  {f.preview ? (
                    <img src={f.preview} alt="" className="w-10 h-10 object-cover rounded" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-gray-200 flex items-center justify-center">
                      <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-700 truncate">{f.file.name}</div>
                    <div className="text-xs text-gray-400">{formatFileSize(f.file.size)}</div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); removeFile(i); }}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Urgency + Contact Preference */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Urgency</label>
            <select
              value={urgency}
              onChange={e => setUrgency(e.target.value as 'Normal' | 'High' | 'Critical')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm"
            >
              <option value="Normal">Normal</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact preference</label>
            <select
              value={contactPreference}
              onChange={e => setContactPreference(e.target.value as 'portal' | 'email' | 'phone')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm"
            >
              <option value="portal">Portal reply</option>
              <option value="email">Email</option>
              <option value="phone">Phone callback</option>
            </select>
          </div>
        </div>

        {/* Browser info (auto-detected) */}
        {showBrowser && (
          <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
            Detected: {browserInfo} on {osInfo}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={handleSubmit}
            disabled={submitting || !subject || !category || !description}
            className="px-6 py-2.5 bg-brand text-white font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
