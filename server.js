const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3001;
const METABASE_URL = (process.env.METABASE_URL || '').replace(/\/$/, '');
const METABASE_API_KEY = process.env.METABASE_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '943701391495-qae2ifdl3hqrni4s6kgqe6c1j19qc914.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';
const SESSION_SECRET = process.env.SESSION_SECRET || 'shopdeck-rca-secret-2026';
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || '';
const LOG_FILE = path.join(__dirname, 'usage_log.jsonl');

console.log('Starting ShopDeck RCA server...');
console.log('PORT:', PORT);
console.log('METABASE_URL:', METABASE_URL || '(not set)');
console.log('ALLOWED_DOMAIN:', ALLOWED_DOMAIN || '(any Google account)');

// SESSION STORE
const sessions = {};

function createSession(email, name) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { email, name, createdAt: Date.now() };
  return token;
}

function getSession(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/rca_session=([a-f0-9]+)/);
  if (!match) return null;
  const session = sessions[match[1]];
  if (!session) return null;
  if (Date.now() - session.createdAt > 8 * 60 * 60 * 1000) {
    delete sessions[match[1]];
    return null;
  }
  return session;
}

function setCookieHeader(token) {
  return `rca_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`;
}

// USAGE LOGGING
function logUsage(email, name, action, detail) {
  const entry = { ts: new Date().toISOString(), email, name, action, detail };
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n'); }
  catch (e) { console.error('Log write error:', e.message); }
}

// HTTP HELPER
function makeRequest(targetUrl, options, body) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new url.URL(targetUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method: options.method || 'GET',
        headers: options.headers || {}
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    } catch (e) { reject(e); }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

// GOOGLE OAUTH
function getRedirectUri(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}/auth/callback`;
}

function getLoginPage(error) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ShopDeck RCA Login</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Epilogue:wght@400;500&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Epilogue',sans-serif;background:#f4f1eb;display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{background:#fff;border-radius:16px;padding:40px;width:360px;text-align:center;border:1px solid rgba(0,0,0,.08);}.mark{width:40px;height:40px;background:#d13b27;border-radius:8px;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:#fff;margin:0 auto 16px;}h1{font-family:'Syne',sans-serif;font-size:20px;font-weight:700;color:#17130f;margin-bottom:6px;}p{font-size:13px;color:#a09a93;margin-bottom:28px;line-height:1.5;}.error{background:#fdf0ee;color:#d13b27;font-size:12px;padding:10px 14px;border-radius:8px;margin-bottom:16px;border:1px solid rgba(209,59,39,.15);}.google-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:11px 20px;border:1px solid rgba(0,0,0,.13);border-radius:8px;background:#fff;font-size:14px;font-weight:500;color:#17130f;cursor:pointer;text-decoration:none;transition:background .15s;}.google-btn:hover{background:#f4f1eb;}</style>
</head><body><div class="card"><div class="mark">S</div><h1>Seller RCA Console</h1><p>Sign in with your Google account to continue.</p>${error ? `<div class="error">${error}</div>` : ''}<a href="/auth/login" class="google-btn"><svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58z"/></svg>Sign in with Google</a></div></body></html>`;
}

