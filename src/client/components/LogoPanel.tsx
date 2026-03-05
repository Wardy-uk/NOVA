import { useState, useEffect, useCallback, useRef } from 'react';
import { LOGO_TYPE_DEFS } from '../../shared/brand-settings-defs.js';

interface LogoMeta {
  id: number;
  delivery_id: number;
  logo_type: number;
  logo_label: string;
  mime_type: string;
  file_name: string | null;
  file_size: number | null;
  created_at: string;
}

interface Props {
  deliveryId: number;
}

const MAX_FILE_SIZE = 500 * 1024; // 500KB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];

export function LogoPanel({ deliveryId }: Props) {
  const [logos, setLogos] = useState<LogoMeta[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const token = localStorage.getItem('nova_token') || '';

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const json = await res.json();
        setEnabled(json.ok && json.data?.feature_instance_setup === 'true');
      } catch { setEnabled(false); }
    })();
  }, []);

  const fetchLogos = useCallback(async () => {
    try {
      const res = await fetch(`/api/logos/delivery/${deliveryId}`);
      const json = await res.json();
      if (json.ok) setLogos(json.data);
    } catch { /* ignore */ }
  }, [deliveryId]);

  useEffect(() => {
    if (enabled) fetchLogos();
  }, [fetchLogos, enabled]);

  if (enabled === null || enabled === false) return null;

  const handleUpload = async (logoType: number, file: File) => {
    setError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(`Unsupported file type: ${file.type}. Use PNG, JPEG, or SVG.`);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large (${(file.size / 1024).toFixed(0)}KB). Maximum is 500KB.`);
      return;
    }

    setUploading(logoType);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Extract base64 data after the comma in data:image/...;base64,XXXX
          const commaIdx = result.indexOf(',');
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch(`/api/logos/delivery/${deliveryId}/type/${logoType}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_data: base64,
          mime_type: file.type,
          file_name: file.name,
          file_size: file.size,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setLogos(json.data);
      } else {
        setError(json.error || 'Upload failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const handleDelete = async (logoType: number) => {
    try {
      const res = await fetch(`/api/logos/delivery/${deliveryId}/type/${logoType}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) setLogos(json.data);
    } catch { /* ignore */ }
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    return `${(bytes / 1024).toFixed(0)}KB`;
  };

  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-300">Logos & Images</span>
        <span className="text-[10px] text-neutral-500">{logos.length}/{LOGO_TYPE_DEFS.length} uploaded</span>
      </div>

      {error && (
        <div className="p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-[10px]">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {LOGO_TYPE_DEFS.map(typeDef => {
          const logo = logos.find(l => l.logo_type === typeDef.type);
          const isUploading = uploading === typeDef.type;

          return (
            <div key={typeDef.type} className="relative group">
              <input
                ref={el => { fileRefs.current[typeDef.type] = el; }}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(typeDef.type, file);
                  e.target.value = '';
                }}
              />

              {logo ? (
                // Uploaded — show thumbnail
                <div
                  className="border border-[#3a424d] rounded bg-[#1f242b] p-2 cursor-pointer hover:border-[#5ec1ca] transition-colors"
                  onClick={() => fileRefs.current[typeDef.type]?.click()}
                >
                  <img
                    src={`/api/logos/${logo.id}/image?token=${token}&_cb=${logo.file_size || logo.id}`}
                    alt={typeDef.label}
                    className="w-full h-16 object-contain rounded mb-1"
                  />
                  <div className="text-[9px] text-neutral-400 truncate">{typeDef.label}</div>
                  <div className="text-[8px] text-neutral-600 truncate">
                    {logo.file_name || ''} {formatSize(logo.file_size)}
                  </div>
                  {/* Delete overlay */}
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(typeDef.type); }}
                    className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-900/80 text-red-400 text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-800"
                    title="Remove"
                  >
                    &#x2715;
                  </button>
                </div>
              ) : (
                // Empty slot
                <div
                  className={`border-2 border-dashed rounded p-2 flex flex-col items-center justify-center h-24 cursor-pointer transition-colors ${
                    isUploading ? 'border-[#5ec1ca] bg-[#5ec1ca]/10' : 'border-[#3a424d] hover:border-neutral-500 bg-[#1f242b]'
                  }`}
                  onClick={() => !isUploading && fileRefs.current[typeDef.type]?.click()}
                >
                  {isUploading ? (
                    <span className="text-[10px] text-[#5ec1ca]">Uploading...</span>
                  ) : (
                    <>
                      <span className="text-lg text-neutral-600 mb-1">+</span>
                      <span className="text-[9px] text-neutral-500 text-center">{typeDef.label}</span>
                      <span className="text-[8px] text-neutral-600">{typeDef.description}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
