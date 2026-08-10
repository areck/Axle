import type { Diagnostic } from "@axle/contracts";
import { GenericParser } from "./generic-parser";
import type { DiagnosticParser, ParseContext } from "./types";
import { TypeScriptParser } from "./typescript-parser";

/**
 * Runs the registered parsers over a step's output and produces normalized
 * diagnostics. Specific parsers run first; the fallback parser only fires when
 * nothing more specific matched a failing step.
 */
export class DiagnosticsEngine {
  private readonly parsers: DiagnosticParser[];
  private readonly fallback: DiagnosticParser;

  constructor(options?: {
    parsers?: DiagnosticParser[];
    fallback?: DiagnosticParser;
  }) {
    this.parsers = options?.parsers ?? [new TypeScriptParser()];
    this.fallback = options?.fallback ?? new GenericParser();
  }

  parseStep(ctx: ParseContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const parser of this.parsers) {
      if (parser.applies(ctx)) {
        diagnostics.push(...parser.parse(ctx));
      }
    }
    if (diagnostics.length === 0 && this.fallback.applies(ctx)) {
      diagnostics.push(...this.fallback.parse(ctx));
    }
    return diagnostics.map((d) => ({ ...d, stepId: d.stepId ?? ctx.stepId }));
  }
}
