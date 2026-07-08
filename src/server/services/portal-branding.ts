import type { PortalOrgBranding } from '../../shared/portal-types.js';

// Best-effort branding extraction from an organisation's website. Everything here
// is a *suggestion* — the admin reviews/edits before saving. We only parse text
// (HTML + CSS), never decode images, so results are honest-but-imperfect:
//   logo   — apple-touch-icon / og:image / <link rel=icon> / favicon (→ data URI)
//   colour — <meta theme-color>, then CSS custom properties (--primary/--brand…)
//   font   — Google Fonts <link>, then first non-generic font-family in CSS

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_LOGO_BYTES = 400_000;
const UA = 'Mozilla/5.0 (compatible; NovaPortalBranding/1.0)';

function normaliseUrl(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

async function fetchText(url: string): Promise<{ body: string; finalUrl: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,text/css,*/*' }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_HTML_BYTES);
    return { body: buf.toString('utf-8'), finalUrl: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function resolveUrl(href: string, base: string): string | null {
  try { return new URL(href, base).toString(); } catch { return null; }
}

function normaliseHex(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim().toLowerCase();
  const m = v.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/);
  if (!m) return null;
  v = '#' + m[1];
  if (v.length === 4) v = '#' + v.slice(1).split('').map(c => c + c).join('');
  return v;
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  return m ? m[1] : null;
}

function extractThemeColour(html: string): string | null {
  const meta = firstMatch(html, /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)
    || firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i);
  return normaliseHex(meta);
}

// Scan CSS text for custom properties that look like brand/primary/secondary.
function extractCssColours(css: string): { primary: string | null; secondary: string | null } {
  const grab = (names: string[]) => {
    for (const n of names) {
      const m = new RegExp(`--(?:${n})\\s*:\\s*(#[0-9a-fA-F]{3,6})`, 'i').exec(css);
      const hex = normaliseHex(m?.[1]);
      if (hex) return hex;
    }
    return null;
  };
  return {
    primary: grab(['primary', 'brand', 'color-primary', 'colour-primary', 'brand-primary', 'accent', 'main']),
    secondary: grab(['secondary', 'color-secondary', 'colour-secondary', 'brand-secondary', 'accent-2', 'accent2']),
  };
}

function extractFont(html: string, css: string): string | null {
  // Google Fonts link: family=Name+Here
  const gf = firstMatch(html, /fonts\.googleapis\.com\/css2?\?[^"']*family=([^:"'&]+)/i);
  if (gf) return decodeURIComponent(gf.replace(/\+/g, ' ')).trim();
  // First non-generic font-family in CSS
  const ff = firstMatch(css, /font-family\s*:\s*["']?([^"',;}]+)["']?/i);
  if (ff) {
    const name = ff.trim();
    if (!/^(inherit|sans-serif|serif|monospace|system-ui|ui-sans-serif|-apple-system|arial|helvetica)$/i.test(name)) return name;
  }
  return null;
}

function extractLogoCandidates(html: string, base: string): string[] {
  const out: string[] = [];
  const push = (href: string | null) => { const u = href && resolveUrl(href, base); if (u) out.push(u); };
  // apple-touch-icon (usually the crispest square logo)
  const iconRe = /<link[^>]+rel=["']([^"']*icon[^"']*)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  const icons: string[] = [];
  while ((m = iconRe.exec(html))) {
    const hrefM = /href=["']([^"']+)["']/i.exec(m[0]);
    if (hrefM) icons.push(hrefM[1]);
  }
  const apple = icons.find(h => /apple-touch/i.test(h));
  push(apple || null);
  // og:image
  push(firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i));
  // remaining icons
  for (const h of icons) push(h);
  // favicon fallback
  push('/favicon.ico');
  return [...new Set(out)];
}

async function fetchLogoDataUri(candidates: string[]): Promise<string | null> {
  for (const url of candidates) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') || '';
      if (!/^image\//i.test(type)) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) { if (buf.length > MAX_LOGO_BYTES) return url; continue; }
      return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
    } catch {
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export async function fetchOrgBranding(inputUrl: string): Promise<PortalOrgBranding> {
  const websiteUrl = normaliseUrl(inputUrl);
  const empty: PortalOrgBranding = { websiteUrl, logoUrl: null, primary: null, secondary: null, font: null };

  const page = await fetchText(websiteUrl);
  if (!page) return empty;
  const html = page.body;
  const base = page.finalUrl;

  // Pull a couple of linked stylesheets for colour/font hints (bounded).
  const cssLinks: string[] = [];
  const linkRe = /<link[^>]+rel=["']stylesheet["'][^>]*>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html)) && cssLinks.length < 2) {
    const href = /href=["']([^"']+)["']/i.exec(lm[0])?.[1];
    const u = href && resolveUrl(href, base);
    if (u) cssLinks.push(u);
  }
  const inlineStyle = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []).join('\n');
  let css = inlineStyle;
  for (const link of cssLinks) {
    const sheet = await fetchText(link);
    if (sheet) css += '\n' + sheet.body;
  }

  const cssColours = extractCssColours(css);
  const [logoUrl] = await Promise.all([fetchLogoDataUri(extractLogoCandidates(html, base))]);

  return {
    websiteUrl,
    logoUrl,
    primary: extractThemeColour(html) || cssColours.primary,
    secondary: cssColours.secondary,
    font: extractFont(html, css),
  };
}
