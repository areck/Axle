# The Execution Model

The **Execution** is Axle's core unit of work. Everything else — runtimes,
planners, diagnostics, artifacts — exists to produce or interpret Executions.

Conceptually:

```
execute(change, intent, environment) -> evidence
```

An Execution represents an agent's request to perform engineering work inside a
trusted environment and receive **structured evidence** about the result. It is
deliberately **not** modeled as a "CI job" or a "sandbox" — those are narrower,
implementation-flavored ideas. The Execution is the durable, inspectable record
of *what an agent asked for, what happened, and what it means*.

“Trusted” does not mean that submitted code is trusted. It means Axle selected
an environment whose verified capabilities satisfy the workload's policy. The
current LocalRuntime does not provide that security boundary; it is an explicit
L0 development provider. See the [isolation ladder](isolation-ladder.md).

## Anatomy

```ts
interface Execution {
  id: string;                     // exec_<ulid> — time-sortable
  repository: RepositoryRef;      // where the work applies
  change: ChangeSnapshot;         // baseSha + materialized working-tree files
  intent?: string;                // why the agent ran this
  profile: ExecutionProfile;      // e.g. node-22 (+ optional resources)
  plan: ExecutionPlan;            // what Axle decided to run
  status: ExecutionStatus;        // queued → provisioning → running → succeeded | failed | cancelled
  createdAt; startedAt?; completedAt?;
  steps: ExecutionStep[];         // observations, one per planned step
  diagnostics: Diagnostic[];      // structured explanations of problems
  artifacts: Artifact[];          // evidence (logs, reports, outputs)
  metrics: ExecutionMetrics;      // timing, counts
}
```

The full schemas live in [`packages/contracts`](../packages/contracts/src).
The isolation-contract milestone will extend the durable record with requested
requirements, the applied policy, placement decision, provider identity,
effective capabilities, and immutable environment identity. These are evidence
about *where and under what guarantees* the work ran, rather than details of the
Execution's logical plan.

## Lifecycle

```
queued        the API accepted the request and persisted it
  ↓
provisioning  the worker claimed it, resolved placement, and is creating an environment
  ↓
running       the plan is executing, step by step
  ↓
succeeded | failed | cancelled     terminal
```

- A step is `pending → running → (succeeded | failed | timedOut | skipped)`.
- When a **required** step fails, subsequent steps are `skipped` and the
  Execution is `failed`.
- The environment is destroyed in a `finally` block — cleanup is guaranteed even
  on error.

## Evidence, not terminal output

The design principle is that a client — a human *or another agent* — should never
have to scrape terminal strings. Instead:

- **Events** (`ExecutionEvent`) are a structured, append-only stream:
  `execution.started`, `step.started`, `step.output`, `step.completed`,
  `execution.completed`. They are streamed live over SSE and replayable from the
  store.
- **Diagnostics** (`Diagnostic`) normalize failures into
  `{ type, severity, message, file?, line?, column?, stepId?, rawReference? }`.
  A TypeScript error and a generic command failure both become the same shape.
- **Artifacts** (`Artifact`) are stored evidence — at minimum an `execution.log`,
  later test reports and build outputs.
- **Metrics** capture queue wait, total duration, and step counts.

## Why this shape matters

Every Execution is persisted as normalized, queryable data — not an opaque blob.
That execution history is treated as strategically valuable: it is the substrate
for **Axle Graph** (test impact analysis, failure prediction, change → outcome
relationships, performance baselines, and smarter planning). Even though nothing
consumes it yet, the MVP records enough structure to make those futures possible
without a migration.

## The change snapshot

`ChangeSnapshot` carries `baseSha`, `changedFiles` (metadata), and `files` — the
materialized project files to write into a clean workspace (base64, so it is
binary-safe and JSON-transportable). Shipping the working-tree state directly —
rather than a base tree plus a patch to reconstruct it — is what lets an agent
verify **uncommitted** work with no commit, branch, or PR, and with no
patch-apply step in the runtime. The shape leaves room for richer transports
later (a patch against a base cloned from a remote, a git branch, a PR) behind
the same `prepareWorkspace` seam, to be added only when a real need appears. In
the current implementation, `packages/git` and `axle verify` already populate
the snapshot from a live working tree; `axle run` submits an empty snapshot for
an ad hoc command.
