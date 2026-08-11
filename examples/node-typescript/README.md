# Axle example — Node / TypeScript

A tiny **standalone** project (its own `package.json` + `package-lock.json`, not a
workspace member) used to demonstrate `axle verify`. It has a `typecheck`, a `test`
(Vitest), and a `build`.

This project ships an [`axle.yaml`](./axle.yaml), so `axle verify` runs exactly the
steps declared there:

```
install → typecheck → test → build
```

Without an `axle.yaml`, Axle auto-detects the same plan from `package.json`. The
config file makes the plan explicit and lets you customize it (add an e2e step,
change a command, mark a step non-blocking). Generate one for any project with
`axle init` — by default it prints a prompt for your coding agent to author the
file; `axle init --write` drops a detected scaffold instead.

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
