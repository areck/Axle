# Isolation Ladder

This document defines how Axle decides **how isolated a workload must be** and
**where it may run**. It is the security contract behind Axle Runtime.

## Core decision

Axle does not use Docker as a dependency, runtime, packaging contract, or
security boundary. There is no daemon requirement, socket, image workflow, or
automatic container fallback in the target architecture.

Instead, an Execution declares minimum guarantees and each runtime provider
declares capabilities. Axle places the work only when a provider satisfies every
required capability. Provider internals remain private to the provider; they do
not define Axle's public model.

## Threat model

Execution code may:

- be generated or modified by an autonomous agent;
- install and execute third-party dependencies;
- contain malicious code from a fork, package, test fixture, or generated file;
- attempt to read host files, credentials, metadata services, or other runs;
- fork processes, consume resources, open ports, or continue after cancellation;
- exfiltrate source, secrets, or artifacts over the network.

Axle must also account for accidents: destructive commands, runaway builds,
incorrect paths, leaked output, stale processes, and incomplete cleanup.

The initial goal is strong workload-to-host and workload-to-workload isolation.
No single mechanism eliminates all risk, so network policy, secret scope,
resource enforcement, cleanup, provenance, and tenancy are part of the same
decision.

## The ladder

Higher tiers provide a stronger boundary. A provider may implement a tier in
different ways, but it must pass the tier's conformance tests before advertising
that capability.

| Tier | Boundary | Appropriate use | Axle posture |
| --- | --- | --- | --- |
| **L0 — Host process** | Separate process and temporary directory only | Axle development and explicit debugging of reviewed code | Unsafe; never selected automatically |
| **L1 — Native OS sandbox** | Host-kernel filesystem, process, syscall, and network restrictions | Cooperative, reviewed local workloads | Fast local option; not the default for autonomous work |
| **L2 — Userspace kernel** | System calls mediated by a userspace kernel or equivalent boundary | A future defense-in-depth option between OS sandbox and VM | Optional; not required for the first secure path |
| **L3 — MicroVM** | Dedicated guest kernel and isolated memory with enforced resource and network policy | Autonomous agents, third-party dependencies, forks, and multi-tenant hosted execution | Default target for ordinary agent work |
| **L4 — Dedicated machine** | Dedicated physical or single-tenant virtual host | Privileged, regulated, hardware-specific, or exceptionally sensitive workloads | Policy-driven specialized tier |

An implementation technology does not earn a tier by name. The effective
guarantees and conformance results determine the tier.

## Workload classes

Workload class supplies a safe default. Policy may always require a stronger
tier.

| Class | Example | Minimum posture |
| --- | --- | --- |
| **Cooperative** | Reviewed first-party code, controlled dependencies, no sensitive secrets | L1 |
| **Autonomous** | An agent edits code and installs normal project dependencies | L3 |
| **Untrusted** | External forks, user submissions, unknown repositories, multi-tenant code | L3 plus restricted egress, no ambient secrets, and hardened tenancy |
| **Sensitive** | Production credentials or data, regulated code, privileged tools, special hardware | L3 with dedicated tenancy or L4, as policy requires |

Until Axle ships an L1 or stronger provider, the current LocalRuntime is L0 and
must be treated as an explicit development escape hatch. A temporary workspace
is workspace hygiene, not security isolation.

## Keep the dimensions separate

“Where should this run?” is not one setting. Axle resolves an execution envelope
across independent dimensions:

| Dimension | Examples |
| --- | --- |
| **Isolation** | Minimum tier, workload class, tenancy |
| **Placement** | Local, managed, self-hosted, region, latency preference |
| **Environment** | Toolchain profile, OS, architecture, immutable environment identity |
| **Filesystem** | Read/write workspace, read-only inputs, artifact outputs, persistence |
| **Network** | Denied, allowlisted destinations, proxy, inbound ports |
| **Secrets** | None, named secrets, step scope, audience, expiry |
| **Services** | Database, browser, emulator, side process |
| **Resources** | CPU, memory, disk, process count, wall time |

For example, `node-22` describes environment fidelity; it does not imply a
security boundary. `managed` is a placement preference; it does not imply a
particular isolation tier.

