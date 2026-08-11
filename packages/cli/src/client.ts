import type {
  CreateExecutionRequest,
  Environment,
  Execution,
  ExecutionEvent,
  ExecutionListResponse,
  SetEnvironmentRequest,
} from "@axle/contracts";
import { resolveApiKey } from "./keystore";

/**
 * Thin HTTP client for the Axle API. Uses the global `fetch` (Node 22+).
 *
 * The API requires an API key (bearer) on every endpoint except `/health` and
 * the login exchange; the key comes from `axle login` (stored) or `AXLE_API_KEY`
 * and is attached to each request.
 */
export class AxleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | undefined = resolveApiKey(),
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.token
      ? { ...extra, authorization: `Bearer ${this.token}` }
      : extra;
  }

  private unauthorized(): Error {
    return new Error(
      "Unauthorized (401) — run `axle login` (or set AXLE_API_KEY).",
    );
  }

  /** Exchange email/password for an API key (the login exchange is open). */
  async login(
    email: string,
    password: string,
  ): Promise<{ key: string; role: string }> {
    const res = await fetch(`${this.baseUrl}/v1/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 401) throw new Error("Invalid email or password.");
    if (!res.ok) throw new Error(`Login failed (${res.status}).`);
    return (await res.json()) as { key: string; role: string };
  }

  async whoami(): Promise<{ userId: string; role: string } | null> {
    const res = await fetch(`${this.baseUrl}/v1/auth/whoami`, {
      headers: this.headers(),
    });
    if (res.status === 401) throw this.unauthorized();
    if (!res.ok) throw new Error(`whoami failed (${res.status}).`);
    return (
      (await res.json()) as { identity: { userId: string; role: string } }
    ).identity;
  }

  async createUser(body: {
    email: string;
    password: string;
    name?: string;
    role: string;
  }): Promise<{ userId: string; role: string }> {
    const res = await fetch(`${this.baseUrl}/v1/auth/users`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw this.unauthorized();
    if (res.status === 403) {
      throw new Error("Forbidden — creating users requires the admin role.");
    }
    if (!res.ok) {
      throw new Error(`Failed to create user (${res.status}).`);
    }
    return (await res.json()) as { userId: string; role: string };
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
