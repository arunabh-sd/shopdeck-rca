const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3001;
const METABASE_URL = process.env.METABASE_URL || '';
const METABASE_API_KEY = process.env.METABASE_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

function makeRequest(targetUrl, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);

  // Health check
  if (parsed.pathname === '/health') {
    res.writeHead(200, corsHeaders());
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Metabase query: POST /api/metabase?questionId=42&sellerId=SD-123&sellerField=seller_id
  if (parsed.pathname === '/api/metabase' && req.method === 'POST') {
    const { questionId, sellerId, sellerField } = parsed.query;
    if (!questionId || !sellerId) {
      res.writeHead(400, corsHeaders());
      res.end(JSON.stringify({ error: 'questionId and sellerId required' }));
      return;
    }
    try {
      const body = JSON.stringify({
        parameters: [{
          type: 'category',
          target: ['variable', ['template-tag', sellerField || 'seller_id']],
          value: sellerId
        }]
      });
      const result = await makeRequest(
        `${METABASE_URL}/api/card/${questionId}/query`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': METABASE_API_KEY
          }
        },
        body
      );
      res.writeHead(result.status, corsHeaders());
      res.end(result.body);
    } catch (e) {
      res.writeHead(500, corsHeaders());
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Claude analysis: POST /api/analyse
  if (parsed.pathname === '/api/analyse' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const result = await makeRequest(
          'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01'
            }
          },
          JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            messages: payload.messages
          })
        );
        res.writeHead(result.status, corsHeaders());
        res.end(result.body);
      } catch (e) {
        res.writeHead(500, corsHeaders());
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Serve index.html for everything else
  if (req.method === 'GET') {
    const fs = require('fs');
    const filePath = __dirname + '/index.html';
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404, corsHeaders());
      res.end(JSON.stringify({ error: 'index.html not found' }));
    }
    return;
  }

  res.writeHead(404, corsHeaders());
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`ShopDeck RCA server running on port ${PORT}`);
});
