// Server-side proxy for WF10's dashboard-all-data webhook.
//
// Why this file exists:
//   The browser must never hold the n8n key. If index.html called n8n directly,
//   the key would sit in the page source and anyone could read it in devtools.
//   Here it lives in a Vercel environment variable and never leaves the server.
//
// Access control:
//   middleware.js runs before this and rejects anyone without a valid session
//   cookie, so reaching this function already means the visitor logged in.
//
// Environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   N8N_WEBHOOK_URL    e.g. https://<your-instance>.app.n8n.cloud/webhook
//   N8N_DASHBOARD_KEY  the value of the Header Auth credential set on the
//                      WF10 webhook nodes. Generate with: openssl rand -hex 32

const HEADER_NAME = 'X-Dashboard-Key';
const TIMEOUT_MS = 25000;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const base = process.env.N8N_WEBHOOK_URL;
  const key = process.env.N8N_DASHBOARD_KEY;

  // Fail closed and loudly rather than silently returning nothing.
  if (!base || !key) {
    console.error('[dashboard-data] N8N_WEBHOOK_URL or N8N_DASHBOARD_KEY is not set');
    return res.status(500).json({ error: 'server_not_configured' });
  }

  try {
    const upstream = await fetch(`${base.replace(/\/+$/, '')}/dashboard-all-data`, {
      method: 'GET',
      headers: { [HEADER_NAME]: key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!upstream.ok) {
      // Log the real status for us; tell the browser nothing useful about n8n.
      console.error('[dashboard-data] n8n responded', upstream.status);
      return res.status(502).json({ error: 'upstream_error' });
    }

    const data = await upstream.json();

    // WF10 makes six sequential Google Sheets reads per call. A short private
    // cache keeps a refresh-happy user from burning through the Sheets quota.
    res.setHeader('Cache-Control', 'private, max-age=20');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[dashboard-data] proxy failed:', err.message);
    return res.status(504).json({ error: 'upstream_unavailable' });
  }
}
