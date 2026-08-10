import type { StoredEvent } from "@axle/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";

const POLL_MS = 200;
const HEARTBEAT_TICKS = 50; // ~10s at 200ms/tick

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stream execution events to a client as Server-Sent Events.
 *
 * Replays history from seq 0, then tails new events until the execution
 * completes or the client disconnects. `fetchSince` is the only dependency, so
 * this helper carries no knowledge of how events are stored.
 */
export async function streamEvents(
  request: FastifyRequest,
  reply: FastifyReply,
  fetchSince: (sinceSeq: number) => Promise<StoredEvent[]>,
): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  raw.write(": connected\n\n");

  let lastSeq = 0;
  let closed = false;
  let idleTicks = 0;
  request.raw.on("close", () => {
    closed = true;
  });

  while (!closed) {
    const events = await fetchSince(lastSeq);
    for (const stored of events) {
      lastSeq = stored.seq;
      raw.write(`event: ${stored.event.type}\n`);
      raw.write(`data: ${JSON.stringify(stored.event)}\n\n`);
      if (stored.event.type === "execution.completed") closed = true;
    }
    if (closed) break;
    if (events.length === 0) {
      idleTicks += 1;
      if (idleTicks % HEARTBEAT_TICKS === 0) raw.write(": ping\n\n");
    } else {
      idleTicks = 0;
    }
    await sleep(POLL_MS);
  }
  raw.end();
}
