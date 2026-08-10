import type { Diagnostic } from "@axle/contracts";

/**
 * The observation handed to a parser: everything known about one finished step.
 */
export interface ParseContext {
  stepId: string;
  /** Step name, e.g. "typecheck", "test", "install". */
  name: string;
  command: string;
  /** The step's combined stdout + stderr, in the order it was produced. */
  output: string;
  exitCode: number | null;
}

/**
 * A pluggable parser that normalizes tool output into structured diagnostics.
 *
 * Parsers are intentionally small and independent so the set can grow
 * (TypeScript, Jest, Vitest, ESLint, …) without touching the engine.
 */
export interface DiagnosticParser {
  readonly name: string;
  applies(ctx: ParseContext): boolean;
  parse(ctx: ParseContext): Diagnostic[];
}
