import { useState } from 'react';

interface LoginViewProps {
  onLogin: (username: string, password: string) => Promise<boolean>;
  onRegister: (username: string, password: string, displayName?: string) => Promise<boolean>;
  error: string | null;
  loading: boolean;
}

const inputCls = 'bg-[#272C33] text-neutral-200 text-sm rounded-lg px-4 py-2.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';

export function LoginView({ onLogin, onRegister, error, loading }: LoginViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
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
      await onLogin(username.trim(), password);
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

          {displayError && (
            <div className="mb-4 px-3 py-2 bg-red-950/50 border border-red-900/50 rounded-lg text-red-400 text-xs">
              {displayError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block">Username</label>
              <input
                className={inputCls}
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter username"
                autoFocus
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

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 text-sm rounded-lg bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-50 transition-colors mt-2"
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
