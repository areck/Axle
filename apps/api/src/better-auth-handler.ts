import type { Auth } from "@axle/auth";
import type { FastifyPluginAsync } from "fastify";

/**
 * Mount Better Auth's request handler under `/api/auth/*`.
 *
 * This exposes the full OAuth surface — social sign-in + callbacks, magic-link
 * request/verify, the device-authorization endpoints, session, and API-key
 * management — which the CLI device flow and the browser sign-in page drive.
 *
 * Registered as an encapsulated plugin so its raw-body content-type parser is
 * scoped here: the `/v1` routes keep Fastify's normal JSON parsing, while Better
 * Auth receives the untouched request body it needs.
 */
export function betterAuthPlugin(auth: Auth): FastifyPluginAsync {
  return async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );

    scope.all("/*", async (request, reply) => {
      const host = request.headers.host ?? "localhost";
      const url = new URL(request.url, `${request.protocol}://${host}`);

      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }

      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      const body = hasBody ? (request.body as Buffer | undefined) : undefined;

      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers,
          body: body && body.length > 0 ? body : undefined,
        }),
      );

      reply.status(response.status);
      // `set-cookie` can repeat; forEach would collapse them, so set it as an
      // array from getSetCookie() and copy the remaining headers verbatim.
      const setCookies = response.headers.getSetCookie?.() ?? [];
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") return;
        reply.header(key, value);
      });
      if (setCookies.length > 0) reply.header("set-cookie", setCookies);

      return reply.send(Buffer.from(await response.arrayBuffer()));
    });
  };
}
