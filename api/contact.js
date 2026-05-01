// Vercel serverless function — POST /api/contact
// Validates form, sends email via Resend, posts to Discord webhook.

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

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;
  const FROM_EMAIL = process.env.FROM_EMAIL || 'notifications@stackandsignal.agency';
  const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

  if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
    console.error('Missing env vars: RESEND_API_KEY or NOTIFY_EMAIL');
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;color:#0A1628;">
      <h2 style="color:#00D9FF;margin:0 0 8px;">New brief — Stack &amp; Signal</h2>
      <p style="margin:0 0 24px;color:#666;">Submitted ${new Date().toUTCString()}</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#666;width:120px;">Name</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(cleanName)}</td></tr>
        <tr><td style="padding:8px 0;color:#666;">Email</td><td style="padding:8px 0;"><a href="mailto:${escapeHtml(cleanEmail)}" style="color:#00D9FF;">${escapeHtml(cleanEmail)}</a></td></tr>
        <tr><td style="padding:8px 0;color:#666;">Service</td><td style="padding:8px 0;">${escapeHtml(serviceLabel)}</td></tr>
      </table>
      <h3 style="margin:24px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#666;">Brief</h3>
      <div style="white-space:pre-wrap;background:#F5F8FA;padding:16px;border-radius:8px;border-left:3px solid #00D9FF;">${escapeHtml(cleanBrief)}</div>
      <p style="margin:24px 0 0;color:#999;font-size:12px;">Reply directly to this email to respond.</p>
    </div>
  `;

  const resendPayload = {
    from: `Stack & Signal <${FROM_EMAIL}>`,
    to: [NOTIFY_EMAIL],
    reply_to: cleanEmail,
    subject: `New brief: ${cleanName} — ${serviceLabel}`,
    html,
  };

  const discordPayload = DISCORD_WEBHOOK_URL ? {
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
  } : null;

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(resendPayload),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error('Resend error:', emailRes.status, errText);
      return res.status(502).json({ ok: false, error: 'Could not send. Try again or email nick@stackandsignal.agency directly.' });
    }
  } catch (err) {
    console.error('Resend fetch failed:', err);
    return res.status(502).json({ ok: false, error: 'Could not send. Try again or email nick@stackandsignal.agency directly.' });
  }

  // Discord is best-effort — don't fail the request if it errors
  if (discordPayload) {
    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload),
    }).catch((err) => console.error('Discord webhook failed:', err));
  }

  return res.status(200).json({ ok: true });
}
