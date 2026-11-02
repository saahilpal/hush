import indexHtml from './index.html';
import { classify } from './classify.js';

const GIF_BYTES = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
  0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0x02, 0x01, 0x44, 0x00, 0x3b
]);

const GIF_HEADERS = {
  'Content-Type': 'image/gif',
  'Content-Length': '43',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0'
};

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) {
    let diff = 1;
    for (let i = 0; i < aBuf.byteLength; i++) {
      diff |= aBuf[i] ^ aBuf[i];
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

async function getSessionToken(password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('hush-session'));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

async function isSessionValid(request, env) {
  if (!env.PASSWORD) return false;
  const cookie = getCookie(request, 's');
  if (!cookie) return false;
  const expected = await getSessionToken(env.PASSWORD);
  return timingSafeEqual(cookie, expected);
}

async function isAuthorized(request, env, isCreateOrSelfView = false) {
  if (await isSessionValid(request, env)) return true;
  if (isCreateOrSelfView && env.API_TOKEN) {
    const auth = request.headers.get('Authorization') || '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      return timingSafeEqual(token, env.API_TOKEN);
    }
  }
  return false;
}

async function detectMxProvider(recipientEmail) {
  const domainMatch = recipientEmail.match(/@([^@\s>]+)/);
  if (!domainMatch) return 'unknown';
  const domain = domainMatch[1].toLowerCase();

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return 'google';
  }
  if (domain === 'outlook.com' || domain === 'hotmail.com' || domain === 'live.com') {
    return 'Microsoft 365';
  }
  if (domain === 'yahoo.com' || domain === 'ymail.com') {
    return 'Yahoo';
  }

  try {
    const dohRes = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { 'accept': 'application/dns-json' }
    });
    if (dohRes.ok) {
      const dohData = await dohRes.json();
      const answers = (dohData.Answer || []).map(a => (a.data || '').toLowerCase()).join(' ');
      if (/google|aspmx|googlemail/i.test(answers)) {
        return 'google';
      }
      if (/outlook|microsoft|protection\.outlook/i.test(answers)) {
        return 'Microsoft 365';
      }
      if (/proofpoint|pphosted/i.test(answers)) {
        return 'Proofpoint';
      }
      if (/mimecast/i.test(answers)) {
        return 'Mimecast';
      }
      if (answers) {
        return 'Corporate Mail';
      }
    }
  } catch {}
  return 'unknown';
}

async function logHit(emailId, request, env, isClick) {
  try {
    const email = await env.DB.prepare(
      'SELECT id, recipient, subject, created, last_self_view, mx_provider FROM emails WHERE id = ?'
    )
      .bind(emailId)
      .first();
    if (!email) return;

    const countRow = await env.DB.prepare('SELECT COUNT(*) as c FROM hits WHERE email = ?').bind(emailId).first();
    if (countRow && countRow.c >= 200) return;

    const now = Date.now();
    const ageMs = now - email.created;
    const ua = request.headers.get('user-agent') || '';
    const net = request.cf?.asOrganization || '';
    const country = request.cf?.country || '';
    const clientIp = request.headers.get('cf-connecting-ip') || '';
    const quietSeconds = env.QUIET_SECONDS ? parseInt(env.QUIET_SECONDS, 10) : 90;
    const quietMs = quietSeconds * 1000;

    let isSelfView = false;
    let selfViewReason = '';

    // 1. Check if the request has the sender's dashboard session cookie
    if (await isSessionValid(request, env)) {
      isSelfView = true;
      selfViewReason = 'Sender (authenticated session)';
    }

    // 2. Check if the request IP matches the last known sender IP
    if (!isSelfView && clientIp) {
      const senderIpRow = await env.DB.prepare('SELECT value FROM settings WHERE key = "last_sender_ip"').first();
      if (senderIpRow && senderIpRow.value === clientIp) {
        isSelfView = true;
        selfViewReason = 'Sender network (IP match)';
      }
    }

    // 3. Check if the sender recently opened the sent email in Gmail (extension self-view alert)
    if (!isSelfView && email.last_self_view && (now - email.last_self_view < 60000)) {
      isSelfView = true;
      selfViewReason = 'Sender viewed sent email';
    }

    const mxProvider = email.mx_provider || 'unknown';

    const [kind, why] = classify({
      ua,
      net,
      country,
      ageMs,
      quietMs,
      isClick,
      isSelfView,
      selfViewReason,
      mxProvider
    });

    const tierRow = await env.DB.prepare('SELECT COUNT(*) as c FROM hits WHERE email = ? AND kind = ?')
      .bind(emailId, kind)
      .first();
    const isFirstOfTier = !tierRow || tierRow.c === 0;

    await env.DB.prepare('INSERT INTO hits (email, at, kind, why) VALUES (?, ?, ?, ?)')
      .bind(emailId, now, kind, why)
      .run();

    if (isFirstOfTier && env.NOTIFY_URL && kind !== 'auto') {
      let title = 'Likely opened';
      if (kind === 'confirmed') title = 'Link clicked';
      const body = `${email.recipient}: ${email.subject || '(no subject)'} (${why})`;
      await fetch(env.NOTIFY_URL, {
        method: 'POST',
        headers: {
          'Title': title,
          'Content-Type': 'text/plain; charset=utf-8'
        },
        body
      }).catch(() => {});
    }
  } catch (err) {
    console.error('Error logging hit:', err);
  }
}

