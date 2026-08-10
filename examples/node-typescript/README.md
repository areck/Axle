# Axle example — Node / TypeScript

A tiny **standalone** project (its own `package.json` + `package-lock.json`, not a
workspace member) used to demonstrate `axle verify`. It has a `typecheck`, a `test`
(Vitest), and a `build`, so Axle's planner produces:

```
install → typecheck → test → build
```

## Demo: catch a breaking change before committing

From the Axle repo root, build the CLI and start Axle:

```bash
pnpm install
pnpm build          # produces the axle CLI bin
pnpm dev            # API + worker (leave running)
```

Now break the test **without committing** — in `src/auth.ts`, change the `401` to
`500`:

```ts
export function loginStatus(credentialsValid: boolean): number {
  return credentialsValid ? 200 : 500; // was 401
}
```

Then verify, from this directory (the CLI captures the current directory):

```bash
cd examples/node-typescript
node ../../packages/cli/dist/index.js verify
```

> No build? Run it straight from source instead:
> `../../node_modules/.bin/tsx ../../packages/cli/src/index.ts verify`

Axle captures the uncommitted change, spins up a clean isolated environment, runs
`npm ci → typecheck → test`, and reports the failing test as a **structured
diagnostic** — without touching your working copy. Inspect the record with
`axle inspect <execution-id>`. Revert the edit and `axle verify` goes green.
