# Axle

**Axle is building the execution layer for Agent Experience.**

The initial product — **Axle Verify** — lets AI coding agents send *uncommitted*
software changes to isolated execution environments, build and test those
changes, and receive **structured evidence** back — without consuming or
contaminating the developer's local machine.

Long term, Axle helps agents **organize, plan, verify, review, and ship**
software.

> **Status.** This repository proves the core primitive and the flagship flow:
> an agent hands Axle an uncommitted change, Axle captures it, runs a
> verification plan somewhere clean, and the agent gets back trustworthy
> structured evidence. It ships the domain contracts, the runtime abstraction
> with a working **LocalRuntime**, a control-plane API, an execution worker, the
> CLI, **`axle verify`** with change-capture + planner, and **`axle.yaml`** /
> **`axle init`** for explicit, agent-authored verification config. The real
> Docker runtime, richer diagnostics, and the dashboard are the next passes (see
> [`docs/roadmap.md`](docs/roadmap.md)).

---

## The problem

Developers increasingly run several coding agents in parallel — one implements
auth, another updates the UI, a third refactors an API. Today those sessions all
compete for the **same developer machine**: builds, tests, browsers, databases,
dependency caches, ports. The result is CPU/RAM contention, port conflicts,
cache corruption, flaky tests, and environmental drift.

Traditional CI doesn't solve the high-frequency inner loop — it generally
expects code to already be committed and pushed. Axle targets exactly that gap:

```
Agent edits code locally
        ↓
Agent requests Axle verification      (no commit, no PR)
        ↓
Axle snapshots the change
        ↓
Axle executes remotely / in isolation
        ↓
Axle returns structured evidence
        ↓
Agent continues working
```

## The core abstraction: Execution

Axle is **not** "a VM API." The primary abstraction is an **Execution** — an
agent's request to perform engineering work inside a trusted environment and
receive evidence about the result:

```
execute(change, intent, environment) -> evidence
```

An Execution returns structured data — status, steps, diagnostics, artifacts,
metrics — not raw terminal output. A sandbox is an implementation detail.

## Architecture

```
CLI  (axle run / inspect / executions / doctor)
  │   POST /v1/executions
  ▼
Axle API (Fastify)  ──►  SQLite: executions · steps · events · diagnostics · artifacts
  │  ▲                        ▲
  │  │ SSE (tails events)     │ DB-backed queue (claimNextQueued)
  ▼  │                        ▼
CLI ◄┘                 Axle Worker  ──►  Execution Engine
                                          │  select Runtime
                                          ▼
                              Runtime interface ──► LocalRuntime  (working)
                                                 └► DockerRuntime (stubbed)
                                          │
                              Observation → Diagnostics → Artifacts (evidence)
```

Each boundary has an explicit contract (`packages/contracts`). The **Runtime
interface** is the seam that lets Docker later be replaced or augmented by
Daytona, E2B, Kubernetes, Firecracker, or cloud/macOS workers without touching
the product layer. See [`docs/architecture.md`](docs/architecture.md).

## Quickstart

Requires **Node 22+** and **pnpm**.

The control plane requires two secrets before it will start: an API token
(bearer auth on every `/v1` endpoint) and a key that encrypts secrets at rest.

```bash
pnpm install
export AXLE_API_TOKEN=$(openssl rand -hex 32)      # the CLI reads this too
export AXLE_SECRET_KEY=$(openssl rand -base64 32)   # 32 bytes, base64
pnpm dev          # starts the API (:8787) and the worker
```

In another terminal (the CLI needs `AXLE_API_TOKEN` in its environment):

```bash
export AXLE_API_TOKEN=…   # same value as the API
pnpm axle doctor
```

```
Axle Doctor
  ✓ git              installed
  ✕ docker daemon    not running (LocalRuntime will be used)
  ✓ git repository   /path/to/Axle
  ✓ axle api         http://127.0.0.1:8787
  Runtime        local (no isolation — development only)
```

> `pnpm axle …` runs the CLI via `tsx`. After `pnpm build`, the `axle` binary is
> available at `packages/cli/dist/index.js`.

