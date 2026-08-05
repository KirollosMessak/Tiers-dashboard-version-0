// Server-side proxy for WF10's content-request webhook.
//
// This one deserves more care than the read endpoint: it triggers WF9, which
// calls OpenAI. An unvalidated request here costs the client real money, so the
// payload is whitelisted and length-capped before it is forwarded.
//
// Environment variables:
//   N8N_WEBHOOK_URL    e.g. https://<your-instance>.app.n8n.cloud/webhook
//   N8N_DASHBOARD_KEY  same key as the Header Auth credential on WF10

const HEADER_NAME = 'X-Dashboard-Key';
const TIMEOUT_MS = 25000;

const ALLOWED_PLATFORMS = ['facebook', 'instagram', 'tiktok'];

const str = (v, max) => String(v ?? '').trim().slice(0, max);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const base = process.env.N8N_WEBHOOK_URL;
  const key = process.env.N8N_DASHBOARD_KEY;

  if (!base || !key) {
    console.error('[content-request] N8N_WEBHOOK_URL or N8N_DASHBOARD_KEY is not set');
    return res.status(500).json({ error: 'server_not_configured' });
  }

  // Vercel parses JSON bodies automatically, but be defensive about the shape.
  const body = typeof req.body === 'object' && req.body !== null ? req.body : {};

  // WF9 builds a whole post around product. Empty means the copywriter writes
  // about nothing, so reject it here rather than paying for a useless run.
  const product = str(body.product, 200);
  if (!product) {
    return res.status(400).json({ error: 'product_required' });
  }

  const platforms = str(body.platforms, 100)
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => ALLOWED_PLATFORMS.includes(p));

  if (!platforms.length) {
    return res.status(400).json({ error: 'platforms_required' });
  }

  // Only these fields are forwarded. Anything else the browser sends is dropped,
  // and the caps stop a large body being pushed into the model prompt.
  const payload = {
    product,
    occasion: str(body.occasion, 200),
    key_points: str(body.key_points, 1000),
    tone: str(body.tone, 100),
    platforms: platforms.join(','),
    wants_reel: body.wants_reel === true || body.wants_reel === 'true',
    requested_at: new Date().toISOString(),
  };

  try {
    const upstream = await fetch(`${base.replace(/\/+$/, '')}/content-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [HEADER_NAME]: key,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!upstream.ok) {
      console.error('[content-request] n8n responded', upstream.status);
      return res.status(502).json({ error: 'upstream_error' });
    }

    const data = await upstream.json().catch(() => ({ ok: true }));
    return res.status(200).json(data);
  } catch (err) {
    console.error('[content-request] proxy failed:', err.message);
    return res.status(504).json({ error: 'upstream_unavailable' });
  }
}
