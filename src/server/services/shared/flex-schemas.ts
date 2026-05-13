import { z } from 'zod';

export const flexEnum = <T extends string>(values: readonly [T, ...T[]]) =>
  z.any().transform((val): T => {
    if (typeof val === 'string') {
      const lower = val.toLowerCase() as T;
      if ((values as readonly string[]).includes(lower)) return lower;
      if ((values as readonly string[]).includes(val)) return val as T;
      for (const v of values) { if (v.toLowerCase() === lower) return v; }
    }
    if (val && typeof val === 'object') {
      const candidate = val.value ?? val.type ?? val.level ?? val.name ?? val.label;
      if (typeof candidate === 'string') {
        for (const v of values) { if (v.toLowerCase() === candidate.toLowerCase()) return v; }
      }
    }
    return values[values.length - 1];
  });

export const flexScore = (min: number, max: number) => z.any().transform((val): number => {
  if (typeof val === 'number') return Math.max(min, Math.min(max, val));
  if (typeof val === 'string') { const n = parseFloat(val); return isNaN(n) ? min : Math.max(min, Math.min(max, n)); }
  if (val && typeof val === 'object') {
    const c = val.score ?? val.value;
    if (typeof c === 'number') return Math.max(min, Math.min(max, c));
  }
  return min;
});

export const flexIntScore = (min: number, max: number) => z.any().transform((val): number => {
  if (typeof val === 'number') return Math.max(min, Math.min(max, Math.round(val)));
  if (typeof val === 'string') { const n = parseInt(val, 10); return isNaN(n) ? min : Math.max(min, Math.min(max, n)); }
  if (val && typeof val === 'object') {
    const c = val.score ?? val.value;
    if (typeof c === 'number') return Math.max(min, Math.min(max, Math.round(c)));
  }
  return min;
});

export const flexString = z.any().transform((val): string => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.summary ?? val.value ?? val.text ?? JSON.stringify(val);
  return String(val ?? '');
});

export const flexBool = z.any().transform((val): boolean => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'yes';
  return false;
});

export const flexNullableString = z.any().transform((val): string | null => {
  if (val === null || val === undefined || val === 'null' || val === 'none' || val === 'N/A') return null;
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.value ?? val.text ?? JSON.stringify(val);
  return String(val ?? '');
});
