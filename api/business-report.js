// Server-side proxy for WF16's business-report webhook.
//
// Same rules as dashboard-data.js: the n8n key lives in a Vercel env var and
// never reaches the browser, and middleware.js has already checked the session
// cookie before this runs.
//
// Environment variables (already set for dashboard-data.js — nothing new):
//   N8N_WEBHOOK_URL    e.g. https://<your-instance>.app.n8n.cloud/webhook
//   N8N_DASHBOARD_KEY  value of the "dashboard key" Header Auth credential

const HEADER_NAME = 'X-Dashboard-Key';
const TIMEOUT_MS = 25000;

// Only these periods are accepted. Anything else from the browser is dropped,
// so nobody can make WF16 crunch an arbitrary range.
const ALLOWED_DAYS = ['7', '30', '90'];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const base = process.env.N8N_WEBHOOK_URL;
  const key = process.env.N8N_DASHBOARD_KEY;

  if (!base || !key) {
    console.error('[business-report] N8N_WEBHOOK_URL or N8N_DASHBOARD_KEY is not set');
    return res.status(500).json({ error: 'server_not_configured' });
  }

  const days = ALLOWED_DAYS.includes(String(req.query.days)) ? String(req.query.days) : '30';

  try {
    const upstream = await fetch(`${base.replace(/\/+$/, '')}/business-report?days=${days}`, {
      method: 'GET',
      headers: { [HEADER_NAME]: key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!upstream.ok) {
      console.error('[business-report] n8n responded', upstream.status);
      return res.status(502).json({ error: 'upstream_error' });
    }

    const data = await upstream.json();

    // WF16 reads six sheets per call. A one-minute private cache stops
    // repeated clicks on the period buttons from burning the Sheets quota.
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[business-report] proxy failed:', err.message);
    return res.status(504).json({ error: 'upstream_unavailable' });
  }
}
