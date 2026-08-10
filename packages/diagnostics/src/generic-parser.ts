import {
  type Diagnostic,
  type DiagnosticType,
  newDiagnosticId,
} from "@axle/contracts";
import type { DiagnosticParser, ParseContext } from "./types";

/**
 * Fallback parser: turns any failed command into a single structured diagnostic
 * so a failure is never returned as opaque terminal output. The engine only
 * invokes it when no more specific parser produced a diagnostic.
 */
export class GenericParser implements DiagnosticParser {
  readonly name = "generic";

  applies(ctx: ParseContext): boolean {
    return ctx.exitCode === null || ctx.exitCode !== 0;
  }

  parse(ctx: ParseContext): Diagnostic[] {
    const lines = ctx.combined
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);
    const last = lines.at(-1);
    const message =
      last?.slice(0, 500) ??
      `Step "${ctx.name}" failed (exit ${ctx.exitCode ?? "killed"}).`;

    return [
      {
        id: newDiagnosticId(),
        type: inferType(ctx),
        severity: "error",
        message,
        stepId: ctx.stepId,
        rawReference: lines.slice(-5).join("\n") || undefined,
      },
    ];
  }
}

function inferType(ctx: ParseContext): DiagnosticType {
  const hay = `${ctx.name} ${ctx.command}`.toLowerCase();
  if (/\btest\b|vitest|jest|mocha/.test(hay)) return "test";
  if (/\blint\b|eslint|biome/.test(hay)) return "lint";
  if (/build|tsc|compile|typecheck/.test(hay)) return "build";
  if (/install|npm ci|pnpm i|yarn/.test(hay)) return "infrastructure";
  return "unknown";
}
