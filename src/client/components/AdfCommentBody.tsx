import { useMemo } from 'react';
import { adfToHtml } from '../utils/adf-to-html.js';

const ADF_STYLES = `
  .adf-comment p { margin: 0.25em 0; }
  .adf-comment h1, .adf-comment h2, .adf-comment h3,
  .adf-comment h4, .adf-comment h5, .adf-comment h6 {
    margin: 0.5em 0 0.25em; font-weight: 600;
  }
  .adf-comment ul, .adf-comment ol { margin: 0.25em 0; padding-left: 1.5em; }
  .adf-comment li { margin: 0.1em 0; }
  .adf-comment pre { background: rgba(0,0,0,0.3); padding: 0.5em; border-radius: 4px; overflow-x: auto; font-size: 0.85em; }
  .adf-comment code { background: rgba(0,0,0,0.2); padding: 0.1em 0.3em; border-radius: 2px; font-size: 0.9em; }
  .adf-comment pre code { background: none; padding: 0; }
  .adf-comment blockquote { border-left: 3px solid rgba(255,255,255,0.2); padding-left: 0.75em; margin: 0.25em 0; opacity: 0.8; }
  .adf-comment a { color: #5ec1ca; text-decoration: underline; }
  .adf-comment .mention { color: #9b6aed; font-weight: 500; }
  .adf-comment table { border-collapse: collapse; margin: 0.25em 0; width: 100%; }
  .adf-comment th, .adf-comment td { border: 1px solid rgba(255,255,255,0.15); padding: 0.3em 0.5em; text-align: left; }
  .adf-comment th { background: rgba(255,255,255,0.05); font-weight: 600; }
  .adf-comment .adf-image { max-width: 100%; height: auto; border-radius: 4px; margin: 0.25em 0; cursor: pointer; }
  .adf-comment .adf-image:hover { opacity: 0.9; }
  .adf-comment hr { border: none; border-top: 1px solid rgba(255,255,255,0.15); margin: 0.5em 0; }
`;

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.textContent = ADF_STYLES;
  document.head.appendChild(style);
  stylesInjected = true;
}

export function AdfCommentBody({ body, className = '' }: { body: unknown; className?: string }) {
  ensureStyles();

  const html = useMemo(() => adfToHtml(body), [body]);

  if (!html) return null;

  return (
    <div
      className={`adf-comment ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'IMG') {
          window.open((target as HTMLImageElement).src, '_blank');
        }
      }}
    />
  );
}
