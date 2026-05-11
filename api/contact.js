// Vercel serverless function — POST /api/contact
// Validates form, posts to Discord webhook.

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 3;
const ipHits = new Map();

function checkRate(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) return false;
  hits.push(now);
  ipHits.set(ip, hits);
  return true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const SERVICE_LABELS = {
  web: 'AI Web Build',
  saas: 'Custom SaaS / App',
  ops: 'VA / Operations',
  other: 'Something Else',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!checkRate(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many requests. Try again in a minute.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const { name, email, service, brief, website } = body;

  // Honeypot — silently succeed for bots
  if (website && String(website).trim() !== '') {
    return res.status(200).json({ ok: true });
  }

  const errors = [];
  if (!name || String(name).trim().length < 2 || String(name).length > 100) errors.push('name');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email)) || String(email).length > 200) errors.push('email');
  if (!brief || String(brief).trim().length < 10 || String(brief).length > 5000) errors.push('brief');
  if (errors.length) {
    return res.status(400).json({ ok: false, error: `Invalid: ${errors.join(', ')}` });
  }

  const serviceLabel = SERVICE_LABELS[service] || 'Not specified';
  const cleanName = String(name).trim();
  const cleanEmail = String(email).trim();
  const cleanBrief = String(brief).trim();

  const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

  if (!DISCORD_WEBHOOK_URL) {
    console.error('Missing env var: DISCORD_WEBHOOK_URL');
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }

  const discordPayload = {
    content: '@everyone new brief in',
    embeds: [{
      title: `${cleanName} — ${serviceLabel}`,
      color: 0x00D9FF,
      fields: [
        { name: 'Email', value: cleanEmail, inline: true },
        { name: 'Service', value: serviceLabel, inline: true },
        { name: 'Brief', value: cleanBrief.length > 1000 ? cleanBrief.slice(0, 1000) + '…' : cleanBrief },
      ],
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: { parse: ['everyone'] },
  };

  try {
    const discordRes = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload),
    });

    if (!discordRes.ok) {
      const errText = await discordRes.text();
      console.error('Discord webhook error:', discordRes.status, errText);
      return res.status(502).json({ ok: false, error: 'Could not send. Try again in a moment.' });
    }
  } catch (err) {
    console.error('Discord webhook failed:', err);
    return res.status(502).json({ ok: false, error: 'Could not send. Try again in a moment.' });
  }

  return res.status(200).json({ ok: true });
}
