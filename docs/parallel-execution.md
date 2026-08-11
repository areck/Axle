# Parallel Agents & Conflicting Changes

How Axle handles many agents making conflicting changes at once — across
worktrees, from divergent bases — without them stepping on each other, and how it
answers the question git and CI cannot: *do these in-flight changes actually work
together?*

**See also:** [`local-runtime.md`](local-runtime.md) (the ephemeral sandbox +
scheduler that gives each execution its own ports/DB) ·
[`execution-infra.md`](execution-infra.md) (placement, the Graph, the merge-queue
in the overall architecture) · [`execution-model.md`](execution-model.md) (the
`ChangeSnapshot` and the execution Graph).

---

## The two problems hiding under one word

Separating them is the whole design:

- **Resource contention** (ports, test DBs, CPU, caches) — solved by the local
  runtime: each execution runs in its own ephemeral sandbox with its own network
  namespace + sidecars + a scheduler that reserves headroom. N agents don't
  collide *at run time*. See [`local-runtime.md`](local-runtime.md).
- **Change contention** — N agents editing overlapping code from divergent bases.
  git and worktrees only solve half. This document is about that half.

**Thesis:** git and worktrees isolate the *text*; they cannot tell you whether two
changes *work together*. Only execution can. Axle has isolated execution +
self-contained snapshots, so it verifies *combinations* of in-flight, uncommitted
changes — turning "conflict" from a merge problem into an **evidence** problem,
before anyone commits.

---

## 1. The snapshot is the unit of isolation, not the worktree

The [`ChangeSnapshot`](execution-model.md#the-change-snapshot) (baseSha +
materialized files) is a virtualized worktree. Worktrees today do two jobs —
authoring isolation *and* execution isolation; the second is the fragile one.
**Axle removes execution isolation from worktrees entirely** (execution runs in a
sandbox from the snapshot, never in the worktree), leaving worktrees to do only
lightweight authoring isolation.

Design decision: **worktree-aware, not worktree-dependent.**
- **Capture** from any worktree/branch/dir (`packages/git` → `git ls-files`).
  Bring-your-own worktrees just work.
- **Optionally manage** them: an `axle workspace` abstraction owns the lifecycle —
  `git worktree add` on a fresh branch off a base, track, snapshot, verify,
  integrate, tear down. That's the "handle multiple worktrees" answer: Axle
  orchestrates the fleet instead of the human hand-rolling `git worktree`.

---

## 2. The Graph is the live "who's touching what" map

Every execution records `baseSha` + `changedFiles` + outcome → a real-time index
of parallel work (nobody has this today; conflicts surface only at merge time).
**Overlap detection**, tiered by cost:

- **File-level** (both touch `auth.ts`) — cheap; ship first; early warning while
  work is in flight.
- **Hunk/region-level** (same functions/lines) — diff analysis.
- **Semantic** (A changes a signature B calls; A renames a symbol B imports) —
  dependency graph; the hard, valuable tier (Axle Graph / Plan intelligence).

---

## 3. Conflict prediction — before any commit

Trial three-way merge with **`git merge-tree`** (no working tree, no commit, no
branch pollution): "if A and B merged now, `auth.ts` conflicts at 40–55."
Pre-merge, in-flight.

---

## 4. The unlock — integration verification

Textual clean-merge ≠ works-together. A changes a return type; B adds a caller
expecting the old type → zero textual conflict, broken combination. Materialize
the *combination* into a sandbox and run verify: textual conflicts from
`merge-tree`, semantic conflicts from a failing typecheck/test with real
diagnostics. Neither git nor CI does this for uncommitted, in-flight, N-way work.

```
main@sha0
 ├─ workspace A (worktree/branch) → snapshot A ─┐
 ├─ workspace B                   → snapshot B ─┼─► Axle Graph: bases · changed files · outcomes
 └─ workspace C                   → snapshot C ─┘            │
        each snapshot → own sandbox → ISOLATION verify        ▼  overlap map (file → hunk → semantic)
                                        (passes alone?)        │
              ready changes ─────────────────────────────────┴─► INTEGRATION verify
                                                                   • trial merge-tree  (textual)
                                                                   • materialize A+B(+C) → sandbox → run (semantic)
                                                                            │
                                     MERGE QUEUE: serialize / speculate, re-verify on the MOVING target,
                                                  land the passing, kick back the failing WITH evidence
```

---

## 5. Integrating N passing changes — a merge queue, applied earlier

"Passes alone" ≠ "passes together, in order." A solved pattern (GitHub merge
queue, Bors, Zuul) that Axle's engine is shaped to run, applied to agent work
*before* PRs:

- **Serialize + re-verify against the moving target.** When A lands, re-verify B
  and C on top of the *new* HEAD (cheap snapshot rebase + re-execution; deps/image
  cached). Prevents "passed alone, broke on what landed first."
- **Speculative/optimistic execution (Zuul-style)** for throughput: assume the
  queue ahead lands, verify the speculative stack in parallel, roll back only
  actual failures.
- Axle **detects + evidences + routes**, does not auto-resolve: a conflict kicks
  back to the owning agent with the trial-merge hunk *and* the failing integration
  diagnostic. Auto-land only the provably clean.

---

## 6. Placement + intelligence

- **Integration matrix → cloud burst.** It's background, parallel, combinatorial —
  what one laptop can't do and elastic microVMs are for. Authoring + inner-loop
  verify stay local; the placement policy routes integration to cloud (see
  [`execution-infra.md`](execution-infra.md)).
- **Avoid N².** Prune with the dependency graph: only integration-verify
  combinations whose `changedFiles` (or dependency closures) overlap. Start with
  file-overlap pruning (now), escalate to dependency-aware test-impact (later);
  history tunes priorities.

---

## 7. Honest limits

Semantic detection is bounded by coverage (no test exercising the A+B interaction
→ not caught, though typecheck catches a large class); N-way is combinatorial
(mitigated by pruning + serialization, not eliminated); auto-resolution is out of
scope (Axle evidences and routes; agents/humans merge).

---

## 8. Shipping order

1. **Graph overlap map (file-level) + trial `merge-tree`** — cheap, immediate
   early-warning on conflicts, no execution needed.
2. **`axle workspace`** — manage the worktree/branch fleet + snapshot each.
3. **Integration verification** (pairwise, dep-pruned) — the differentiator.
4. **Merge queue + speculative execution** — integrate at scale, re-verify on the
   moving target.
5. **Semantic overlap via dependency graph** — smarter pruning + earlier warnings.

The one-liner: **worktrees isolate authoring, Axle sandboxes isolate execution,
and the Graph + integration verification handle the part neither git nor CI does —
proving whether many in-flight agent changes actually work together, with
evidence, before a single commit.**
