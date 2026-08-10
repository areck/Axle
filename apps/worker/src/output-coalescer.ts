import type { OutputChunk } from "@axle/runtime";

/**
 * Coalesces a step's streamed output into fewer, larger chunks before they
 * become persisted `step.output` events.
 *
 * A build tool can emit hundreds of tiny writes; one DB-writing event per write
 * amplifies load on the shared SQLite file for no benefit — the consumer only
 * needs the bytes in order. This buffers consecutive same-stream output and
 * flushes on three boundaries that preserve fidelity: a stream switch (so
 * stdout/stderr interleaving is never reordered), a size threshold (so a burst
 * still streams incrementally), and an explicit end-of-step {@link flush}. The
 * unabridged byte stream still reaches the log artifact and the diagnostics
 * parsers separately — only the event granularity changes.
 */
export class OutputCoalescer {
  private stream: OutputChunk["stream"] | null = null;
  private buffer = "";
  private bufferedBytes = 0;

  constructor(
    private readonly thresholdBytes: number,
    private readonly sink: (chunk: OutputChunk) => void,
  ) {}

  push(chunk: OutputChunk): void {
    if (chunk.data.length === 0) return;
    if (this.stream !== null && this.stream !== chunk.stream) {
      this.flush();
    }
    this.stream = chunk.stream;
    this.buffer += chunk.data;
    this.bufferedBytes += Buffer.byteLength(chunk.data);
    if (this.bufferedBytes >= this.thresholdBytes) {
      this.flush();
    }
  }

  /** Emit anything buffered as a single event and reset. */
  flush(): void {
    if (this.stream !== null && this.buffer.length > 0) {
      this.sink({ stream: this.stream, data: this.buffer });
    }
    this.stream = null;
    this.buffer = "";
    this.bufferedBytes = 0;
  }
}
