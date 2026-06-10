# Frontend

React/Vite dashboard for the VS Code Web Environment Manager.

The frontend owns only the browser UI:

- `src/pages/` — page-level React views.
- `src/components/` — dashboard components and local UI primitives.
- `src/hooks/` — TanStack Query hooks.
- `src/lib/` — API client, shared types, utilities.

nginx is configured outside this folder at `../deploy/nginx.conf` because it is the public gateway for the whole app: static SPA serving, `/api/` proxying, `/health`, and dynamic `vscode-env-*.localhost` editor routing. The config is copied into the runtime image by `frontend/Dockerfile`.

Common commands:

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm run dev
```
