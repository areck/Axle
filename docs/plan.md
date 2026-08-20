# Delivery Plan

This document sequences the work required to reach the [vision](vision.md). It
turns the [roadmap](roadmap.md) into independently shippable milestones and uses
the [isolation ladder](isolation-ladder.md) as the security contract.

## Delivery principles

- Each milestone is a vertical slice and leaves the repository runnable.
- The Runtime boundary stays provider-neutral.
- Security requirements are capabilities, not provider names.
- Autonomous workloads default to L3 microVM isolation.
- L0 LocalRuntime is explicit and unsafe; it is never a fallback.
- If no provider satisfies the complete requirement set, the Execution fails
  before code runs.
- Provider, policy, environment, and effective capabilities are durable evidence.
- Performance work cannot weaken isolation, cleanup, or provenance.

## Current baseline ✅

The repository already proves the product loop:

- capture an uncommitted working tree;
- derive or load an execution plan;
- submit, queue, claim, and run an Execution;
- stream replayable events;
- normalize diagnostics and store an artifact;
- persist execution history;
- resolve named environments, inject variables and secrets, and redact output;
- inspect the result through the CLI.

The only working provider is LocalRuntime. It creates a temporary directory and
runs a host subprocess, so it is L0. A legacy Docker scaffold and automatic
probe remain in the source; they are implementation debt, not the forward plan.

## Milestone 1 — Isolation contract and honest selection

**Goal.** Make Axle capable of expressing and enforcing the environment a
workload requires before adding another provider.

### Deliverables

1. **Contracts**
   - Add `WorkloadClass`, `IsolationTier`, `Tenancy`, network, filesystem,
     secret-scope, service, platform, resource, and placement requirement schemas.
   - Add a provider capability schema using the same dimensions.
   - Preserve sensible defaults: `autonomous -> minimum L3`; explicit local
     development may request L0.
2. **Provider registry and resolver**
   - Register providers with identity, health, capacity, and testable
     capabilities.
   - Filter by all hard requirements, then rank eligible providers by placement
     preference, health, capacity, latency, and cost.
   - Return a structured unsatisfied-requirements error when nothing qualifies.
3. **Evidence and lifecycle**
   - Record requested requirements, applied policy, selected provider, effective
     capabilities, environment identity, and any explicit unsafe override.
   - Emit placement events before provisioning.
4. **LocalRuntime honesty**
   - Advertise L0 and require an explicit development/unsafe selection.
   - Remove automatic fallback to LocalRuntime.
   - Keep its temporary workspace and environment allowlist for developer
     convenience, without describing them as isolation.
5. **Remove the abandoned path**
   - Delete the legacy runtime package, configuration value, worker selection,
     daemon probe, dependency entries, and tests associated with Docker.
   - Do not introduce a replacement packaging contract into product schemas.
6. **Conformance harness**
   - Create provider-contract tests for lifecycle and functional parity.
   - Add tier tests for filesystem escape, networking, metadata/LAN access,
     resources, cancellation, process-tree cleanup, secrets, artifacts, and
     provenance.

### Exit criteria

- An autonomous Execution cannot run because no L3 provider is installed.
- An explicit L0 development Execution runs and is visibly recorded as unsafe.
- No unqualified provider can be selected, including during outages.
- The codebase has no Docker dependency or runtime path.
- All existing LocalRuntime behavior passes through the new provider contract.

### Main risk

Over-designing the capability schema before a real secure provider exercises it.
Keep the first schema narrow enough for Verify, but model every security-relevant
dimension separately so the provider spike does not leak vendor concepts upward.

## Milestone 2 — Managed L3 microVM vertical slice

**Goal.** Ship the first secure default for ordinary agent-driven verification.

### Provider spike

Time-box a scored prototype against a small shortlist. Measure:

- guest-kernel isolation and tenancy semantics;
- cold and warm start latency;
- workspace upload and artifact download behavior;
- streaming output and reliable exit status;
- cancellation and teardown guarantees;
- CPU, memory, disk, process, and wall-time enforcement;
- network deny/allowlist support and metadata protection;
- step-scoped secret injection without control-plane leakage;
- immutable environment identity and snapshot support;
- observability, regional availability, quotas, and unit economics;
- self-hosting or migration options.

Select one provider for the first adapter. Keep the scorecard and decision record
so a second implementation can validate that the contract is truly portable.

### Deliverables

- Implement provision, prepare workspace, run with streamed output, collect
  artifacts, cancel, and destroy behind `Runtime`.
- Support the Node 22 verification profile without exposing vendor image or
  template identifiers above the provider layer.
- Enforce ephemeral storage, resource limits, restricted egress, and no inbound
  connectivity by default.
- Inject only explicitly granted variables and step-scoped secrets.
- Record provider, region, environment identity, effective policy, timing, and
  teardown result.
- Add end-to-end tests using representative passing, failing, timed-out,
  cancelled, dependency-installing, and artifact-producing projects.
