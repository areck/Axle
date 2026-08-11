# Axle Local Runtime

Why local execution is a **first-class tier** for Axle, and how the local runtime
is designed to deliver it. Local is not a downgrade of cloud — for many teams it
is the default they actually want (privacy, cost, offline), and Axle's founding
promise of *not contaminating the developer's machine* applies most directly here.

**See also:** [`execution-infra.md`](execution-infra.md) (the infra spine,
placement model, and how local fits the cloud) · [`parallel-execution.md`](parallel-execution.md)
(many local/cloud executions handling conflicting changes) ·
[`execution-model.md`](execution-model.md) · [`architecture.md`](architecture.md).

---

## 1. Why local execution matters (the value)

A local runtime is the only place an agent gets **both** "run anything without
wrecking my machine" **and** "without waiting, paying, or leaking my code."
Agents today pick one of two bad baselines; each fails a different half:

- **Raw shell on the host** (Claude Code, Cursor, Aider, Cline, Codex CLI): fast +
  local, **zero isolation** → contaminates the machine, forces the human to
  babysit.
- **Cloud sandbox** (Devin, cloud Codex, Replit agent): isolated, but **slow
  per-iteration, costs per-run, needs network, ships code + secrets to a vendor.**

Local runtime is the quadrant neither occupies. It turns the three levers that
gate how useful an agent actually is:

- **Autonomy — kills the permission tax.** Because commands hit the real machine,
  every `npm install` (arbitrary postinstall), migration, `rm`, port-grab is a
  risk → prompt fatigue or reckless auto-accept. An isolated ephemeral env makes
  "yes, run anything" *safe*, so the agent closes its own loop unsupervised. Also
  contains the supply-chain risk of agents running untrusted third-party code
  (`npx`, curl-pipe-bash) directly on the host.
- **Accuracy — a signal the agent can trust.** Clean-room verdicts on
  *uncommitted* code (no local cruft, no commit→push→CI roundtrip); reliable
  before/after attribution (fresh identical envs); structured evidence instead of
  scraping 40k-token logs (saves context + cost).
- **Throughput — parallelism + latency.** N agents on one laptop without port/DB
  collisions; the inner loop beats a cloud roundtrip because the code is already
  on local disk with warm caches.

Plus the adoption blockers cloud-only can't clear: **privacy** (code + secrets
never leave the org), **cost** (agents iterate hundreds of times), **offline**
(plane / air-gapped enterprise).

| Axis (a current agent pain) | Raw shell on host | Cloud sandbox | **Axle local runtime** |
|---|---|---|---|
| Isolation / safe to run freely | ✗ contaminates | ✓ | ✓ |
| Permission-prompt fatigue | ✗ constant | ~ | ✓ removed |
| Clean-room verdict on uncommitted code | ✗ dirty | ✓ | ✓ |
| Structured evidence (not scraped logs) | ✗ | ✓ | ✓ |
| Inner-loop latency | ✓ | ✗ roundtrip | ✓ |
| Parallel agents on one box | ✗ collide | ✓ (=$) | ✓ |
| Privacy / code stays local | ✓ | ✗ | ✓ |
| Cost at agent frequency | ✓ | ✗ | ✓ |
| Offline | ✓ | ✗ | ✓ |

Local is the only column with no ✗.

