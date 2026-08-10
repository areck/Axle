import type { OutputChunk } from "@axle/runtime";
import { describe, expect, it } from "vitest";
import { OutputCoalescer } from "./output-coalescer";

function collect(threshold: number): {
  coalescer: OutputCoalescer;
  emitted: OutputChunk[];
} {
  const emitted: OutputChunk[] = [];
  const coalescer = new OutputCoalescer(threshold, (c) => emitted.push(c));
  return { coalescer, emitted };
}

describe("OutputCoalescer", () => {
  it("coalesces consecutive same-stream chunks into one flush", () => {
    const { coalescer, emitted } = collect(1024);
    coalescer.push({ stream: "stdout", data: "a" });
    coalescer.push({ stream: "stdout", data: "b" });
    coalescer.push({ stream: "stdout", data: "c" });
    expect(emitted).toHaveLength(0); // nothing until a boundary
    coalescer.flush();
    expect(emitted).toEqual([{ stream: "stdout", data: "abc" }]);
  });

  it("flushes on a stream switch, preserving order", () => {
    const { coalescer, emitted } = collect(1024);
    coalescer.push({ stream: "stdout", data: "out1" });
    coalescer.push({ stream: "stderr", data: "err1" });
    coalescer.push({ stream: "stdout", data: "out2" });
    coalescer.flush();
    expect(emitted).toEqual([
      { stream: "stdout", data: "out1" },
      { stream: "stderr", data: "err1" },
      { stream: "stdout", data: "out2" },
    ]);
  });

  it("flushes once the byte threshold is reached", () => {
    const { coalescer, emitted } = collect(4);
    coalescer.push({ stream: "stdout", data: "ab" });
    expect(emitted).toHaveLength(0);
    coalescer.push({ stream: "stdout", data: "cd" }); // hits threshold
    expect(emitted).toEqual([{ stream: "stdout", data: "abcd" }]);
    coalescer.push({ stream: "stdout", data: "ef" });
    coalescer.flush();
    expect(emitted).toEqual([
      { stream: "stdout", data: "abcd" },
      { stream: "stdout", data: "ef" },
    ]);
  });

  it("ignores empty chunks and no-op flushes", () => {
    const { coalescer, emitted } = collect(1024);
    coalescer.push({ stream: "stdout", data: "" });
    coalescer.flush(); // nothing buffered
    expect(emitted).toHaveLength(0);
  });
});
