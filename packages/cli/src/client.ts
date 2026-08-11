import type {
  CreateExecutionRequest,
  Environment,
  Execution,
  ExecutionEvent,
  ExecutionListResponse,
  SetEnvironmentRequest,
} from "@axle/contracts";

/**
 * Thin HTTP client for the Axle API. Uses the global `fetch` (Node 22+).
 *
 * The API requires a bearer token on every endpoint except `/health`; the token
 * comes from `AXLE_API_TOKEN` by default and is attached to each request.
 */
export class AxleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | undefined = process.env.AXLE_API_TOKEN,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.token
      ? { ...extra, authorization: `Bearer ${this.token}` }
      : extra;
  }

  private unauthorized(): Error {
    return new Error(
      "Unauthorized (401) — set AXLE_API_TOKEN to match the API's token.",
    );
  }

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
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(request),
    });
    if (res.status === 401) throw this.unauthorized();
    if (!res.ok) {
      throw new Error(
        `Failed to create execution (${res.status}): ${await res.text()}`,
      );
    }
    return (await res.json()) as Execution;
  }

  async getExecution(id: string): Promise<Execution> {
    const res = await fetch(`${this.baseUrl}/v1/executions/${id}`, {
      headers: this.headers(),
    });
    if (res.status === 401) throw this.unauthorized();
    if (res.status === 404) throw new Error(`Execution ${id} not found.`);
    if (!res.ok) throw new Error(`Failed to fetch execution (${res.status}).`);
    return (await res.json()) as Execution;
  }

  async listExecutions(): Promise<ExecutionListResponse> {
    const res = await fetch(`${this.baseUrl}/v1/executions`, {
      headers: this.headers(),
    });
    if (res.status === 401) throw this.unauthorized();
    if (!res.ok) throw new Error(`Failed to list executions (${res.status}).`);
    return (await res.json()) as ExecutionListResponse;
  }

  async listEnvironments(): Promise<Environment[]> {
    const res = await fetch(`${this.baseUrl}/v1/environments`, {
      headers: this.headers(),
    });
    if (res.status === 401) throw this.unauthorized();
    if (!res.ok)
      throw new Error(`Failed to list environments (${res.status}).`);
    return ((await res.json()) as { environments: Environment[] }).environments;
  }

  async getEnvironment(name: string): Promise<Environment> {
    const res = await fetch(`${this.baseUrl}/v1/environments/${name}`, {
      headers: this.headers(),
    });
    if (res.status === 401) throw this.unauthorized();
    if (res.status === 404) throw new Error(`Environment "${name}" not found.`);
    if (!res.ok)
      throw new Error(`Failed to fetch environment (${res.status}).`);
    return (await res.json()) as Environment;
  }

  async setEnvironment(
    name: string,
    body: SetEnvironmentRequest,
  ): Promise<Environment> {
    const res = await fetch(`${this.baseUrl}/v1/environments/${name}`, {
      method: "PUT",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw this.unauthorized();
    if (!res.ok) {
      throw new Error(
        `Failed to set environment (${res.status}): ${await res.text()}`,
      );
    }
    return (await res.json()) as Environment;
  }

  async deleteEnvironment(name: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/v1/environments/${name}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (res.status === 401) throw this.unauthorized();
    if (res.status === 404) return false;
    if (!res.ok)
      throw new Error(`Failed to delete environment (${res.status}).`);
    return true;
  }

  /** Subscribe to an execution's event stream (Server-Sent Events). */
  async *streamEvents(
    id: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ExecutionEvent> {
    const res = await fetch(`${this.baseUrl}/v1/executions/${id}/events`, {
      headers: this.headers({ accept: "text/event-stream" }),
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
