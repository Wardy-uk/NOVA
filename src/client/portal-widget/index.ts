import './widget-styles.css';

interface WidgetConfig {
  api: string;
  theme: 'light' | 'dark';
  position: 'bottom-right' | 'bottom-left';
  brandColor: string;
  greeting: string;
  logoUrl?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

class NurturChatWidget {
  private config: WidgetConfig;
  private container: HTMLElement | null = null;
  private bubble: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private isOpen = false;
  private sessionId: number | null = null;
  private token: string | null = null;
  private messages: ChatMessage[] = [];
  private listeners: Record<string, Array<(data: unknown) => void>> = {};

  constructor(config: WidgetConfig) {
    this.config = config;
    this.init();
  }

  private shadowRoot: ShadowRoot | null = null;

  private init(): void {
    const host = document.createElement('div');
    host.id = 'nurtur-chat-widget';
    document.body.appendChild(host);

    this.shadowRoot = host.attachShadow({ mode: 'open' });
    this.container = document.createElement('div');
    this.shadowRoot.appendChild(this.container);

    // Inject styles into shadow DOM
    const style = document.createElement('style');
    style.textContent = this.getWidgetStyles();
    this.shadowRoot.appendChild(style);

    this.createBubble();
    this.createPanel();
  }

  private getWidgetStyles(): string {
    // Inline the widget CSS so host page styles don't leak in
    return `
      .nurtur-chat-bubble {
        position: fixed; bottom: 20px; width: 56px; height: 56px;
        border-radius: 50%; border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 99999;
        transition: transform 0.2s;
      }
      .nurtur-chat-bubble:hover { transform: scale(1.1); }
      .nurtur-chat-bubble.open { transform: scale(0.9); }
      .nurtur-chat-panel {
        position: fixed; bottom: 90px; width: 380px; height: 520px;
        background: white; border-radius: 16px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.12);
        z-index: 99999; flex-direction: column; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .nurtur-chat-panel.right { right: 20px; }
      .nurtur-chat-panel.left { left: 20px; }
      .nurtur-chat-header {
        padding: 16px; color: white; display: flex;
        align-items: center; justify-content: space-between; font-weight: 600;
      }
      .nurtur-chat-close {
        background: none; border: none; color: white;
        font-size: 20px; cursor: pointer; padding: 0 4px;
      }
      .nurtur-chat-messages {
        flex: 1; overflow-y: auto; padding: 16px;
      }
      .nurtur-chat-message {
        margin-bottom: 12px; display: flex;
      }
      .nurtur-chat-message.user { justify-content: flex-end; }
      .nurtur-chat-msg-content {
        max-width: 80%; padding: 10px 14px; border-radius: 16px;
        font-size: 14px; line-height: 1.4;
      }
      .nurtur-chat-message.assistant .nurtur-chat-msg-content {
        background: #f3f4f6; color: #111;
      }
      .nurtur-chat-message.user .nurtur-chat-msg-content {
        background: #2563eb; color: white;
      }
      .nurtur-chat-input-area {
        padding: 12px; border-top: 1px solid #e5e7eb;
        display: flex; gap: 8px;
      }
      .nurtur-chat-input {
        flex: 1; padding: 8px 12px; border: 1px solid #d1d5db;
        border-radius: 8px; font-size: 14px; outline: none;
      }
      .nurtur-chat-input:focus { border-color: #2563eb; }
      .nurtur-chat-send {
        width: 36px; height: 36px; border-radius: 8px;
        border: none; cursor: pointer; display: flex;
        align-items: center; justify-content: center;
      }
    `;
  }

