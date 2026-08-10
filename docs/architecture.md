# Axle Architecture

Axle is organized around one primitive — the **Execution** — and a set of
explicit contracts between the layers that produce and consume it. This document
describes the layers, the request flow, and the boundaries that are designed to
outlast their current implementations.

## Layered flow

```
Change Capture           (future: packages/git — capture baseSha + patch + untracked)
      ↓
Execution Request        (packages/contracts — CreateExecutionRequest)
      ↓
Execution Planner        (future: packages/planner — deterministic verify plan)
      ↓
Runtime Interface        (packages/runtime — Runtime + ExecutionEnvironment)
      ↓
Runtime Provider         (packages/runtime-local today; runtime-docker next)
      ↓
Observation              (streamed CommandResult + events)
      ↓
Diagnostics              (packages/diagnostics — normalize output)
      ↓
Evidence                 (packages/artifacts + persistence — durable record)
```

Each arrow is a typed contract in `packages/contracts`. A layer can be replaced
without disturbing its neighbours as long as the contract holds.

## Runtime request flow (this pass)

```
CLI ──POST /v1/executions──► API ──persist(queued)──► SQLite
                              │                          ▲
                              └── appendEvent(queued)    │ claimNextQueued (atomic)
                                                         │
Worker loop ──claim──► Engine                            │
   provisioning → createEnvironment                      │
   running      → prepareWorkspace                       │
   for each step:                                        │
     step.started → env.run(stream) → step.completed ────┤ append events + update steps
     parse diagnostics                                   │
   store execution.log artifact                          │
   final status + metrics ──────────────────────────────┘
   finally: env.destroy()

CLI ──GET /v1/executions/:id/events (SSE)──► API tails execution_events by seq
```

Two processes (API and worker) share a single SQLite database in WAL mode.
The **queue** is a DB claim behind the `ExecutionStore.claimNextQueued()`
interface — a seam a Redis/SQS-backed queue can later replace. **Events** are an
append-only table; SSE tails it by sequence number, which makes the stream both
live and replayable (an execution that already finished replays from seq 0).

## Packages and responsibilities

| Package | Responsibility | Key boundary |
| --- | --- | --- |
| `contracts` | Domain model as Zod schemas + types | The shared contract everything imports |
| `config` | Runtime configuration resolution | Single `.axle` home across processes |
| `runtime` | `Runtime` / `ExecutionEnvironment` interfaces, registry | Provider-agnostic execution |
| `runtime-local` | Temp-dir subprocess runtime (dev) | First concrete provider |
| `runtime-docker` | Container runtime (stubbed) | The intended isolation boundary |
| `diagnostics` | Pluggable parsers → `Diagnostic[]` | Output normalization |
| `artifacts` | `ArtifactStore` + local FS store | Evidence storage (S3/GCS later) |
| `persistence` | SQLite store + queue | Structured execution history (Postgres later) |
| `apps/api` | Fastify REST + SSE, policy hook | Control plane |
| `apps/worker` | Engine loop | Execution orchestration |
| `cli` | `axle` commands | Primary user/agent interface |

## The Runtime boundary

The most important architectural seam. The application layer only ever hands a
runtime a `RuntimeRequest` (profile + resource limits + env) and receives an
`ExecutionEnvironment` with four methods:

```ts
interface ExecutionEnvironment {
  prepareWorkspace(snapshot: ChangeSnapshot): Promise<void>;
  run(command: CommandRequest): Promise<CommandResult>;
  collectArtifacts(): Promise<CollectedArtifact[]>;
  destroy(): Promise<void>;
}
```

No Docker-, subprocess-, or cloud-specific concept leaks above this line. That is
what allows the roadmap of providers — Docker, Daytona, E2B, Kubernetes,
Firecracker, macOS/Windows workers — to slot in behind the same interface.

## Where the future products fit

Today's MVP is the vertical slice on the right:

```
                    AXLE  —  Agent Experience Platform
        Organize  →  Plan  →  Verify  →  Review  →  Ship
                              │  (MVP)
                    Shared Intelligence
                              │
         ┌────────────────────┼─────────────────────┐
         │                    │                     │
    Axle Runtime         Axle Graph            Axle Control
   (packages/runtime*)  (execution history    (ExecutionPolicy
         │               in persistence)        hook in api)
         ▼
   Web / Android / iOS / Backend / Cloud / ML   (future profiles/runtimes)
```

- **Axle Runtime** — the `runtime` interface and its providers.
- **Axle Graph** — every execution is persisted as normalized, structured data
  (repository, base SHA, changed files, commands, steps, diagnostics, timing,
  outcome). Nothing consumes it yet, but it is the substrate for future test
  impact analysis, failure prediction, and intelligent planning.
- **Axle Control** — the `ExecutionPolicy` interface. The MVP ships an allow-all
  development policy with resource limits; production policies will gate commands,
  network, secrets, identity, and permissions at the same seam.

## Security model

See the [root README](../README.md#security). In short: submitted code is
untrusted; `LocalRuntime` is a development convenience with **no** isolation;
`DockerRuntime` is the intended boundary (ephemeral, resource-limited, no socket,
no host mounts); production targets hardened microVM isolation. Secrets are
excluded by default — even `LocalRuntime` forwards only an environment allowlist.
