import React from 'react';
import { createRoot } from 'react-dom/client';
import ChatWidget from './ChatWidget.js';
// @ts-ignore
import widgetStyles from './widget-styles.css?inline';

const SCRIPT_TAG = document.currentScript as HTMLScriptElement | null;

function init() {
  const apiBase = SCRIPT_TAG?.getAttribute('data-api') || window.location.origin;
  const brandColor = SCRIPT_TAG?.getAttribute('data-brand-color') || '#0d9488';
  const greeting = SCRIPT_TAG?.getAttribute('data-greeting') || 'Hi! How can we help you today?';
  const position = (SCRIPT_TAG?.getAttribute('data-position') || 'bottom-right') as 'bottom-right' | 'bottom-left';

  // Create shadow DOM container for style isolation
  const host = document.createElement('div');
  host.id = 'nurtur-chat-widget';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // Inject scoped styles
  const style = document.createElement('style');
  style.textContent = widgetStyles;
  shadow.appendChild(style);

  // React mount point inside shadow DOM
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  const eventHandlers: Record<string, Set<(...args: unknown[]) => void>> = {};

  const root = createRoot(mountPoint);
  root.render(
    React.createElement(ChatWidget, { apiBase, brandColor, greeting, position })
  );

  // Public API
  (window as any).NurturChat = {
    open() { /* controlled internally by ChatWidget */ },
    close() { /* controlled internally by ChatWidget */ },
    on(event: string, callback: (...args: unknown[]) => void) {
      if (!eventHandlers[event]) eventHandlers[event] = new Set();
      eventHandlers[event].add(callback);
    },
    destroy() {
      root.unmount();
      host.remove();
      delete (window as any).NurturChat;
    },
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
