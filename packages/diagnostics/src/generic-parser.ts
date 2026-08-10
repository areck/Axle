import {
  type Diagnostic,
  type DiagnosticType,
  newDiagnosticId,
} from "@axle/contracts";
import type { DiagnosticParser, ParseContext } from "./types";

// Built from a runtime string so the pattern carries no literal control char.
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");

// Tiers, most useful first: the thrown error line ("AssertionError: …"), then a
// full assertion phrase, then any failure line, then the last line of output.
// Kept deliberately generic — framework-specific parsers arrive in a later pass.
const ERROR_LINE = /[a-z]*error\s*:/i;
const ASSERTION =
  /\bexpected\b[^\n]*\b(?:to be|to equal|to match|to contain|received)\b/i;
const FAILURE = /\berror\b|\bfailed\b|\bfail\b|not ok|cannot|exception/i;

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
    const lines = ctx.output
      .replace(ANSI_PATTERN, "")
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);

    const chosen = pickMessageLine(lines);
    const message =
      chosen?.trim().slice(0, 500) ??
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

function pickMessageLine(lines: string[]): string | undefined {
  return (
    lines.findLast((line) => ERROR_LINE.test(line)) ??
    lines.findLast((line) => ASSERTION.test(line)) ??
    lines.findLast((line) => FAILURE.test(line)) ??
    lines.at(-1)
  );
}

function inferType(ctx: ParseContext): DiagnosticType {
  const hay = `${ctx.name} ${ctx.command}`.toLowerCase();
  if (/\btest\b|vitest|jest|mocha/.test(hay)) return "test";
  if (/\blint\b|eslint|biome/.test(hay)) return "lint";
  if (/build|tsc|compile|typecheck/.test(hay)) return "build";
  if (/install|npm ci|pnpm i|yarn/.test(hay)) return "infrastructure";
  return "unknown";
}
