import { useState, useEffect } from 'react';

interface LoginViewProps {
  onLogin: (username: string, password: string, rememberMe?: boolean) => Promise<boolean>;
  onRegister: (username: string, password: string, displayName?: string) => Promise<boolean>;
  onSsoLogin?: () => Promise<void>;
  error: string | null;
  loading: boolean;
}

const inputCls = 'bg-[#272C33] text-neutral-200 text-sm rounded-lg px-4 py-2.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';

export function LoginView({ onLogin, onRegister, onSsoLogin, error, loading }: LoginViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [firstRun, setFirstRun] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  // Check if any users exist — if not, default to register mode
  // Also check SSO status
  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(json => {
        if (json.ok && !json.data.hasUsers) {
          setMode('register');
          setFirstRun(true);
        }
      })
      .catch(() => {});
    fetch('/api/auth/sso/status')
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data.enabled) setSsoEnabled(true);
      })
      .catch(() => {});
  }, []);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    if (!username.trim() || !password) {
      setLocalError('Username and password are required');
      return;
    }

    if (mode === 'register') {
      if (password.length < 6) {
        setLocalError('Password must be at least 6 characters');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match');
        return;
      }
      await onRegister(username.trim(), password, displayName.trim() || undefined);
    } else {
      await onLogin(username.trim(), password, rememberMe);
    }
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen bg-[#272C33] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight font-[var(--font-heading)]">
            <span className="text-[#5ec1ca]">N.O.V.A</span>
          </h1>
          <p className="text-[11px] text-neutral-500 uppercase tracking-widest mt-1">
            Nurtur Operational Virtual Assistant
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#2f353d] border border-[#3a424d] rounded-xl p-6">
          <h2 className="text-sm font-semibold text-neutral-200 mb-4">
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </h2>

          {firstRun && mode === 'register' && (
            <div className="mb-4 px-3 py-2 bg-[#5ec1ca]/10 border border-[#5ec1ca]/30 rounded-lg text-[#5ec1ca] text-xs">
              Welcome! Create your admin account to get started.
            </div>
          )}

          {displayError && (
            <div className="mb-4 px-3 py-2 bg-red-950/50 border border-red-900/50 rounded-lg text-red-400 text-xs">
              {displayError}
            </div>
          )}

          {ssoEnabled && onSsoLogin && mode === 'login' && (
            <>
              <button
                type="button"
                onClick={onSsoLogin}
                disabled={loading}
                className="w-full px-4 py-2.5 text-sm rounded-lg bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 21 21" fill="none">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                </svg>
                Sign in with Microsoft
              </button>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#3a424d]" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-[#2f353d] px-3 text-[10px] text-neutral-500 uppercase">or sign in with password</span>
                </div>
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block">Username</label>
              <input
                className={inputCls}
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter username"
                autoFocus={!ssoEnabled}
                autoComplete="username"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block">Display Name</label>
                <input
                  className={inputCls}
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Your name (optional)"
                  autoComplete="name"
                />
              </div>
            )}

            <div>
              <label className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block">Password</label>
              <input
                className={inputCls}
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'Min 6 characters' : 'Enter password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block">Confirm Password</label>
                <input
                  className={inputCls}
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                />
              </div>
            )}

            {mode === 'login' && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-[#3a424d] bg-[#272C33] accent-[#5ec1ca]"
                />
                <span className="text-xs text-neutral-400">Remember me</span>
              </label>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 text-sm rounded-lg bg-[#2f353d] border border-[#3a424d] text-neutral-200 font-medium hover:bg-[#363d47] disabled:opacity-50 transition-colors mt-2"
            >
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-4 text-center">
            {mode === 'login' ? (
              <button
                onClick={() => { setMode('register'); setLocalError(''); }}
                className="text-[11px] text-[#5ec1ca] hover:text-[#4db0b9] transition-colors"
              >
                First time? Create an account
              </button>
            ) : (
              <button
                onClick={() => { setMode('login'); setLocalError(''); }}
                className="text-[11px] text-[#5ec1ca] hover:text-[#4db0b9] transition-colors"
              >
                Already have an account? Sign in
              </button>
            )}
          </div>
        </div>

        <p className="text-[10px] text-neutral-600 text-center mt-4">
          Nurtur Limited
        </p>
      </div>
    </div>
  );
}