## Demo

Run a command inside a clean, isolated execution and watch Axle turn a failure
into structured evidence:

```bash
pnpm axle run 'sh -c "echo boom >&2; exit 1"'
```

```
Axle Run
  Execution      exec_01KZP…
  Profile        node-22
  Command        sh -c "echo boom >&2; exit 1"

▸ command $ sh -c "echo boom >&2; exit 1"
boom
✕ failed 5ms (exit 1)

  Result         failed
  Duration       18ms

  Diagnostics
  ● unknown boom

  Artifacts
  ✓ execution.log

  Inspect: axle inspect exec_01KZP…
```

The execution ran in a throwaway directory — **your workspace was never
touched** — and the result is a persistent, inspectable record:

```bash
pnpm axle inspect exec_01KZP…          # full record
pnpm axle inspect exec_01KZP… --json   # machine-readable evidence for an agent
pnpm axle executions                   # recent history
```

## CLI

| Command | Description |
| --- | --- |
| `axle verify` | Capture the working tree, plan verification (from `axle.yaml`, or auto-detected: install → typecheck → lint → test → build), and run it in isolation. |
| `axle init` | Configure `axle.yaml`: print a prompt for your coding agent to author it, or `--write` a detected scaffold. |
| `axle env set/list/get/delete` | Manage environments & secrets in the control plane; reference one from an execution with `--env`. |
| `axle run "<command>"` | Run a single command in an isolated execution and stream structured evidence. |
| `axle inspect <id>` | Show the full record for an execution (steps, diagnostics, artifacts, timing). |
| `axle executions` | List recent execution history. |
| `axle doctor` | Validate local prerequisites and connectivity. |

Global: `--api <url>` (defaults to `AXLE_API_URL` / `http://127.0.0.1:8787`).
`verify`/`run`/`inspect`/`executions` accept `--json` for machine-readable output.

### `axle verify`

Run inside a project directory (it captures that project — even a subdirectory
of a monorepo). Axle reads the uncommitted working tree, resolves a verification
plan, and runs it in a clean sandbox. See
[`examples/node-typescript`](examples/node-typescript) for a break-a-test demo.
Secrets are excluded by default (`.gitignore` + `.axleignore` + a built-in
denylist); nothing is committed or pushed.

The plan is chosen in precedence order: `--command "<cmd>"` (a single command) →
a project **`axle.yaml`** → auto-detection (package manager / scripts /
TypeScript).

### `axle.yaml`

Declare exactly how a project is verified, instead of relying on auto-detection.
Because it is explicit, it also lets projects Axle can't yet auto-detect (any
language, custom pipelines) verify too.

```yaml
profile: node-22          # execution environment
steps:                    # ordered; each runs in the clean workspace
  - name: install
    command: npm ci
  - name: test
    command: npm test     # required by default — a failure fails verification
  - name: e2e
    command: pnpm playwright test
    required: false       # non-blocking
    timeoutSeconds: 1800
```

Since Axle Verify runs inside a coding agent's workflow, the fastest way to a
correct file is to let the agent write it: **`axle init`** prints a precise
prompt (with an auto-detected starting point) for the enclosing agent to inspect
the repo and author `axle.yaml`. Prefer a deterministic scaffold instead?
`axle init --write` drops one to disk (`--force` to overwrite).

### Environments & secrets

Tests and builds often need environment variables — `NODE_ENV`, a registry
token, a database URL. Axle keeps this configuration in the **control plane**,
behind the API, and resolves it at execution time. Values are **not** in
`axle.yaml` or git; secret values are **write-only** — set through the API and
injected into the run, but never returned on read, never copied into the
execution record, and redacted from logs.

```bash
# Configure once (a --secret KEY with no value reads $KEY from your shell,
# so it never lands in shell history).
axle env set ci --var NODE_ENV=test --secret NPM_TOKEN --secret DATABASE_URL=postgres://…
axle env get ci        # NODE_ENV=test; NPM_TOKEN (set) — value never shown
```

Reference an environment from an execution — via the CLI or `axle.yaml`:

