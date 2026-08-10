import type {
  Diagnostic,
  Execution,
  ExecutionStatus,
  ExecutionStep,
  ExecutionStepStatus,
} from "@axle/contracts";
import pc from "picocolors";

export const symbols = {
  ok: pc.green("✓"),
  fail: pc.red("✕"),
  skip: pc.dim("○"),
  run: pc.cyan("▸"),
  pending: pc.dim("·"),
};

export function stepSymbol(status: ExecutionStepStatus): string {
  switch (status) {
    case "succeeded":
      return symbols.ok;
    case "failed":
    case "timedOut":
      return symbols.fail;
    case "skipped":
      return symbols.skip;
    case "running":
      return symbols.run;
    default:
      return symbols.pending;
  }
}

export function colorStatus(status: ExecutionStatus): string {
  switch (status) {
    case "succeeded":
      return pc.green(pc.bold(status));
    case "failed":
      return pc.red(pc.bold(status));
    case "cancelled":
      return pc.yellow(pc.bold(status));
    case "running":
    case "provisioning":
      return pc.cyan(status);
    default:
      return pc.dim(status);
  }
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function heading(title: string): void {
  process.stdout.write(`\n${pc.bold(pc.magenta("Axle"))} ${pc.dim(title)}\n`);
}

export function field(label: string, value: string): void {
  process.stdout.write(`  ${pc.dim(label.padEnd(14))} ${value}\n`);
}

export function renderDiagnostic(d: Diagnostic): string {
  const location = d.file
    ? pc.cyan(`${d.file}${d.line ? `:${d.line}` : ""}`)
    : pc.dim(d.type);
  return `  ${pc.red("●")} ${location} ${d.message}`;
}

export function renderStepLine(step: ExecutionStep): string {
  const duration = pc.dim(formatDuration(step.durationMs));
  const exit =
    step.exitCode !== undefined && step.exitCode !== null
      ? pc.dim(`exit ${step.exitCode}`)
      : "";
  return `  ${stepSymbol(step.status)} ${step.name.padEnd(16)} ${duration} ${exit}`.trimEnd();
}

/** Render the full detail view used by `axle inspect`. */
export function renderExecutionDetail(execution: Execution): void {
  heading(`Execution ${execution.id}`);
  field("Status", colorStatus(execution.status));
  if (execution.intent) field("Intent", execution.intent);
  field("Repository", execution.repository.name);
  field("Profile", execution.profile.name);
  field("Created", execution.createdAt);
  if (execution.metrics.totalDurationMs !== undefined) {
    field("Duration", formatDuration(execution.metrics.totalDurationMs));
  }

  process.stdout.write(`\n  ${pc.bold("Steps")}\n`);
  for (const step of execution.steps) {
    process.stdout.write(`${renderStepLine(step)}\n`);
  }

  if (execution.diagnostics.length > 0) {
    process.stdout.write(`\n  ${pc.bold("Diagnostics")}\n`);
    for (const d of execution.diagnostics) {
      process.stdout.write(`${renderDiagnostic(d)}\n`);
    }
  }

  if (execution.artifacts.length > 0) {
    process.stdout.write(`\n  ${pc.bold("Artifacts")}\n`);
    for (const artifact of execution.artifacts) {
      const size =
        artifact.sizeBytes !== undefined
          ? pc.dim(`${artifact.sizeBytes} bytes`)
          : "";
      process.stdout.write(`  ${symbols.ok} ${artifact.name} ${size}\n`);
    }
  }
  process.stdout.write("\n");
}

export function fail(message: string): never {
  process.stderr.write(`${pc.red("error")} ${message}\n`);
  process.exit(1);
}
