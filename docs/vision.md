# Vision

## The short version

**Axle is the execution, trust, and evidence layer for agentic software
development.**

Coding agents can already write useful software. The limiting factor is becoming
everything around the model: finding a safe place to run, reproducing the right
environment, controlling access, coordinating concurrent work, and deciding
whether the result can be trusted. Axle turns an agent's intent and code change
into a governed **Execution** and returns structured **Evidence**.

The initial product, **Axle Verify**, verifies uncommitted work before a commit,
push, pull request, or CI run is required. The longer arc is the full engineering
lifecycle:

```text
Organize -> Plan -> Execute -> Verify -> Review -> Ship
                         |
              policy-selected environments
                         |
                 structured evidence
```

## Where Axle fits in a software factory

A software factory needs agents, source control, execution infrastructure,
policy, evidence, and coordination. Axle owns the execution loop between an
agent deciding to do work and the rest of the system accepting the result:

```text
Agent or orchestrator
        |
        | change + intent + requirements
        v
      Axle
  plan -> place -> execute -> observe -> explain -> record
        |
        | evidence + artifacts + provenance
        v
Agent, developer, review system, or delivery gate
```

Axle does not need to replace the coding agent, Git host, IDE, secret manager,
or deployment platform. It integrates with them. It also does not need to
replace CI: Axle serves the high-frequency, pre-commit agent loop, while CI can
remain a final shared-repository gate.

## Product goals

### 1. Safe autonomy

An agent should be able to install dependencies, run tools, and inspect its
work without putting the developer's machine or another tenant at risk. Safety
is a declared, enforceable requirement—not an optimistic property of a clean
directory.

### 2. Fast, parallel execution

Many agents should be able to work at once without fighting over CPU, memory,
ports, caches, or services on one laptop. Axle should choose an eligible local
or remote provider without changing the product workflow.

### 3. Trustworthy evidence

The output is not merely a terminal transcript. Every Execution produces
structured steps, diagnostics, artifacts, metrics, environment provenance, and
the policy decision that allowed it to run.

### 4. Reproducible environments without provider lock-in

A workload declares what it needs: toolchain, operating system, architecture,
services, resources, network access, secrets, and isolation. Providers declare
what they can supply. Axle resolves the two through capabilities rather than
exposing a provider's packaging or lifecycle model to the product.

### 5. Intelligence that compounds

Execution history becomes **Axle Graph**: the data needed for test-impact
analysis, failure prediction, performance baselines, risk-aware planning, and
better future decisions.

### 6. Governance that scales with autonomy

**Axle Control** makes permissions explicit: which code may run, at what
isolation level, with which network destinations, secrets, services, resources,
and tenancy. More capable agents should not imply broader ambient access.

## Product principles

- **The Execution is the product primitive.** A sandbox, VM, worker, or vendor
  session is an implementation detail.
- **Default to a secure boundary for autonomous work.** Ordinary agent-driven
  execution targets microVM-grade isolation.
- **Fail closed.** Axle never silently chooses weaker isolation, broader
  network access, or less restrictive tenancy because the preferred provider is
  unavailable.
- **Separate the dimensions.** Isolation, placement, environment fidelity,
  permissions, and cost are related but not interchangeable.
- **Record what actually happened.** The selected provider, effective
  capabilities, policy decision, and environment identity belong in the durable
  evidence.
- **Optimize after correctness.** Warm pools, snapshots, and caches may improve
  latency, but cannot weaken cleanup, provenance, or tenant boundaries.
- **Keep the product provider-neutral.** Axle does not depend on Docker, a
  daemon, an image workflow, or any single sandbox vendor.
- **Preserve the developer's workspace.** Executions operate on captured state
  in ephemeral environments and never mutate the source workspace.

## Strategic wedge and expansion

1. **Verify uncommitted changes.** Prove that Axle can capture agent work and
   return useful evidence before CI.
2. **Make secure execution the default.** Add capability-based placement and a
   managed microVM provider.
3. **Deepen evidence and reliability.** Rich diagnostics, artifacts,
   cancellation, provenance, and operational visibility.
4. **Support local and specialized environments.** Native OS sandboxes for
   cooperative local work, local microVMs where practical, then dedicated and
   hardware-specific runners.
5. **Coordinate software factories.** Schedule concurrent work, enforce quotas
   and policy, reuse safe caches, and learn from the execution graph.
6. **Cover the lifecycle.** Expand from Verify into Plan, Review, and Ship while
   retaining Execution and Evidence as the common language.

See the [isolation ladder](isolation-ladder.md), [roadmap](roadmap.md), and
[delivery plan](plan.md) for how this vision becomes an implementation.
