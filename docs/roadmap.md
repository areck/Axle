# Roadmap

Axle is the execution, trust, and evidence layer for agentic software
development. The [vision](vision.md) defines the product direction; this roadmap
shows the major outcomes on the way there. The [delivery plan](plan.md) provides
the implementation sequence.

## Shipped — prove the Execution primitive

### Verify v0 — execution loop ✅

- Shared domain contracts and the Runtime interface.
- API, worker, sequential execution engine, replayable events, timeouts, output
  caps, and guaranteed cleanup.
- SQLite persistence and queue, structured diagnostics, execution log artifact,
  and the initial CLI.
- LocalRuntime as an L0 development provider. It provides a clean temporary
  workspace, not a security boundary.

### Verify v1 — uncommitted change verification ✅

- Git-aware working-tree capture with provenance, ignore rules, secret denylist,
  and size guards.
- Deterministic Node/TypeScript analysis and verification planning.
- `axle verify`: capture, plan, execute, stream, diagnose, and inspect without a
  commit, push, pull request, or mutation of the source workspace.

### Verify v2 — explicit project plans ✅

- `axle.yaml` for project-owned steps, profiles, timeouts, and optional steps.
- `axle init` for agent-authored or deterministically scaffolded configuration.
- Support for projects beyond the auto-detected ecosystem through explicit
  commands.

### Verify v3 — environments and secrets ✅

- Named control-plane environments and CLI management.
- Encrypted-at-rest, write-only secret values; authenticated API access.
- Runtime resolution, injection, log redaction, and environment-name provenance.

## Now — make isolation a product contract

### Verify v4 — isolation requirements and placement

- Introduce workload classes, minimum isolation tiers, tenancy, filesystem,
  network, secret, service, platform, and resource requirements.
- Add a provider capability registry and deterministic placement resolver.
- Persist the placement decision and effective capabilities as evidence.
- Make unsafe L0 execution explicit; never select it as a fallback for an
  autonomous workload.
- Remove the legacy Docker scaffold, configuration, selection logic, probe, and
  documentation from the implementation.
- Build the provider conformance suite and fail-closed tests described by the
  [isolation ladder](isolation-ladder.md).

## Next — ship the secure default

### Verify v5 — managed microVM execution

- Select one managed microVM provider through a capability and cost spike.
- Implement the complete environment lifecycle behind the Runtime interface:
  provision, prepare, run, stream, collect, cancel, and destroy.
- Enforce resource limits, restricted network policy, ephemeral storage,
  step-scoped secrets, and environment provenance.
- Make L3 the default for normal autonomous agent verification.
- Prove LocalRuntime-to-microVM functional parity on representative projects and
  pass the isolation conformance suite.

### Evidence and reliability track

- Rich Vitest, Jest, and ESLint diagnostics; machine-readable test and coverage
  artifacts.
- Mid-step cancellation that kills the complete process tree.
- Durable queue recovery, infrastructure-versus-user error taxonomy, structured
  logs, metrics, and broader integration tests.
- Key rotation and an external secret backend.

### Operator experience track

- Minimal execution history and detail dashboard, live from replayable events.
- Clear placement, isolation, policy, timing, diagnostics, and artifact views.
- CI for the Axle repository itself.

## Then — complete the useful ladder

### Cooperative local execution

- Native L1 OS-sandbox providers for low-latency, reviewed local work.
- Explicit trust selection and prominent evidence when the chosen tier is below
  the autonomous default.
- Platform-specific implementations behind one capability and conformance model.

### Runtime depth and performance

- Local L3 microVM execution where supported.
- Immutable environment identities, snapshots, safe dependency caches, warm
  pools, dependency proxies, and service provisioning.
- More OS, architecture, browser, mobile, backend, and ML profiles.

### Factory-scale scheduling and control

- Concurrent execution scheduling, leases, quotas, backpressure, capacity-aware
  placement, regional routing, and cost controls.
- Multi-tenant control plane and data plane, identity-aware policy, audit logs,
  repository permissions, and dedicated tenancy.
- L4 dedicated and specialized runners for sensitive or hardware-specific work.

### Intelligent verification

- Axle Plan informed by changed files, dependency graphs, test impact,
  historical failures, performance, and risk.
- Axle Graph relationships between changes, environments, steps, diagnostics,
  artifacts, and outcomes.

## Later — the broader AX platform

Expand the same Execution and Evidence primitives across:

```text
Organize -> Plan -> Execute -> Verify -> Review -> Ship
```

- **Axle Runtime** supplies policy-selected execution environments.
- **Axle Graph** turns execution history into shared engineering intelligence.
- **Axle Control** governs identity, permissions, isolation, network, secrets,
  tenancy, resources, and cost.
- **Review** and **Ship** apply the same evidence and policy model to the
  remaining engineering lifecycle.

The guiding constraint remains: protect the Execution primitive and its trust
guarantees before adding breadth.