**Honest limits (why it's a tier, not the whole story):** heavy/at-scale
parallelism or profiles the box lacks (macOS-for-iOS, GPU, big-monorepo RAM)
still burst to cloud; isolation reduces access to the dev's real running services
(handled by the service-bindings knob in §2.5); perfect determinism is impossible
(external APIs, time). **Forward kicker:** cheap local isolation unlocks strategies
impossible on a shared host — an agent trying multiple fixes in parallel sandboxes
and keeping the one that passes.

---

## 2. Local runtime design

### 2.1 Central shape

One `ContainerRuntime` implementing the [`Runtime`](architecture.md#the-runtime-boundary)
interface, with two decisions doing most of the work:

1. **Backend pluggable, image not.** Target whatever OCI backend the host has —
   `runc` (default), `runsc`/gVisor (middle), `Kata`/`krunvm`/Apple `container`
   (microVM) — but every rung runs the *same* content-addressed `axle/node-22`
   image. Moving up the ladder (or out to cloud E2B) is a backend swap, never a
   re-plumb. `isAvailable()` → a capability descriptor of backend + isolation.
2. **Instances ephemeral; caches persistent + shared.** The sandbox is thrown
   away every run (clean-room, no drift). The expensive bits — image, dependency
   store, warmed microVM snapshots — live host-side and mount in. Never pay a cold
   `pnpm install` twice; never reuse a contaminated environment.

```
Developer machine
├─ axle worker/daemon
│   ├─ Local Scheduler   ← admission control; RESERVES headroom for the human
│   └─ Runtime Registry  ← picks backend by  isolation ≥ trust
│
├─ Persistent, host-side (shared read-only)
│   ├─ Profile image cache        axle/node-22 (content-addressed)
│   ├─ Dependency cache           pnpm/npm store, read-through   ← latency lever
│   └─ Warm pool + microVM snapshots  (trusted tier → sub-second start)
│
└─ Per-execution EPHEMERAL sandbox  (one per execution ⇒ own ports, own fs)
    ├─ backend:   runc | gVisor | Kata/krunvm | Apple container
    ├─ workspace: COW overlay of snapshot on cached base (node_modules layered)
    ├─ caps:      non-root · ro-rootfs · dropped caps · seccomp · cgroup limits
    ├─ network:   default-deny → egress proxy (registries only; metadata blocked)
    ├─ services:  ephemeral Postgres/Redis sidecar  (or consented proxy to host svc)
    └─ evidence:  per-step stdout/stderr + exit + timing → DiagnosticsEngine → typed
```

### 2.2 Capability envelope — approve the blast radius, not the keystrokes

This is the design answer to killing the permission tax. Flip permissions from
**imperative/per-call** ("may I run `rm`?") to **declarative/per-envelope**. Each
execution runs in a sandbox whose capabilities are fixed up front:

```yaml
# axle.yaml (or org policy) — approved once, not per command
capabilities:
  filesystem: workspace-only               # the copy, never the origin
  network: [registry.npmjs.org, pypi.org]  # default-deny otherwise
  services: [postgres]                     # ephemeral sidecar, not the host DB
  secrets: []                              # none reach the sandbox
  resources: { cpu: 4, memoryMb: 4096 }
```

Within the envelope the agent runs **anything, no prompts** — the sandbox *is* the
enforcement. The human approves the envelope once; only *escalations* (a new
egress domain, a new service) ever surface, and rarely. This **is** the
`ExecutionPolicy` seam — the envelope is the policy object, enforced by the
runtime instead of prompted at the human. Enforced by: COW workspace copy,
default-deny egress → allowlist proxy (SNI/Host, like E2B `allowOut`; blocks the
metadata endpoint + LAN), and hardened caps (non-root, ro-rootfs, dropped caps,
`no-new-privileges`, seccomp, no socket, no host mounts, `--init`).

### 2.3 Scheduler + caches (throughput / latency / parallelism)

- **Scheduler with headroom reservation.** Naive parallelism starves the dev's
  editor — which would violate the founding promise. Admission control tracks
  free CPU/RAM, **reserves a slice for the human**, caps concurrency, queues the
  rest. Each admitted execution gets its own network namespace → own ports (no
  `:3000` clash) and its own sidecars → own DB (no shared-test-DB corruption).
- **Caches are the product.** Dependency store mounted read-through; image
  pre-pulled; workspace prepared as a COW overlay so `node_modules` is *layered,
  not copied*; trusted tier gets a **warm pool of pre-booted sandboxes / microVM
  snapshots** for sub-second starts (untrusted always fresh).

### 2.4 Accuracy — reuse the evidence pipeline + clean-room A/B

- Structured evidence mostly **already built**: capture per-step stdout/stderr
  *with stream separation*, exit code, timing → existing `DiagnosticsEngine`. Add
  **cap-with-diagnostic-preservation**: when output exceeds `maxOutputBytes`, keep
  the parsed diagnostic (file/line/expected-received) even if the raw log is
  truncated.
- **Before/after** falls out of ephemeral + identical image: run baseline and
  change in two identical sandboxes and diff the evidence.
- **Mid-step cancellation** (a roadmap gap): `run()` wires `timeoutSeconds` +
  cancellation to an `AbortController` that kills the process *tree*, then
  `destroy()`.

### 2.5 Service bindings (the fidelity knob)

Isolation reduces access to the dev's real running services; resolve it with
policy, not compromise. A declared service defaults to an **ephemeral sidecar**
(throwaway Postgres/Redis in the sandbox's netns — clean, per-execution); opt-in
becomes a **scoped proxy** to the dev's real `localhost:5432` (fidelity, explicit
consent, only that port). Default clean, escalate to real when the human says so.

### 2.6 Lifecycle — mapped to `ExecutionEnvironment`

| Method | Local runtime does |
|---|---|
| `createEnvironment(req)` | acquire a scheduler slot; pick backend by `isolation ≥ trust`; create container/microVM from the profile image with caps + cgroup limits + egress policy; mount dep/image caches read-only; start declared sidecars |
| `prepareWorkspace(snapshot)` | COW-overlay the snapshot files on the cached base; only changed files written; origin untouched |
| `run(cmd)` | exec in-sandbox; stream stdout/stderr separately via `onOutput`; enforce timeout + cancel via `AbortController` killing the process tree; cap output preserving diagnostics; return exit/timing |
| `collectArtifacts()` | extract declared artifact paths (test reports, coverage, build) → `ArtifactStore` |
| `destroy()` | force-remove sandbox + sidecars, release the slot, wipe scratch (untrusted → hard destroy; trusted → reset-to-pool). Guaranteed by the engine's `finally` |

### 2.7 Cross-platform backends (detect; don't hard-depend on Docker)

| OS | Default (container) | Strong tier (microVM) |
|---|---|---|
| macOS (most devs) | Docker/Podman/**Colima** (already in a Linux VM) | **Apple `container`** / `krunvm` (libkrun HVF) |
| Linux | native `runc` | **Kata** / `krunvm` / Firecracker (gVisor as middle) |
| Windows | containers on **WSL2** (Hyper-V VM) | Hyper-V isolated / Windows Sandbox |

Depend on an OCI-runtime *abstraction* and detect the backend; the capability
descriptor reports what isolation the host can deliver — exactly what the
placement policy in [`execution-infra.md`](execution-infra.md) reads.
