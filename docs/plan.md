# Delivery Plan — Phase Breakdown

This is the execution plan for building Axle out from the bootstrap. Where
[`roadmap.md`](roadmap.md) states the *vision*, this document sequences the
*work* into concrete, shippable phases.

**Principles** (carried from the brief):

- Every phase is a **vertical slice** that keeps the repository runnable.
- When choosing between more features and a cleaner Execution primitive,
  **prioritize the primitive**.
- New capabilities land **behind interfaces that already exist**, so the product
  layer never gets rewritten.

## Overview

| Phase | Theme | Size | Risk | Outcome |
| --- | --- | --- | --- | --- |
| **0** | Bootstrap — Execution primitive + LocalRuntime | — | — | ✅ Shipped |
| **1** | Change capture + `axle verify` (Local) | L | Med | Hits the brief's Definition of Done |
| **2** | Real DockerRuntime + base image | M–L | Med–High | Isolated container execution |
| **3** | Structured diagnostics + artifacts | M | Low–Med | Precise, agent-grade failure evidence |
| **4** | Minimal dashboard (`apps/web`) | M | Low | Human-visible execution history |
| **5** | Hardening, cancellation, config, CI | M | Low–Med | Robust, observable, CI-gated |
| **6+** | Platform trajectory (Plan / runtimes / Control / Review / Ship) | XL | — | The AX platform |

**Cross-cutting (start in Phase 1):** a GitHub Actions CI workflow — the repo
currently has none — running `typecheck · test · lint · build` on every PR.

---

## Phase 0 — Bootstrap ✅ (shipped)

The Execution primitive proven end-to-end: contracts, the Runtime interface with
a working LocalRuntime (Docker stubbed), API + worker + engine, diagnostics
(TS + generic), artifacts, SQLite persistence + queue, and the `run` / `inspect`
/ `executions` / `doctor` CLI. Proven with a hard-coded command; 31 tests.

---

## Phase 1 — Change capture + `axle verify` (Local runtime)

**Goal.** Turn Axle from "run a command" into "verify an uncommitted change" —
satisfying the brief's **Definition of Done** on the Local runtime (Docker
follows in Phase 2).

**Guiding decision — capture the state, not the diff.** The environment needs
the agent's *current working tree* in a clean place. The obvious design ships a
base tree + a patch + untracked files and *reconstructs* the tree (base-tree
transport, `git apply`, three moving parts with real edge cases: CRLF, renames,
binary, partial hunks). Axle instead ships the **relevant working-tree files
themselves**. The snapshot already *is* the desired state, so `prepareWorkspace`
just writes the files. This is self-contained (needs no reachable remote and no
base tree), binary-safe, and makes Docker prep in Phase 2 trivial (tar →
`putArchive`). It is precisely the "lightweight repository snapshot" the brief
calls for when there is no reachable remote. A patch-against-remote transport can
be added later behind the same `prepareWorkspace` seam *if* very large repos ever
demand it — deferred until then. (The `ChangeSnapshot` contract and
`prepareWorkspace` were already simplified to this files model.)

**Deliverables.**

1. **`packages/git` — change capture (one pure function, git as source of truth).**
   - `baseSha = git rev-parse HEAD`.
   - Relevant paths in a single command:
     `git ls-files -z --cached --others --exclude-standard` — tracked + untracked
     with `.gitignore` already honoured — read at their current on-disk content.
     Deleted files are simply absent, which reproduces the deletion.
   - Exclusion: layer `.axleignore` + a built-in secret denylist (`.env*`, keys,
     `.ssh`, `secrets/**`) over git's view via the `ignore` package — don't
     reimplement gitignore semantics.
   - `changedFiles` metadata from `git status --porcelain`; size/count guards that
     fail fast pointing at `.axleignore`.
   - Returns `ChangeSnapshot { baseSha, changedFiles, files }`.
2. **`packages/planner` — detection + planning as two pure functions** (no classes,
   no plugin registry for a single ecosystem):
   - `analyze(root) → ProjectAnalysis` — package manager (lockfile), scripts,
     TypeScript, test framework. Deterministic, **no LLM**.
   - `plan(analysis, opts) → ExecutionPlan` — install (`--frozen-lockfile` per pm)
     → typecheck (if script) → lint (optional) → test → build (gated). Honours
     `axle.yaml` overrides.
3. **`axle verify`** — capture → analyze → plan → print summary + plan → submit →
   stream. Reuses `run`'s streaming/rendering, so `verify` stays thin. Flags:
   `--command`, `--profile`, `--json`, `--no-cache`, `--intent`.
4. **`examples/node-typescript`** — a tiny TS app + Vitest + `typecheck`/`build`,
   and a documented demo: break a test, run `axle verify`, watch Axle catch it.

**Key files.** `packages/git/*` (new), `packages/planner/*` (new), `packages/cli`
(new `verify` command), `examples/node-typescript/*` (new). No runtime or
contract changes needed — the files-snapshot seam is already in place.

**Exit criteria (= brief Definition of Done, Local).** From a clean checkout:
make an uncommitted change that breaks a test → `axle verify` captures the working
tree, runs in a clean isolated dir, installs deps, runs verification, identifies
the failing step, and returns structured diagnostics; `axle inspect <id>` shows
the record; the developer's workspace is unmodified.