- Run the complete L3 conformance suite in CI or a gated provider test pipeline.

### Exit criteria

- `axle verify` defaults to the managed L3 provider for autonomous work.
- The representative-project parity suite passes against L0 and L3, while the
  security suite passes for L3 only.
- A provider outage fails closed with a clear explanation and no local fallback.
- Teardown succeeds after success, failure, timeout, cancellation, and worker
  interruption recovery.
- Latency and cost baselines are recorded for later optimization.

### Main risk

Letting the first vendor's lifecycle become Axle's product contract. Enforce the
capability boundary in review and keep all vendor identifiers inside the adapter.

## Milestone 3 — Evidence and reliability

This work can proceed in parallel with the managed-provider milestone after the
new contracts settle.

### Deliverables

- Vitest, Jest, and ESLint diagnostics using machine-readable reporters where
  possible.
- JUnit, coverage, and opt-in build artifacts with explicit collection rules.
- Mid-step cancellation wired through the worker and provider, terminating the
  entire process tree.
- Infrastructure-versus-user failure taxonomy and actionable retry semantics.
- Queue lease/recovery behavior for worker crashes and abandoned provisioning.
- Structured service logs and metrics for queue time, provisioning, execution,
  transfer, teardown, failures, and provider capacity.
- Secret-key rotation and an external secret-backend interface.
- Repository CI running typecheck, tests, lint, and build on every change.

### Exit criteria

- An agent can act on a common test, type, or lint failure without scraping raw
  output.
- Every lifecycle stage can be cancelled or recovered without an orphaned
  environment.
- Operators can distinguish code failures from Axle/provider failures.

## Milestone 4 — Native L1 local sandbox

**Goal.** Provide a low-latency local path for explicitly cooperative work
without conflating it with the secure autonomous default.

### Deliverables

- Build platform-specific providers from native filesystem, process, syscall,
  network, and resource-control primitives.
- Start with the host operating systems demanded by actual users; do not force
  false cross-platform uniformity below the capability layer.
- Run the same lifecycle contract and L1 conformance suite on every backend.
- Make trust selection explicit in CLI/config and show the effective tier in
  streaming output, inspection, and the dashboard.
- Define the support boundary for dependency installation, local services,
  browser use, and host integration at L1.

### Exit criteria

- Cooperative workloads can request local placement and receive at least L1.
- Autonomous and untrusted workloads cannot select L1 without a policy-visible
  override, and never reach it through fallback.
- Unsupported host capabilities produce a clear preflight failure.

## Milestone 5 — Runtime depth and performance

**Goal.** Reduce latency and broaden workloads without changing trust semantics.

### Deliverables

- Local L3 microVM providers where host virtualization support is viable.
- Immutable environment profiles and provenance.
- Snapshot-based startup, warm pools, and safe dependency caches scoped by
  tenant, profile, lockfile, and policy.
- Audited dependency proxies and consistent network allowlists.
- First-class ephemeral services such as databases and browsers.
- Additional OS, architecture, mobile, backend, and ML profiles based on demand.
- Evaluate an L2 userspace-kernel provider only if measured cost, density, or
  latency requirements justify the extra tier.

### Exit criteria

- Optimizations demonstrably preserve provider conformance and tenant cleanup.
- Cache and warm-pool keys cannot cross repository, tenant, secret, or policy
  boundaries.
- Placement can choose among multiple eligible providers and records why.

## Milestone 6 — Factory scale and broader product

**Goal.** Turn secure single executions into the substrate for concurrent
software factories.

### Deliverables

- Scheduler leases, quotas, backpressure, priorities, retries, idempotency,
  regional routing, capacity management, and cost budgets.
- Multi-tenant identity, repository permissions, audit history, policy bundles,
  and dedicated-tenancy placement.
- Dashboard views for live factories, execution relationships, bottlenecks,
  policy decisions, evidence, and costs.
- Axle Plan using dependency and execution history for test impact and
  risk-aware verification.
- L4 dedicated and specialized providers.
- Review and Ship workflows built from the same Execution and Evidence model.

### Exit criteria

- Many agents can execute concurrently without resource collisions or policy
  ambiguity.
- Every result is attributable to a change, intent, environment, provider,
  policy, and evidence set.
- The scheduler can optimize eligible placement but cannot relax hard security
  requirements.

## Sequencing

```text
Shipped foundation
        |
        v
M1 isolation contract + remove legacy path
        |
        +--------------------+
        v                    v
M2 managed L3          M3 evidence/reliability
        |                    |
        +----------+---------+
                   v
          M4 native L1 local
                   |
                   v
       M5 runtime depth/performance
                   |
                   v
         M6 factory scale + lifecycle
```

M1 is the critical path. M3 may run alongside M2 once the new evidence fields
settle. The dashboard can begin during M3, but it should display isolation and
placement truth rather than freeze the current L0-only model into the UI.