function getUnauthorizedPage(email) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Access Denied</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700&family=Epilogue:wght@400;500&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Epilogue',sans-serif;background:#f4f1eb;display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{background:#fff;border-radius:16px;padding:40px;width:360px;text-align:center;border:1px solid rgba(0,0,0,.08);}.mark{width:40px;height:40px;background:#d13b27;border-radius:8px;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:#fff;margin:0 auto 16px;}h1{font-family:'Syne',sans-serif;font-size:20px;font-weight:700;color:#17130f;margin-bottom:10px;}p{font-size:13px;color:#a09a93;margin-bottom:6px;line-height:1.5;}.email{font-size:12px;font-family:monospace;color:#d13b27;background:#fdf0ee;padding:4px 10px;border-radius:4px;display:inline-block;margin:8px 0 20px;}a{font-size:13px;color:#d13b27;}</style>
</head><body><div class="card"><div class="mark">S</div><h1>Access denied</h1><p>This account is not authorised.</p><div class="email">${email}</div><p>Contact your admin to get access.</p><br><a href="/auth/logout">Try a different account</a></div></body></html>`;
}

function getLogsPage(session) {
  let logs = [];
  try {
    if (fs.existsSync(LOG_FILE)) {
      logs = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).reverse();
    }
  } catch (e) { console.error('Log read error:', e.message); }

  const byUser = {};
  logs.forEach(l => {
    if (!byUser[l.email]) byUser[l.email] = { name: l.name, count: 0, last: l.ts };
    if (l.action === 'investigate') byUser[l.email].count++;
    if (l.ts > byUser[l.email].last) byUser[l.email].last = l.ts;
  });

  const summaryRows = Object.entries(byUser).sort((a,b) => b[1].count - a[1].count).map(([email, d]) =>
    `<tr><td>${d.name||'—'}</td><td>${email}</td><td style="text-align:center;font-weight:500;">${d.count}</td><td style="color:#a09a93;">${new Date(d.last).toLocaleString('en-IN')}</td></tr>`
  ).join('');

  const logRows = logs.slice(0, 200).map(l =>
    `<tr><td style="color:#a09a93;white-space:nowrap;">${new Date(l.ts).toLocaleString('en-IN')}</td><td>${l.name||'—'}</td><td>${l.email}</td><td><span style="background:${l.action==='investigate'?'#edf7f1':l.action==='login'?'#edf2fb':'#f4f1eb'};color:${l.action==='investigate'?'#267a47':l.action==='login'?'#2558a0':'#5c5650'};padding:2px 8px;border-radius:4px;font-size:11px;">${l.action}</span></td><td style="color:#5c5650;max-width:300px;">${l.detail||''}</td></tr>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ShopDeck RCA — Usage Logs</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700&family=Epilogue:wght@400;500&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Epilogue',sans-serif;background:#f4f1eb;color:#17130f;font-size:14px;}.nav{background:#17130f;height:46px;padding:0 28px;display:flex;align-items:center;justify-content:space-between;}.nav-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:600;color:#fff;}.nav-links{display:flex;gap:12px;align-items:center;}.nav-links a{font-size:12px;color:rgba(255,255,255,.5);text-decoration:none;}.nav-links a:hover{color:#fff;}.nav-user{font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(255,255,255,.4);}.page{max-width:1000px;margin:0 auto;padding:28px;}h2{font-family:'Syne',sans-serif;font-size:16px;font-weight:600;margin-bottom:14px;}.card{background:#fff;border:1px solid rgba(0,0,0,.07);border-radius:12px;overflow:hidden;margin-bottom:24px;}table{width:100%;border-collapse:collapse;}th{text-align:left;padding:10px 16px;font-family:'JetBrains Mono',monospace;font-size:9px;color:#a09a93;letter-spacing:.06em;border-bottom:1px solid rgba(0,0,0,.07);background:#f4f1eb;}td{padding:10px 16px;border-bottom:1px solid rgba(0,0,0,.05);font-size:13px;}tr:last-child td{border-bottom:none;}tr:hover td{background:#fafaf8;}</style>
</head><body>
<nav class="nav"><span class="nav-title">ShopDeck RCA — Usage Logs</span><div class="nav-links"><span class="nav-user">${session.email}</span><a href="/">← Back to tool</a><a href="/auth/logout">Log out</a></div></nav>
<div class="page">
  <h2>Usage by person</h2>
  <div class="card"><table><thead><tr><th>NAME</th><th>EMAIL</th><th>INVESTIGATIONS RUN</th><th>LAST ACTIVE</th></tr></thead><tbody>${summaryRows||'<tr><td colspan="4" style="color:#a09a93;text-align:center;padding:20px;">No data yet</td></tr>'}</tbody></table></div>
  <h2>Full log (last 200 events)</h2>
  <div class="card"><table><thead><tr><th>TIME</th><th>NAME</th><th>EMAIL</th><th>ACTION</th><th>DETAIL</th></tr></thead><tbody>${logRows||'<tr><td colspan="5" style="color:#a09a93;text-align:center;padding:20px;">No logs yet</td></tr>'}</tbody></table></div>
