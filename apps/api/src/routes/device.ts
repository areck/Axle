import type { FastifyPluginAsync } from "fastify";

export interface DevicePageOptions {
  /** Which social providers to offer buttons for (those with credentials). */
  github: boolean;
  google: boolean;
}

/**
 * Serve the device-authorization approval page at `GET /device` — the
 * `verification_uri` the CLI prints. A human opens it, signs in passwordlessly
 * (GitHub/Google/magic link), and approves the pending device code. It's a
 * deliberately minimal, dependency-free page; a richer web app supersedes it
 * later. All of its `fetch`es hit the open `/api/auth/*` surface.
 */
export function deviceRoutes(options: DevicePageOptions): FastifyPluginAsync {
  const html = renderPage(options);
  return async (app) => {
    app.get("/device", async (_request, reply) => {
      return reply.type("text/html; charset=utf-8").send(html);
    });
  };
}

function renderPage(options: DevicePageOptions): string {
  const providerButtons = [
    options.github
      ? `<button class="provider" data-provider="github">Continue with GitHub</button>`
      : "",
    options.google
      ? `<button class="provider" data-provider="google">Continue with Google</button>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Client script kept as a plain string to avoid TS template nesting.
  const script = String.raw`
    const params = new URLSearchParams(location.search);
    const returnUrl = location.pathname + location.search;
    const el = (id) => document.getElementById(id);
    const show = (id) => { el(id).style.display = "block"; };
    const hide = (id) => { el(id).style.display = "none"; };
    const setStatus = (msg, kind) => {
      const s = el("status");
      s.textContent = msg;
      s.className = "status " + (kind || "");
    };

    async function getSession() {
      try {
        const r = await fetch("/api/auth/get-session", {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (!r.ok) return null;
        const data = await r.json();
        return data && data.user ? data : null;
      } catch {
        return null;
      }
    }

    async function signInSocial(provider) {
      setStatus("Redirecting to " + provider + "…");
      const r = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, callbackURL: returnUrl }),
      });
      const data = await r.json().catch(() => ({}));
      if (data && data.url) { location.href = data.url; return; }
      setStatus("Could not start " + provider + " sign-in.", "error");
    }

    async function sendMagicLink(email) {
      setStatus("Sending a sign-in link to " + email + "…");
      const r = await fetch("/api/auth/sign-in/magic-link", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, callbackURL: returnUrl }),
      });
      if (r.ok) {
        setStatus("Check your email for a sign-in link, then return here. " +
          "(In local dev the link is printed to the API server logs.)", "ok");
      } else {
        setStatus("Could not send a magic link.", "error");
      }
    }

    async function approve(userCode) {
      setStatus("Approving…");
      const r = await fetch("/api/auth/device/approve", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCode }),
      });
      if (r.ok) {
        hide("approve-form");
        setStatus("Approved. You can close this tab and return to your terminal.", "ok");
      } else {
        const err = await r.json().catch(() => ({}));
        setStatus(err.message || "Approval failed. Check the code and try again.", "error");
      }
    }

    async function deny(userCode) {
      await fetch("/api/auth/device/deny", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userCode }),
      });
      hide("approve-form");
      setStatus("Request denied.", "error");
    }

    async function main() {
      const session = await getSession();
      if (session) {
        hide("signin");
        show("approve-form");
        el("who").textContent = "Signed in as " + (session.user.email || session.user.name);
        el("code").value = params.get("user_code") || "";
      } else {
        show("signin");
        hide("approve-form");
      }
    }

    document.querySelectorAll(".provider").forEach((b) => {
      b.addEventListener("click", () => signInSocial(b.dataset.provider));
    });
    el("magic-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const email = el("email").value.trim();
      if (email) sendMagicLink(email);
    });
    el("approve-btn").addEventListener("click", () => {
      const code = el("code").value.trim();
      if (code) approve(code); else setStatus("Enter the code shown in your terminal.", "error");
    });
    el("deny-btn").addEventListener("click", () => {
      const code = el("code").value.trim();
      if (code) deny(code);
    });
    main();
  `;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize Axle CLI</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: Canvas; color: CanvasText; }
  .card { width: min(92vw, 420px); border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 14px; padding: 28px; box-shadow: 0 10px 40px color-mix(in srgb, CanvasText 8%, transparent); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; opacity: 0.7; font-size: 14px; }
  button { font: inherit; cursor: pointer; border-radius: 10px; padding: 11px 14px; width: 100%;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); background: color-mix(in srgb, CanvasText 6%, Canvas); color: CanvasText; }
  button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  button.ghost { background: transparent; }
  .provider { margin-bottom: 10px; }
  .divider { display: flex; align-items: center; gap: 12px; margin: 18px 0; opacity: 0.5; font-size: 12px; }
  .divider::before, .divider::after { content: ""; height: 1px; flex: 1; background: currentColor; }
  input { font: inherit; width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 10px;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); background: Canvas; color: CanvasText; margin-bottom: 10px; }
  label { font-size: 12px; opacity: 0.7; display: block; margin-bottom: 6px; }
  .row { display: flex; gap: 10px; }
  .status { margin-top: 16px; font-size: 14px; min-height: 1.2em; }
  .status.error { color: #dc2626; }
  .status.ok { color: #16a34a; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
  <div class="card">
    <h1>Authorize Axle CLI</h1>
    <p class="sub">Approve the device shown in your terminal.</p>

    <div id="signin" style="display:none">
      ${providerButtons}
      ${providerButtons ? `<div class="divider">or</div>` : ""}
      <form id="magic-form">
        <label for="email">Email a magic link</label>
        <input id="email" type="email" placeholder="you@example.com" autocomplete="email" required />
        <button type="submit" class="ghost">Send sign-in link</button>
      </form>
    </div>

    <div id="approve-form" style="display:none">
      <p class="sub" id="who"></p>
      <label for="code">Device code</label>
      <input id="code" type="text" inputmode="text" autocomplete="off" spellcheck="false" />
      <div class="row">
        <button id="approve-btn" class="primary">Approve</button>
        <button id="deny-btn" class="ghost">Deny</button>
      </div>
    </div>

    <div id="status" class="status"></div>
  </div>
  <script>${script}</script>
</body>
</html>`;
}