## Capability contract

The exact schema will be introduced in the contracts package. Conceptually, a
request looks like this:

```ts
interface RuntimeRequirements {
  workloadClass: "cooperative" | "autonomous" | "untrusted" | "sensitive";
  minimumIsolation: "l0" | "l1" | "l2" | "l3" | "l4";
  tenancy: "shared" | "dedicated";
  placement?: { preference: "local" | "managed" | "self-hosted"; region?: string };
  platform: { os: string; architecture: string; profile: string };
  filesystem: { workspace: "read-write"; persistence: "ephemeral" };
  network: { mode: "denied" | "allowlist"; destinations?: string[] };
  secrets: Array<{ name: string; steps: string[] }>;
  services: string[];
  resources: { cpu: number; memoryMb: number; diskMb: number; timeoutSeconds: number };
}
```

A provider advertises the same dimensions as capabilities. Marketing claims or
provider type names are not capabilities; values must be testable.

## Placement algorithm

Placement is deterministic and auditable:

1. Derive defaults from the workload class.
2. Apply repository, organization, and user policy. Policy may strengthen but
   not weaken the minimum.
3. Filter out every provider that cannot satisfy the full requirement set.
4. Apply the user's placement preference among the remaining providers.
5. Rank eligible providers by health, capacity, latency, and cost.
6. Persist the selected provider and its effective capabilities before running.
7. Fail the Execution if no provider qualifies.

There is **no silent downgrade**. If an L3 provider is unavailable, Axle does
not fall back to L1 or L0. If the user wants an unsafe local run, they must ask
for it explicitly and the evidence must record that choice.

## Provider direction

The implementation order optimizes for a secure vertical slice and avoids
premature infrastructure ownership:

1. **Managed microVM provider.** Establish the first L3 path behind Axle's
   capability contract. Select the provider through a short, scored spike rather
   than exposing vendor concepts in contracts.
2. **Native local OS sandbox.** Add a low-latency L1 provider for explicitly
   cooperative work, using platform-native primitives and a shared conformance
   suite.
3. **Local microVM providers.** Add L3 local execution where host support makes
   it practical, with separate backends per operating system.
4. **Dedicated and specialized providers.** Add L4, macOS, Windows, mobile,
   browser, GPU, and other profiles as product demand requires.
5. **Userspace-kernel provider, if justified.** L2 remains an option when its
   latency, portability, or density fills a measured gap. It is not a dependency
   of the plan.

## Secrets and network

- No environment receives the worker's ambient environment.
- Secrets are denied by default, named explicitly, injected only into authorized
  steps, and redacted from every captured output path.
- Untrusted workloads receive no secrets unless a policy explicitly grants a
  narrowly scoped credential.
- Network is denied or allowlisted by policy. Dependency installation should use
  an audited proxy or explicit registry destinations rather than unrestricted
  egress.
- Cloud metadata endpoints, host-local services, and other tenants are always
  denied.

## Conformance gates

A provider cannot advertise a tier until automated tests prove, at minimum:

- the source workspace remains unchanged;
- paths cannot escape the execution workspace;
- network deny and allowlist rules are enforced;
- host, metadata, and adjacent-tenant endpoints are unreachable;
- CPU, memory, disk, process, output, and wall-time limits hold;
- cancellation terminates the complete process tree;
- teardown removes processes, storage, network state, and secrets;
- secrets are step-scoped and redacted from logs and artifacts;
- artifacts cross the boundary only through the declared collection path;
- the evidence records provider identity, effective capabilities, policy, and
  environment provenance;
- representative repositories produce equivalent functional results across
  eligible providers.

Security tests are release gates, not provider-specific best effort.

## Open implementation choices

The architectural choices above are settled. These backend choices should be
resolved with measured spikes:

- which managed microVM service best satisfies lifecycle, network, secret,
  artifact, observability, latency, and cost requirements;
- which native sandbox primitives are supportable on each host operating system;
- which local virtualization backend to use per operating system;
- whether environment preparation uses immutable snapshots, package caches, or
  warm pools at each provider;
- how network allowlists and dependency proxies are enforced consistently.

Each decision is reversible behind the Runtime boundary. None may weaken the
ladder's semantics.
