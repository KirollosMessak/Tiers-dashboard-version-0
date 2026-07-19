// GreenGo Dashboard — simple shared-password gate.
//
// Runs before every request (via Vercel Edge Middleware) and blocks access
// to the whole site unless the visitor has entered the correct password.
//
// Two secrets are read from Vercel Environment Variables (never committed to
// this file, never visible to site visitors):
//   DASHBOARD_PASSWORD   - the shared password the team types in
//   DASHBOARD_AUTH_TOKEN - a random opaque value used as the session cookie
//                          (NOT the password itself, so the cookie never
//                          contains or leaks the actual password)
//
// Set both in the Vercel dashboard: Project -> Settings -> Environment
// Variables (or via `vercel env add DASHBOARD_PASSWORD` /
// `vercel env add DASHBOARD_AUTH_TOKEN` in the terminal), then redeploy.

export const config = {
  matcher: "/((?!_vercel).*)",
};

const COOKIE_NAME = "gg_auth";
const MAX_AGE_SECONDS = 60 * 60 * 24; // 1 day

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx > -1) {
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      cookies[key] = value;
    }
  });
  return cookies;
}

function loginPageHtml(errorMessage) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GreenGo Dashboard — Sign in</title>
<style>
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:#0a0c10; color:#e7ebf0;
    display:flex; align-items:center; justify-content:center;
    min-height:100vh; margin:0;
  }
  form{
    background:#14171c; padding:2rem 2.5rem; border-radius:12px;
    border:1px solid rgba(255,255,255,.08); width:280px;
    box-shadow:0 8px 24px rgba(0,0,0,.4);
  }
  h1{ font-size:1.05rem; margin:0 0 1.25rem; font-weight:700; }
  input{
    width:100%; padding:.6rem .8rem; margin-bottom:1rem;
    border-radius:8px; border:1px solid rgba(255,255,255,.15);
    background:#0e1116; color:#fff; box-sizing:border-box; font-size:.95rem;
  }
  input:focus{ outline:none; border-color:#2f9e44; }
  button{
    width:100%; padding:.65rem; border:none; border-radius:8px;
    background:#2f9e44; color:#fff; font-weight:600; font-size:.95rem;
    cursor:pointer;
  }
  button:hover{ background:#1c6e2b; }
  .err{ color:#ff8787; font-size:.85rem; margin-bottom:.75rem; }
</style>
</head>
<body>
  <form method="POST">
    <h1>🍓 GreenGo Dashboard</h1>
    ${errorMessage ? `<div class="err">${errorMessage}</div>` : ""}
    <input type="password" name="password" placeholder="Password" autofocus required />
    <button type="submit">Enter</button>
  </form>
</body>
</html>`;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get("cookie"));
  const expectedToken = process.env.DASHBOARD_AUTH_TOKEN;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;

  // Misconfigured: no password set yet -> fail closed with a clear message
  // rather than silently letting everyone in.
  if (!expectedToken || !expectedPassword) {
    return new Response(
      "Dashboard login is not configured yet. Set DASHBOARD_PASSWORD and " +
        "DASHBOARD_AUTH_TOKEN in Vercel project environment variables, then redeploy.",
      { status: 500, headers: { "Content-Type": "text/plain" } }
    );
  }

  // Already authenticated (valid session cookie) -> let the request through.
  if (cookies[COOKIE_NAME] && cookies[COOKIE_NAME] === expectedToken) {
    return;
  }

  // Handle a submitted login form.
  if (request.method === "POST") {
    const formData = await request.formData();
    const submitted = formData.get("password");

    if (submitted && submitted === expectedPassword) {
      const res = new Response(null, {
        status: 302,
        headers: { Location: url.pathname === "/" ? "/" : url.pathname },
      });
      res.headers.append(
        "Set-Cookie",
        `${COOKIE_NAME}=${expectedToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`
      );
      return res;
    }

    return new Response(loginPageHtml("Wrong password, try again."), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Not authenticated, not a login submission -> show the login form.
  return new Response(loginPageHtml(), {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
