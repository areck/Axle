# Legacy runtime scaffold

This package is an unimplemented artifact of the initial bootstrap. It is not a
supported runtime, not a security boundary, and not part of Axle's roadmap.

Axle's target architecture has no Docker dependency, daemon requirement, image
workflow, socket, or automatic Docker-to-local selection. Runtime selection will
use explicit workload requirements and verified provider capabilities, with
microVM isolation as the default for autonomous agent work.

The package, its worker/config selection path, and its diagnostic probe are
scheduled for removal in the isolation-contract milestone. See the
[isolation ladder](../../docs/isolation-ladder.md) and
[delivery plan](../../docs/plan.md).
