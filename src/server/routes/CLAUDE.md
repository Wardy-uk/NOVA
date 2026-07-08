# Routes Layer — Local Context

\~45 Express route modules. Every file follows the same pattern.

## Convention

```typescript
export function createXxxRoutes(deps: { db: SomeQueries; settings: SettingsQueries; ... }): Router {
  const router = Router();
  // endpoints here
  return router;
}
```

All routes are wired in `index.ts` and sit behind JWT auth middleware automatically.

## Adding a new route file

1. Create the file here following the factory pattern above
2. Wire it in `index.ts`: `app.use('/api/{path}', create{Feature}Routes({ ... }))`
3. The auth middleware in `middleware/auth.ts` covers all `/api/*` routes

## Don't

- Export raw routers (always use the factory)
- Add auth checks inside individual routes (middleware handles it)
- Return responses in any format other than `{ ok: true, data }` / `{ ok: false, error }`
