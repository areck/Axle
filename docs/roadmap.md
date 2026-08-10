# Roadmap

Axle is built as a sequence of vertical slices. Each keeps the repository
runnable and protects the boundaries around the Execution primitive.

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

## Next — Verify v1 (make `axle verify` real)

The pieces the bootstrap deliberately deferred, each behind interfaces that
already exist:

1. **Change capture** (`packages/git`) — determine the base SHA, capture the
   tracked diff and relevant untracked files, honour `.gitignore` / `.axleignore`
   and a secret denylist. Transport the base tree so the runtime can apply the
   patch onto it.
2. **Project detection + planner** (`packages/planner`) — deterministic Node/TS
   detection (package manager, scripts, test framework) producing an
   `ExecutionPlan` (install → typecheck → lint → test → build).
3. **`axle verify`** — wire capture + planner + execution into the flagship
   command, with the workspace-analysis output from the product brief.
4. **Real DockerRuntime** — implement the container lifecycle and a `node-22`
   base image; make it the default when a daemon is available.
5. **Richer diagnostics** — Jest and Vitest parsers; more artifact types.
6. **Dashboard** (`apps/web`) — minimal React/Vite execution history + detail.

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
