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

## Anatomy

```ts
interface Execution {
  id: string;                     // exec_<ulid> — time-sortable
  repository: RepositoryRef;      // where the work applies
  change: ChangeSnapshot;         // baseSha + patch + untracked files
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

## Lifecycle

```
queued        the API accepted the request and persisted it
  ↓
provisioning  the worker claimed it and is creating an environment
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

`ChangeSnapshot` carries `baseSha`, a `patch`, and any required `untrackedFiles`
(base64, so it is binary-safe and JSON-transportable). This is what lets an agent
verify **uncommitted** work — no commit, no branch, no PR required. The shape
intentionally leaves room for richer transports later (git branch, GitHub PR,
full workspace snapshot, remote repository). In this bootstrap pass, `axle run`
submits an empty snapshot (there is no diff to apply); populating it from a live
git workspace is the next milestone.
