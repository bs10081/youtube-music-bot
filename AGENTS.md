# Repository Rules

- Root `package.json` is the version source of truth for this repository.
- Every repository update must also update the root `package.json` version before commit, push, or PR creation.
- Treat backend and frontend version metadata as derived from root `package.json`, and validate version-sensitive changes against that source of truth.

## Communication

- Use Traditional Chinese (Taiwan) when communicating with the user.

## Local Validation

- Before asking the user to manually inspect UI or integration changes, start the split development servers for this repo first: backend with `bun run dev` and frontend with `npm run dev:frontend` (or `cd frontend && npm run dev`).
- Report the actual reachable local URLs/ports in handoff notes instead of assuming defaults.
