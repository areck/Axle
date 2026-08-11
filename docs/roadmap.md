# Roadmap

Axle is built as a sequence of vertical slices. Each keeps the repository
runnable and protects the boundaries around the Execution primitive.

> For the granular, sequenced execution plan — phases with deliverables, key
> files, and exit criteria — see [`plan.md`](plan.md).

## Verify v0 — this pass ✅

The smallest coherent slice that proves the primitive:

- Monorepo + shared domain **contracts**.
- **Runtime** interface with a working **LocalRuntime**; **DockerRuntime**
  stubbed behind the interface.
- Control-plane **API** (create / get / list / events / artifacts / cancel).
- **Worker** + **Execution engine** (sequential steps, streamed events,
  timeouts, output caps, guaranteed cleanup).
- **Diagnostics** (TypeScript + generic) and **artifacts** (execution.log).
- **Persistence** (SQLite) + a DB-backed queue.
- **CLI**: `run`, `inspect`, `executions`, `doctor`.
- Proven end-to-end with a hard-coded command.

## Verify v1 — `axle verify` ✅

Shipped: the flagship "verify an uncommitted change" flow on the Local runtime
(the brief's Definition of Done).

- **Change capture** (`packages/git`) — snapshot the current working-tree files
  (git enumerates them, honouring `.gitignore`), layered with `.axleignore` and a
  secret denylist, plus `baseSha`/`changedFiles` provenance. Scoped to the
  invocation directory; the runtime just writes the files (no base tree, no patch).
- **Project detection + planner** (`packages/planner`) — deterministic Node/TS
  detection producing an `ExecutionPlan` (install → typecheck → lint → test → build).
- **`axle verify`** — capture + planner + execution wired into the CLI, streaming
  the plan + live results + structured diagnostics.
- **`examples/node-typescript`** — a break-a-test demo proving the flow end-to-end.

## Verify v2 — `axle.yaml` + agentic `axle init` ✅

Shipped: explicit, per-project verification config, plus an agent-first way to
author it.

- **`axle.yaml`** (`VerifyConfig` contract + `packages/planner` loader) — declare
  the ordered steps to run; when present it replaces auto-detection. Because it is
  explicit, projects Axle can't yet auto-detect (any language, custom pipelines)
  can verify too. `verify` precedence: `--command` → `axle.yaml` → auto-detect.
- **`axle init`** — since Verify runs inside a coding agent's workflow, this prints
  a precise prompt (with an auto-detected starting point) for the enclosing agent
  to inspect the repo and write `axle.yaml`. `--write` drops a deterministic
  scaffold instead.

## Verify v3 — environments & secrets ✅

Shipped: control-plane configuration for the variables and secrets a
verification needs, resolved by Axle at execution time.

- **Environments** (`Environment` contract + `EnvironmentStore` + `/v1/environments`) —
  a named bundle of variables and secrets, managed behind the API (`axle env
  set/list/get/delete`). Secret values are write-only: never returned on read.
- **Resolution & redaction** — an execution references an environment by name;
  the worker resolves its variables + secret values at run time, injects them
  into the sandbox, and redacts secret values from all captured output. The
  execution record stores only the environment's name — secret values never
  transit the request, the DB execution row, or the logs.
- **Reference** — `--env <name>` on `verify`/`run`, or `environment:` in `axle.yaml`.
- **Hardening** — secret values are encrypted at rest (AES-256-GCM under
  `AXLE_SECRET_KEY`; the DB holds only `enc:v1:` ciphertext), and every `/v1`
  endpoint requires the `AXLE_API_TOKEN` bearer token (`/health` stays open). The
  API and worker refuse to start without their required env vars.

## Next

1. **Real DockerRuntime** — implement the container lifecycle and a `node-22`
   base image; make it the default when a daemon is available.
2. **Richer diagnostics** — Jest and Vitest parsers (the generic parser already
   strips ANSI and surfaces the assertion); more artifact types.
3. **Dashboard** (`apps/web`) — minimal React/Vite execution history + detail.
4. **Secret hardening, continued** — key rotation and an external secret backend
   (encryption at rest + bearer auth shipped in Verify v3).

## Then — intelligent verification

- **Axle Plan** — planning informed by changed files, dependency graph, test
  impact, historical failures, and risk (powered by the execution history Axle
  Graph already records).
- Additional runtimes and profiles — browser, Android, iOS, backend services,
  cloud, ML — behind the same `Runtime` interface.

## Later — the broader AX platform

`Organize → Plan → Verify → Review → Ship`, over shared intelligence:

- **Axle Runtime** — a fleet of hardened, isolated providers (microVMs /
  Firecracker, Daytona, E2B, Kubernetes, cloud/macOS/Windows workers).
- **Axle Graph** — test impact analysis, failure prediction, performance
  baselines, change → outcome relationships.
- **Axle Control** — real governance at the `ExecutionPolicy` seam: allowed
  commands, network, secrets, resource limits, agent identity, repository
  permissions.
- **Review** and **Ship** — the remaining lifecycle stages.

The guiding constraint throughout: when choosing between more features and a
cleaner Execution primitive, prioritize the primitive.
