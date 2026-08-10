import type {
  CreateExecutionRequest,
  Execution,
  ExecutionEvent,
  ExecutionListResponse,
} from "@axle/contracts";

/**
 * Thin HTTP client for the Axle API. Uses the global `fetch` (Node 22+).
 */
export class AxleClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async createExecution(request: CreateExecutionRequest): Promise<Execution> {
    const res = await fetch(`${this.baseUrl}/v1/executions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to create execution (${res.status}): ${await res.text()}`,
      );
    }
    return (await res.json()) as Execution;
  }

  async getExecution(id: string): Promise<Execution> {
    const res = await fetch(`${this.baseUrl}/v1/executions/${id}`);
    if (res.status === 404) throw new Error(`Execution ${id} not found.`);
    if (!res.ok) throw new Error(`Failed to fetch execution (${res.status}).`);
    return (await res.json()) as Execution;
  }

  async listExecutions(): Promise<ExecutionListResponse> {
    const res = await fetch(`${this.baseUrl}/v1/executions`);
    if (!res.ok) throw new Error(`Failed to list executions (${res.status}).`);
    return (await res.json()) as ExecutionListResponse;
  }

  /** Subscribe to an execution's event stream (Server-Sent Events). */
  async *streamEvents(
    id: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ExecutionEvent> {
    const res = await fetch(`${this.baseUrl}/v1/executions/${id}/events`, {
      headers: { accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Failed to open event stream (${res.status}).`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        try {
          yield JSON.parse(dataLine.slice(5).trim()) as ExecutionEvent;
        } catch {
          // ignore comments / heartbeats / malformed frames
        }
      }
    }
  }
}
