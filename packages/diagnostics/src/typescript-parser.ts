import { type Diagnostic, newDiagnosticId } from "@axle/contracts";
import type { DiagnosticParser, ParseContext } from "./types";

// Matches: src/foo.ts(18,7): error TS2322: Type 'x' is not assignable to 'y'.
const TS_ERROR = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/gm;

/**
 * Parses `tsc` compiler diagnostics into structured build errors.
 */
export class TypeScriptParser implements DiagnosticParser {
  readonly name = "typescript";

  applies(ctx: ParseContext): boolean {
    TS_ERROR.lastIndex = 0;
    return TS_ERROR.test(ctx.combined);
  }

  parse(ctx: ParseContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    TS_ERROR.lastIndex = 0;
    for (const match of ctx.combined.matchAll(TS_ERROR)) {
      const [line, file, lineNo, colNo, code, message] = match;
      diagnostics.push({
        id: newDiagnosticId(),
        type: "build",
        severity: "error",
        message: `${code}: ${message}`.trim(),
        file,
        line: Number(lineNo),
        column: Number(colNo),
        stepId: ctx.stepId,
        rawReference: line.trim(),
      });
    }
    return diagnostics;
  }
}