  private createBubble(): void {
    this.bubble = document.createElement('button');
    this.bubble.className = 'nurtur-chat-bubble';
    this.bubble.style.backgroundColor = this.config.brandColor;
    this.bubble.style[this.config.position === 'bottom-left' ? 'left' : 'right'] = '20px';
    this.bubble.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
      </svg>
    `;
    this.bubble.addEventListener('click', () => this.toggle());
    this.container!.appendChild(this.bubble);
  }

  private createPanel(): void {
    this.panel = document.createElement('div');
    this.panel.className = `nurtur-chat-panel ${this.config.position === 'bottom-left' ? 'left' : 'right'}`;
    this.panel.style.display = 'none';
    this.panel.innerHTML = `
      <div class="nurtur-chat-header" style="background-color: ${this.config.brandColor}">
        <span>Support Chat</span>
        <button class="nurtur-chat-close">&times;</button>
      </div>
      <div class="nurtur-chat-messages">
        <div class="nurtur-chat-message assistant">
          <div class="nurtur-chat-msg-content">${this.escapeHtml(this.config.greeting)}</div>
        </div>
      </div>
      <div class="nurtur-chat-input-area">
        <input type="text" class="nurtur-chat-input" placeholder="Type your message..." />
        <button class="nurtur-chat-send" style="background-color: ${this.config.brandColor}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </div>
    `;

    this.panel.querySelector('.nurtur-chat-close')!.addEventListener('click', () => this.toggle());
    const input = this.panel.querySelector('.nurtur-chat-input') as HTMLInputElement;
    const sendBtn = this.panel.querySelector('.nurtur-chat-send')!;

    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.send(input);
    });
    sendBtn.addEventListener('click', () => this.send(input));

    this.container!.appendChild(this.panel);
  }

  private toggle(): void {
    this.isOpen = !this.isOpen;
    if (this.panel) {
      this.panel.style.display = this.isOpen ? 'flex' : 'none';
    }
    if (this.bubble) {
      this.bubble.classList.toggle('open', this.isOpen);
    }
  }

  private async send(input: HTMLInputElement): Promise<void> {
    const content = input.value.trim();
    if (!content) return;
    input.value = '';

    this.appendMessage('user', content);

    // Start session if needed
    if (!this.sessionId) {
      await this.startSession();
    }

    if (!this.sessionId) {
      this.appendMessage('assistant', 'Unable to connect. Please try again later.');
      return;
    }

    try {
      const res = await fetch(`${this.config.api}/api/portal/chat/sessions/${this.sessionId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (data.ok) {
        this.appendMessage('assistant', data.data.content);
        // Check if a ticket was created
        if (data.data.content?.includes('ticket') && data.data.content?.match(/[A-Z]+-\d+/)) {
          const match = data.data.content.match(/[A-Z]+-\d+/);
          if (match) this.emit('ticket:created', { key: match[0] });
        }
      } else {
        this.appendMessage('assistant', 'Sorry, something went wrong. Please try again.');
      }
    } catch {
      this.appendMessage('assistant', 'Connection error. Please check your internet connection and try again.');
    }
  }

  private async startSession(): Promise<void> {
    // Try widget identify first if not authenticated
    if (!this.token) {
      try {
        const email = prompt('Please enter your email to get started:');
        if (!email) return;

        const res = await fetch(`${this.config.api}/api/portal/widget/identify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (data.ok) this.token = data.data.token;
      } catch {
        return;
      }
    }

    try {
      const res = await fetch(`${this.config.api}/api/portal/chat/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      });
      const data = await res.json();
      if (data.ok) this.sessionId = data.data.id;
    } catch {
      // ignore
    }
  }

  private appendMessage(role: 'user' | 'assistant', content: string): void {
    const messagesEl = this.panel?.querySelector('.nurtur-chat-messages');
    if (!messagesEl) return;

    const msgEl = document.createElement('div');
    msgEl.className = `nurtur-chat-message ${role}`;
    msgEl.innerHTML = `<div class="nurtur-chat-msg-content">${this.escapeHtml(content)}</div>`;
    messagesEl.appendChild(msgEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    this.messages.push({ role, content, timestamp: new Date().toISOString() });
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  on(event: string, callback: (data: unknown) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  private emit(event: string, data: unknown): void {
    for (const cb of this.listeners[event] || []) {
      try { cb(data); } catch { /* ignore */ }
    }
  }
}

// Auto-initialize from script tag data attributes
function autoInit(): void {
  const script = document.currentScript || document.querySelector('script[data-api]');
  if (!script) return;

  const config: WidgetConfig = {
    api: script.getAttribute('data-api') || '',
    theme: (script.getAttribute('data-theme') as 'light' | 'dark') || 'light',
    position: (script.getAttribute('data-position') as 'bottom-right' | 'bottom-left') || 'bottom-right',
    brandColor: script.getAttribute('data-brand-color') || '#1e40af',
    greeting: script.getAttribute('data-greeting') || 'Hi! How can we help you today?',
    logoUrl: script.getAttribute('data-logo-url') || undefined,
  };

  (window as any).NurturChat = new NurturChatWidget(config);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoInit);
} else {
  autoInit();
}