</div></body></html>`;
}

// SERVER
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); res.end(); return; }

  // Auth routes (no session required)
  if (pathname === '/auth/login') {
    const redirectUri = getRedirectUri(req);
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile&state=${state}&prompt=select_account`;
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  if (pathname === '/auth/callback') {
    const { code, error } = parsed.query;
    if (error || !code) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getLoginPage('Google login was cancelled. Please try again.'));
      return;
    }
    try {
      const redirectUri = getRedirectUri(req);
      const tokenRes = await makeRequest('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }, `code=${code}&client_id=${GOOGLE_CLIENT_ID}&client_secret=${GOOGLE_CLIENT_SECRET}&redirect_uri=${encodeURIComponent(redirectUri)}&grant_type=authorization_code`);

      const tokenData = JSON.parse(tokenRes.body);
      if (!tokenData.access_token) throw new Error('No access token received');

      const userRes = await makeRequest('https://www.googleapis.com/oauth2/v2/userinfo', {
        method: 'GET', headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const user = JSON.parse(userRes.body);
      const email = user.email || '';
      const name = user.name || email;

      if (ALLOWED_DOMAIN && !email.endsWith('@' + ALLOWED_DOMAIN)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getUnauthorizedPage(email));
        return;
      }

      const token = createSession(email, name);
      logUsage(email, name, 'login', 'Logged in');
      console.log(`Login: ${email}`);
      res.writeHead(302, { Location: '/', 'Set-Cookie': setCookieHeader(token) });
      res.end();
    } catch (e) {
      console.error('OAuth error:', e.message);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getLoginPage('Something went wrong during login: ' + e.message));
    }
    return;
  }

  if (pathname === '/auth/logout') {
    res.writeHead(302, { Location: '/auth/login', 'Set-Cookie': 'rca_session=; Path=/; Max-Age=0' });
    res.end();
    return;
  }

  // Session gate
  const session = getSession(req.headers.cookie);
  if (!session) {
    if (pathname.startsWith('/api/') || pathname === '/health') {
      res.writeHead(401, corsHeaders()); res.end(JSON.stringify({ error: 'Not authenticated' }));
    } else {
      res.writeHead(302, { Location: '/auth/login' }); res.end();
    }
    return;
  }

  if (pathname === '/health') {
    res.writeHead(200, corsHeaders());
    res.end(JSON.stringify({ ok: true, user: session.email }));
    return;
  }

  if (pathname === '/admin/logs') {
    if (session.email !== 'arunabh.mishra@blitzscale.co') {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f4f1eb;"><div style="text-align:center;"><h2 style="color:#d13b27;">Access denied</h2><p style="color:#a09a93;margin-top:8px;">You do not have permission to view logs.</p><br><a href="/" style="color:#d13b27;font-size:13px;">← Back to tool</a></div></body></html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getLogsPage(session));
    return;
  }

  if (pathname === '/api/fetch-all' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { sellerId, sellerField, questionIds } = JSON.parse(body);
        const results = {};
        await Promise.all(Object.entries(questionIds).map(async ([key, qId]) => {
          if (!qId) { results[key] = null; return; }
          try {
            const reqBody = JSON.stringify({ parameters: [{ type: 'category', target: ['variable', ['template-tag', sellerField || 'seller_id']], value: sellerId }] });
            console.log(`[${session.email}] Fetching Q${qId} for ${sellerId}`);
            const r = await makeRequest(`${METABASE_URL}/api/card/${qId}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': METABASE_API_KEY } }, reqBody);
            results[key] = (r.status === 200 || r.status === 202) ? JSON.parse(r.body) : { error: `HTTP ${r.status}` };
          } catch (e) { results[key] = { error: e.message }; }
        }));
        res.writeHead(200, corsHeaders());
        res.end(JSON.stringify(results));
      } catch (e) {
        res.writeHead(500, corsHeaders()); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/analyse' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        logUsage(session.email, session.name, 'investigate', `Seller: ${payload.sellerId || 'unknown'}`);
        console.log(`[${session.email}] Analysing ${payload.sellerId || 'unknown'}`);
        const result = await makeRequest('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
        }, JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, messages: payload.messages }));
        console.log(`Claude: ${result.status}`);
        if (result.status !== 200) console.error('Claude error:', result.body);
        res.writeHead(result.status, corsHeaders());
        res.end(result.body);
      } catch (e) {
        res.writeHead(500, corsHeaders()); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'GET') {
    const filePath = path.join(__dirname, 'index.html');
    if (fs.existsSync(filePath)) {
      let html = fs.readFileSync(filePath, 'utf8');
      html = html.replace('</body>', `<script>
window.addEventListener('DOMContentLoaded', () => {
  const navRight = document.querySelector('.nav .nav-btn')?.parentElement;
  if (navRight) {
    const pill = document.createElement('div');
    pill.style.cssText = 'font-family:var(--mono);font-size:10px;color:rgba(255,255,255,.5);background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:3px 10px;';
    pill.textContent = ${JSON.stringify(session.name || session.email)};
    navRight.insertBefore(pill, navRight.firstChild);
    const logoutBtn = document.createElement('a');
    logoutBtn.href = '/auth/logout';
    logoutBtn.style.cssText = 'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:5px 12px;font-size:12px;color:rgba(255,255,255,.6);text-decoration:none;';
    logoutBtn.textContent = 'Log out';
    const logsBtn = document.createElement('a');
    logsBtn.href = '/admin/logs';
    logsBtn.target = '_blank';
    logsBtn.style.cssText = 'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:5px 12px;font-size:12px;color:rgba(255,255,255,.6);text-decoration:none;';
    logsBtn.textContent = 'View logs';
    if (${JSON.stringify(session.email)} === 'arunabh.mishra@blitzscale.co') navRight.appendChild(logsBtn);
    navRight.appendChild(logoutBtn);
  }
});
</script></body>`);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } else {
      res.writeHead(404, corsHeaders()); res.end(JSON.stringify({ error: 'index.html not found' }));
    }
    return;
  }

  res.writeHead(404, corsHeaders()); res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => console.log(`ShopDeck RCA server running on port ${PORT}`));
process.on('uncaughtException', e => console.error('Uncaught:', e.message));
process.on('unhandledRejection', e => console.error('Unhandled:', e));
