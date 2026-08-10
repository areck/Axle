# @axle/runtime-docker

The Docker implementation of the Axle [`Runtime`](../runtime) interface. It is
the intended **production isolation boundary** for local development.

## Status

**Stubbed in this bootstrap pass.** `isAvailable()` is implemented (it pings the
Docker daemon), so runtime selection and `axle doctor` behave correctly. The
container lifecycle (`createEnvironment`) throws `NotImplementedError` and is the
subject of the next runtime pass. The `LocalRuntime` (`@axle/runtime-local`) is
the working runtime today.

## Planned implementation

`createEnvironment` will return an `ExecutionEnvironment` backed by a container
(via `dockerode` or the Docker CLI):

1. **create** a container from the profile image (e.g. `axle/node-22`), with:
   - `--cpus` / `--memory` from the execution's resource limits,
   - a non-root user, `--init`, read-only root where possible,
   - **no** Docker socket mounted, **no** host filesystem bind mounts,
   - a dedicated ephemeral workspace volume, `workdir=/workspace`.
2. **prepareWorkspace** — stream the base tree + patch + untracked files into
   `/workspace` (`putArchive`), apply the patch, materialize untracked files.
3. **run** — `exec` each command, streaming stdout/stderr, enforcing the step
   timeout and output cap, capturing the exit code.
4. **collectArtifacts** — `getArchive` requested output paths.
5. **destroy** — force-remove the container (guaranteed via the engine's
   `finally`).

## What Docker isolation does — and does not — guarantee

Containers share the host kernel. Docker provides resource limits and namespace
isolation, but it is **not** a strong security boundary against a determined
attacker (kernel exploits, misconfiguration). Treat submitted code as untrusted:
no secrets, no host mounts, no socket. Production Axle Runtime will move to
hardened isolation (microVMs / Firecracker or equivalent). See
[`docs/architecture.md`](../../docs/architecture.md) and the security notes in
the root `README.md`.