```bash
axle verify --env ci                 # overrides axle.yaml's `environment:`
axle run "npm run test:integration" --env ci
```

```yaml
# axle.yaml
environment: ci
steps:
  - name: test
    command: npm test
```

At run time the worker resolves the environment, injects the variables and
secrets into the sandbox, and redacts secret values from all captured output.
The execution record only ever stores the environment's *name*.

**Protection.** Secret values are:

- **encrypted at rest** — AES-256-GCM under `AXLE_SECRET_KEY`; the database
  holds only `enc:v1:…` ciphertext, never plaintext;
- **behind API access** — every `/v1` endpoint requires the `AXLE_API_TOKEN`
  bearer token (only `/health` is open);
- **write-only** — never returned on read, never copied into the execution
  record, and redacted from logs.

The API and worker refuse to start without their required env vars, so the
control plane can't come up unauthenticated or storing plaintext secrets. Lose
`AXLE_SECRET_KEY` and the secrets are unrecoverable, by design. Key rotation and
an external secret backend are future work.

## How it works

1. The **CLI** submits an Execution (`POST /v1/executions`) with a plan.
2. The **API** validates it (against an `ExecutionPolicy`), persists it as
   `queued`, and returns the record.
3. The **worker** atomically claims the queued execution (`claimNextQueued`).
4. The **engine** selects a runtime, provisions a clean environment, prepares
   the workspace, and runs each plan step sequentially — streaming structured
   **events**, enforcing timeouts and output caps, and capturing exit codes.
5. Output is parsed into **diagnostics**; an `execution.log` **artifact** is
   stored; a final status + **metrics** are persisted.
6. The environment is **always** torn down (`finally`).
7. The CLI streams events over **SSE** and renders the result.

## Security

This bootstrap ships **LocalRuntime**, which runs commands in a throwaway temp
directory on the host. It is fast and works everywhere (including CI and
machines without Docker), but **it provides no isolation** — never run untrusted
code through it. It even prints a warning on first use.

The intended isolation boundary is **DockerRuntime** (stubbed here): ephemeral,
resource-limited containers, no host Docker socket, no host filesystem mounts,
secrets excluded by default, environment destroyed after each run. Even then,
containers share the host kernel and are not a hard boundary against a
determined attacker — production Axle Runtime targets hardened isolation
(microVMs / Firecracker). LocalRuntime already refuses to forward the host
environment wholesale (only an allowlist reaches executed commands). See
[`docs/architecture.md`](docs/architecture.md) and
[`packages/runtime-docker/README.md`](packages/runtime-docker/README.md).

## Repository layout

```
apps/
  api/            Fastify control-plane (REST + SSE)
  worker/         Execution engine loop (claim → run → persist)
packages/
  contracts/      Zod schemas + types — the domain model (the core boundary)
  runtime/        Runtime + ExecutionEnvironment interfaces + selector
  runtime-local/  LocalRuntime (working; dev-only, no isolation)
  runtime-docker/ DockerRuntime (stubbed behind the interface)
  diagnostics/    Pluggable parsers: TypeScript + Generic
  artifacts/      ArtifactStore interface + local filesystem store
  persistence/    SQLite (node:sqlite) store + DB-backed queue
  cli/            The axle CLI
  config/         Shared runtime configuration
docs/             architecture · execution-model · roadmap
```

## Development

```bash
pnpm dev          # API + worker (watch mode)
pnpm build        # build every package/app
pnpm test         # run the vitest suite
pnpm typecheck    # tsc --noEmit across the monorepo
pnpm lint         # biome check (lint + format + import order)
pnpm format       # biome check --write (apply fixes)
pnpm axle <cmd>   # run the CLI
```

Configuration is optional; see [`.env.example`](.env.example). Persistence uses
the built-in `node:sqlite` (no native build step).

## Naming

**Axle** (platform) · **Agent Experience** (category) · **Execution** (the core
unit of work) · **Axle Runtime** (the execution infrastructure) · **Axle
Verify** (the initial product) · **Execution Plan** (what Axle decides to run) ·
**Evidence** (outputs establishing what happened) · **Diagnostic** (a structured
explanation of a problem).
