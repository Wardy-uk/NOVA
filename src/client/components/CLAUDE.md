# Client Components — Local Context

~100 React view components. Mix of eagerly imported and lazy-loaded.

## Conventions
- New views MUST be lazy-loaded in `App.tsx`: `const XxxView = lazy(() => import('./components/XxxView.js').then(m => ({ default: m.XxxView })));`
- Only components needed at first render (LoginView, StatusBar, NotificationBell) are eagerly imported
- Each component exports a named export, not default: `export function XxxView() { ... }`
- Styling uses Tailwind 4 utility classes — no separate CSS files, no CSS modules
- Components receive data via props or via hooks (`useTasks`, `useHealth`, `useAuth`, `useTheme`)
- API calls go through the hooks layer or direct `fetch` with auth headers — see `hooks/` directory

## Calyx components
`Calyx*.tsx` components form a self-contained subsystem for the customer portal. They use separate API routes (`/api/calyx/*`) and the Calyx SQLite database. Don't mix Calyx state with main NOVA state.
