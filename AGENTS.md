## CI and Deployment Rules

- All production deployments are triggered automatically by GitHub.
- Vercel auto-deploys frontend apps on commit to main.
- Render auto-deploys the API service on commit to main.

Agents MUST NOT:
- Add deploy scripts or platform-specific deployment code
- Modify Vercel or Render behavior in code
- Add GitHub Actions that perform deployments

Agents MUST:
- Use Turbo for builds (pnpm turbo run ...)
- Ensure pnpm build and typecheck pass before committing
- Keep API build output deterministic at dist/index.js