**Risks.** Secret-exclusion correctness (test hard: clean / modified / untracked
/ ignored / denylisted); snapshot size on atypical repos (largely handled by
git's `.gitignore` view — `node_modules`/build already excluded — plus
`.axleignore` and guards); symlinks (skip in v1, note it).

---

## Phase 2 — Real DockerRuntime + base image

**Goal.** Execute inside a clean, ephemeral, resource-limited container — the
intended production isolation boundary.

**Deliverables.**

- Implement `DockerRuntime.createEnvironment` (via `dockerode` or the Docker
  CLI): create a container from the profile image with `--cpus`/`--memory`, a
  non-root user, `--init`, **no** Docker socket, **no** host mounts, a dedicated
  ephemeral workspace; `putArchive` the workspace; stream `exec`; `getArchive`
  artifacts; force-remove on `destroy`.
- `docker/node-22.Dockerfile` + a build script (git + corepack baked in).
- Make Docker the default when a daemon is reachable (`auto`), Local the
  fallback. Document network posture for dependency installs.

**Key files.** `packages/runtime-docker/src/*`, `docker/*`. No product-layer
changes — this is the payoff of the Runtime boundary.

**Exit criteria.** The full Phase 1 verify flow runs inside a container; a
Local-vs-Docker parity test suite passes; `axle doctor` reflects the active
runtime.

**Risks.** Environments without a daemon (keep Local fallback); registry egress
for installs; image build/caching time.

---

## Phase 3 — Structured diagnostics + artifacts

**Goal.** Make failure evidence precise enough for an agent to act on without
reading logs.

**Deliverables.**

- Parsers: **Vitest** and **Jest** (failing file/test, expected vs received),
  **ESLint**. Registered alongside the existing TypeScript + generic parsers.
- Artifact types beyond `execution.log`: JUnit/test reports, coverage, opt-in
  build outputs — surfaced in `inspect` and downloadable via the existing
  artifact endpoint.

**Key files.** `packages/diagnostics/src/*` (new parsers), `apps/worker` (artifact
collection), `packages/artifacts` (mime/type handling).

**Exit criteria.** A failing Vitest test yields a diagnostic with file, line, and
expected/received — matching the brief's example output.

**Risks.** Reporter output format drift (prefer machine reporters — JUnit/JSON —
over scraping human output where possible).

---

## Phase 4 — Minimal dashboard (`apps/web`)

**Goal.** A human-visible view of the execution history the system already
records.

**Deliverables.** React + Vite + TS. Two pages: **Executions** (id, project,
status, created, duration, step count) and **Execution detail** (intent, change
summary, plan with per-step status, diagnostics, artifacts). Live via the SSE
endpoint. Minimal styling — functional clarity over polish.

**Key files.** `apps/web/*` (new); wire into `pnpm dev`.

**Exit criteria.** Browse history and watch a live execution update in the
browser.

**Risks.** Low. CORS is already enabled on the API.

---

## Phase 5 — Hardening, cancellation, config, CI

**Goal.** Make it robust, observable, and safe to iterate on.

**Deliverables.**

- **CI** (bring forward if possible): GitHub Actions running
  `typecheck · test · lint · build` on PRs.
- **Cancellation execution:** wire the persisted cancel flag to an
  `AbortController` that kills the in-flight step (the flag + between-step checks
  exist; add mid-step interruption).
- **`axle.yaml`** full support (profile, steps, runtime resources, ignore).
- Structured logging + an error taxonomy (infrastructure vs user failures);
  queue-claim durability under crash; broader integration tests.

**Key files.** `.github/workflows/ci.yml` (new), `apps/worker` (cancellation),
`packages/config` + planner (`axle.yaml`).

**Exit criteria.** Green CI on every PR; a running execution can be cancelled;
config file overrides auto-detection.

---

## Phase 6+ — Platform trajectory

Larger, post-MVP arcs, each still behind today's seams:

- **Axle Plan** — planning informed by changed files, dependency graph, test
  impact, and historical failures, using the execution history Axle Graph
  already records.
- **More runtimes / profiles** — E2B, Daytona, Kubernetes, Firecracker,
  cloud/macOS/Windows workers; browser / Android / iOS / backend / ML profiles —
  all behind the `Runtime` interface.
- **Axle Control** — real governance at the `ExecutionPolicy` seam (allowed
  commands, network, secrets, limits, agent identity, repo permissions).
- **Review** and **Ship** — the remaining lifecycle stages.
- **Scale** — swap SQLite → Postgres and the DB queue → Redis/SQS behind their
  existing interfaces.

---

## Sequencing & parallelism

```
Phase 1 (verify) ──┬─► Phase 2 (Docker)   ─┐
                   ├─► Phase 3 (diagnostics)├─► Phase 5 (hardening/CI) ──► Phase 6+
                   └─► Phase 4 (dashboard)  ─┘
```

- **Phase 1 is the critical path** — it unlocks the product and everything after.
- After Phase 1, **Phases 2, 3, and 4 are largely independent** and can proceed
  in parallel (Docker, richer diagnostics, and the dashboard touch different
  packages).
- **CI (from Phase 5) should start during Phase 1** — it is cheap insurance and
  guards every later phase.
- Phase 6+ is continuous and begins once the MVP (Phases 1–5) is solid.