function renderLoginPage(errorMessage = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hush — Login</title>
  <style>
    :root {
      --ink: #1b2236;
      --bg: #f5f6f8;
      --panel: #ffffff;
      --line: #e6e8ed;
      --blue: #3d4fd6;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --ink: #e2e5ec;
        --bg: #0f121d;
        --panel: #171b29;
        --line: #262c3f;
        --blue: #5b6df5;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--ink);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 24px;
      width: 100%;
      max-width: 360px;
    }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 16px; }
    label { display: block; font-size: 13px; margin-bottom: 6px; }
    input[type="password"] {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--line);
      background: var(--bg);
      color: var(--ink);
      border-radius: 4px;
      font-size: 14px;
      margin-bottom: 16px;
      outline: none;
    }
    input[type="password"]:focus {
      border-color: var(--blue);
    }
    button {
      width: 100%;
      padding: 8px 12px;
      background: var(--blue);
      color: #ffffff;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    .error {
      color: #d32f2f;
      font-size: 13px;
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hush</h1>
    ${errorMessage ? `<div class="error">${errorMessage}</div>` : ''}
    <form method="POST" action="/login">
      <label for="pw">Password</label>
      <input type="password" id="pw" name="pw" required autofocus>
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const clientIp = request.headers.get('cf-connecting-ip') || '';

    // 1. Pixel endpoint: GET /p/<id>.gif or /p/<id>
    if (path.startsWith('/p/')) {
      const match = path.match(/^\/p\/([^/.]+)(?:\.gif)?$/);
      if (match) {
        const id = match[1];
        if (request.method === 'GET') {
          ctx.waitUntil(logHit(id, request, env, false));
        }
        return new Response(GIF_BYTES, { status: 200, headers: GIF_HEADERS });
      }
    }

    // 2. Tracked link endpoint: GET /l/<id>
    if (path.startsWith('/l/')) {
      const match = path.match(/^\/l\/([^/]+)$/);
      if (match) {
        const id = match[1];
        const email = await env.DB.prepare('SELECT link FROM emails WHERE id = ?').bind(id).first();
        if (!email || !email.link) {
          return new Response('Not found', { status: 404 });
        }
        ctx.waitUntil(logHit(id, request, env, true));
        return Response.redirect(email.link, 302);
      }
    }

    // 3. Login routes
    if (path === '/login') {
      if (request.method === 'GET') {
        if (await isSessionValid(request, env)) {
          return Response.redirect(url.origin + '/', 302);
        }
        const error = url.searchParams.has('error') ? 'Invalid password' : '';
        return new Response(renderLoginPage(error), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      if (request.method === 'POST') {
        let pw = '';
        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          try {
            const body = await request.json();
            pw = body.pw || '';
          } catch {}
        } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
          try {
            const formData = await request.formData();
            pw = formData.get('pw') || '';
          } catch {}
        } else {
          pw = (await request.text()).trim();
        }

        const valid = env.PASSWORD && timingSafeEqual(pw, env.PASSWORD);
        if (!valid) {
          await new Promise(r => setTimeout(r, 800));
          if (contentType.includes('application/json')) {
            return Response.json({ error: 'Invalid password' }, { status: 401 });
          }
          return new Response(renderLoginPage('Invalid password'), {
            status: 401,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }

        // Remember sender IP upon successful login
        if (clientIp) {
          ctx.waitUntil(
            env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ("last_sender_ip", ?, ?)')
              .bind(clientIp, Date.now())
              .run()
              .catch(() => {})
          );
        }

        const token = await getSessionToken(env.PASSWORD);
        const cookieHeader = `s=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`;
        if (contentType.includes('application/json')) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': cookieHeader
            }
          });
        }
        return new Response(null, {
          status: 302,
          headers: {
            'Location': '/',
            'Set-Cookie': cookieHeader
          }
        });
      }
    }

    // 4. Logout route
    if (path === '/logout') {
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/login',
          'Set-Cookie': 's=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
        }
      });
    }

    // 5. API routes: /api/*
    if (path.startsWith('/api/')) {
      const isCreateOrSelfView =
        (request.method === 'POST' && path === '/api/emails') ||
        (request.method === 'POST' && path.includes('/self-view'));
      const authorized = await isAuthorized(request, env, isCreateOrSelfView);
      if (!authorized) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Record sender IP on any authenticated API call
      if (clientIp) {
        ctx.waitUntil(
          env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ("last_sender_ip", ?, ?)')
            .bind(clientIp, Date.now())
            .run()
            .catch(() => {})
        );
      }

      // Self-view registration: POST /api/emails/<id>/self-view
      const matchSelfView = path.match(/^\/api\/emails\/([^/]+)\/self-view$/);
      if (matchSelfView && request.method === 'POST') {
        const id = matchSelfView[1];
        await env.DB.prepare('UPDATE emails SET last_self_view = ? WHERE id = ?')
          .bind(Date.now(), id)
          .run();
        return Response.json({ ok: true });
      }

      // GET /api/emails: latest 100 emails with hits
      if (path === '/api/emails' && request.method === 'GET') {
        const [emailsRes, hitsRes] = await env.DB.batch([
          env.DB.prepare('SELECT * FROM emails ORDER BY created DESC LIMIT 100'),
          env.DB.prepare(`
            SELECT email, at, kind, why FROM hits
            WHERE email IN (SELECT id FROM (SELECT id FROM emails ORDER BY created DESC LIMIT 100))
            ORDER BY at ASC
          `)
        ]);

        const hitsMap = {};
        for (const h of hitsRes.results || []) {
          if (!hitsMap[h.email]) hitsMap[h.email] = [];
          hitsMap[h.email].push({ at: h.at, kind: h.kind, why: h.why });
        }

        const data = (emailsRes.results || []).map(e => ({
          ...e,
          hits: hitsMap[e.id] || []
        }));
        return Response.json(data);
      }

      // POST /api/emails: create new email tracker
      if (path === '/api/emails' && request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }

        const to = (body.to || '').trim();
        if (!to) {
          return Response.json({ error: '"to" is required' }, { status: 400 });
        }
        const recipient = to.slice(0, 120);
        const subject = (body.subject || '').trim();
        let link = (body.link || '').trim();

        if (link) {
          if (!/^https?:\/\//i.test(link)) {
            link = 'https://' + link;
          }
          try {
            new URL(link);
          } catch {
            return Response.json({ error: 'Invalid URL for link' }, { status: 400 });
          }
        }

        const bytes = crypto.getRandomValues(new Uint8Array(12));
        const id = btoa(String.fromCharCode(...bytes))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const created = Date.now();
        const follow_at = created + 3 * 24 * 60 * 60 * 1000;

        // Automatically detect recipient domain MX provider
        const mxProvider = await detectMxProvider(recipient);

        await env.DB.prepare(
          'INSERT INTO emails (id, recipient, subject, link, created, follow_at, followups, replied, mx_provider, last_self_view) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, 0)'
        )
          .bind(id, recipient, subject, link, created, follow_at, mxProvider)
          .run();

        return Response.json({ id, mxProvider });
      }

      // Email action routes: /api/emails/<id>/...
      const matchReplied = path.match(/^\/api\/emails\/([^/]+)\/replied$/);
      if (matchReplied && request.method === 'POST') {
        const id = matchReplied[1];
        await env.DB.prepare(
          'UPDATE emails SET replied = CASE WHEN replied = 1 THEN 0 ELSE 1 END WHERE id = ?'
        )
          .bind(id)
          .run();
        return Response.json({ ok: true });
      }

      const matchFollowup = path.match(/^\/api\/emails\/([^/]+)\/followup$/);
      if (matchFollowup && request.method === 'POST') {
        const id = matchFollowup[1];
        const newFollowAt = Date.now() + 3 * 24 * 60 * 60 * 1000;
        await env.DB.prepare(
          'UPDATE emails SET followups = followups + 1, follow_at = ? WHERE id = ?'
        )
          .bind(newFollowAt, id)
          .run();
        return Response.json({ ok: true });
      }

      const matchDelete = path.match(/^\/api\/emails\/([^/]+)(?:\/delete)?$/);
      if (matchDelete && (request.method === 'POST' || request.method === 'DELETE')) {
        const id = matchDelete[1];
        await env.DB.batch([
          env.DB.prepare('DELETE FROM emails WHERE id = ?').bind(id),
          env.DB.prepare('DELETE FROM hits WHERE email = ?').bind(id)
        ]);
        return Response.json({ ok: true });
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    // 6. Dashboard: GET /
    if (path === '/') {
      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      if (!(await isSessionValid(request, env))) {
        return Response.redirect(url.origin + '/login', 302);
      }

      // Record sender IP upon viewing dashboard
      if (clientIp) {
        ctx.waitUntil(
          env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ("last_sender_ip", ?, ?)')
            .bind(clientIp, Date.now())
            .run()
            .catch(() => {})
        );
      }

      return new Response(indexHtml, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:",
          'X-Frame-Options': 'DENY',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer'
        }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};
