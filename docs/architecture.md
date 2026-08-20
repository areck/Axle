# Axle Architecture

Axle is organized around one durable primitive—the **Execution**—and explicit
contracts between the layers that plan, place, run, observe, and interpret it.
The architecture exists to make execution safe and portable without turning the
product into a VM or vendor API.

## System flow

```text
Change Capture          materialized working-tree state + provenance
       |
       v
Execution Planner       explicit axle.yaml or deterministic analysis
       |
       v
Policy                  identity, workload class, permissions, hard minimums
       |
       v
Placement Resolver      requirements x provider capabilities
       |
       v
Runtime Provider        provision -> prepare -> run -> collect -> destroy
       |
       v
Observation             events, output, exit status, timing
       |
       v
Evidence                diagnostics, artifacts, metrics, environment provenance
       |
       v
Axle Graph              durable execution history and future intelligence
```

The current repository implements capture, planning, a simple policy hook, the
Runtime interface, L0 LocalRuntime, observation, and evidence. Capability-based
placement and secure providers are the next architectural slice.

## Control-plane request flow

```text
CLI --POST /v1/executions--> API --persist queued--> Execution Store
                              |                           ^
                              +--append queued event      | atomic claim / lease
                                                          |
Worker --claim--> Engine --resolve policy + placement-----+
                      |
                      +--provision environment
                      +--prepare captured workspace
                      +--run plan steps and stream events
                      +--parse diagnostics and collect artifacts
                      +--persist metrics and final status
                      +--destroy environment in finally

CLI <--SSE replay/live events-- API <--append-only event sequence-- Worker
```

Today the API and worker share SQLite in WAL mode. The queue is a database claim
behind `ExecutionStore.claimNextQueued()`, so a leased Postgres, Redis, SQS, or
other implementation can replace it without changing the Execution model.
Events are append-only and sequence-addressed, making streams live and replayable.

## Product architecture

```text
                     AXLE — Agent Experience Platform
          Organize -> Plan -> Execute -> Verify -> Review -> Ship
                                  |
                         Shared Execution model
                                  |
               +------------------+------------------+
               |                  |                  |
         Axle Runtime        Axle Graph         Axle Control
     capabilities + place    history + learn    policy + audit
               |
       local / managed / self-hosted providers
               |
  OS sandbox / userspace kernel / microVM / dedicated machine
```

- **Axle Runtime** resolves requirements to a provider and owns the environment
  lifecycle.
- **Axle Graph** relates changes, plans, environments, steps, diagnostics,
  artifacts, timing, and outcomes.
- **Axle Control** decides what may run, at which isolation and tenancy, with
  which filesystem, network, secrets, services, resources, and identity.

## Separate the execution dimensions

The architecture deliberately avoids one overloaded “runtime” setting:

- **Environment profile** says what software and platform the workload needs.
- **Isolation requirement** says how strong the boundary must be.
- **Placement preference** says where the user would prefer it to run.
- **Policy** says what access and guarantees are mandatory.
- **Provider capabilities** say what a particular backend can actually enforce.

`node-22`, for example, is an environment profile. It says nothing about
isolation. `local` is a placement preference. It does not authorize host-process
execution. See the [isolation ladder](isolation-ladder.md).

## The Runtime boundary

The application layer currently creates an environment through a small,
provider-neutral interface:

```ts
interface Runtime {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  createEnvironment(request: RuntimeRequest): Promise<ExecutionEnvironment>;
}

interface ExecutionEnvironment {
  prepareWorkspace(snapshot: ChangeSnapshot): Promise<void>;
  run(command: CommandRequest): Promise<CommandResult>;
  destroy(): Promise<void>;
}
```

The next contract revision adds testable provider capabilities and a placement
decision ahead of `createEnvironment`. Conceptually:

```ts
requirements + policy
        |
        v
resolve(eligible provider capabilities)
        |
        v
PlacementDecision { provider, effectiveCapabilities, environmentIdentity }
        |
        v
createEnvironment(decision)
```

Provider-specific template IDs, virtualization flags, lifecycle objects, and
vendor APIs remain inside the adapter. Axle has no Docker dependency or image
contract. Providers may evolve independently as long as they satisfy the Runtime
contract and their advertised isolation tier's conformance suite.

## Placement invariants

1. Workload class establishes a minimum security posture.
2. Organization, repository, and user policy may strengthen the minimum.
3. Providers missing any hard capability are ineligible.
4. Placement preference, health, capacity, latency, and cost rank only eligible
   providers.
5. No eligible provider means a failed preflight, not a weaker fallback.
6. The requested and effective requirements, policy, provider, environment, and
   unsafe overrides are persisted as evidence.

This makes placement predictable enough for security review and explainable to
an agent or developer.

## Current packages

| Package | Responsibility | Architectural boundary |
| --- | --- | --- |
| `contracts` | Zod schemas and shared domain types | Common language across processes |
| `git` | Capture working-tree state and provenance | Source workspace remains read-only |
| `planner` | Analyze projects and create execution plans | Intent becomes deterministic steps |
| `config` | Resolve process configuration | One control-plane configuration model |
| `runtime` | Runtime and environment interfaces | Provider-neutral lifecycle |
| `runtime-local` | L0 host-process provider | Explicit development escape hatch |
| `runtime-docker` | Legacy, unimplemented bootstrap scaffold | Scheduled for removal; not an architectural path |
| `diagnostics` | Normalize observations into diagnostics | Agent-readable failures |
| `artifacts` | Store and retrieve durable evidence | Storage backend seam |
| `persistence` | Execution store, event log, and queue | Database and queue seam |
| `apps/api` | Authenticated REST and SSE control plane | Submission, inspection, policy entry point |
| `apps/worker` | Execution orchestration | Claims work and owns the lifecycle |
| `cli` | Agent and developer interface | Primary product surface today |

## Current implementation gap

LocalRuntime is the only working provider. It creates a temporary directory and
runs commands as a host subprocess. That protects the source workspace from
ordinary build output, but it does not isolate the host, network, credentials,
or other processes. It is L0 and safe only for explicitly trusted development.

The repository still contains an unimplemented Docker package and automatic
daemon-selection code from the bootstrap. They are not part of the target
architecture and will be removed in the isolation-contract milestone before the
first secure provider lands.

## Security invariants

- Autonomous agent work requires L3 microVM isolation by default.
- L0 is never selected automatically and is always visible in evidence.
- No provider receives the worker's ambient environment.
- Secrets are explicit, encrypted at rest, scoped as narrowly as possible, and
  redacted from all captured outputs.
- Network, filesystem, services, resources, tenancy, and cleanup are enforced
  capabilities, not documentation promises.
- The source workspace is never mutated by an Execution.
- Environments are destroyed after every terminal path; teardown failures are
  recorded and recoverable.
- A provider cannot claim an isolation tier until it passes the shared
  conformance suite.
