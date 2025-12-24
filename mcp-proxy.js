#!/usr/bin/env node

/**
 * Local Proxy for MCP Bridge
 *
 * This proxy runs on localhost and forwards requests to the remote server.
 * This helps bypass macOS application-level network restrictions.
 */

const http = require('http');
const httpProxy = require('http-proxy');

const TARGET_HOST = process.env.PROMPT_DB_URL || 'http://192.168.11.225:3003';
const PROXY_PORT = 3004;

// Create proxy server
const proxy = httpProxy.createProxyServer({
  target: TARGET_HOST,
  changeOrigin: true,
});

// Create HTTP server that uses the proxy
const server = http.createServer((req, res) => {
  console.log(`[Proxy] ${req.method} ${req.url} -> ${TARGET_HOST}`);

  proxy.web(req, res, (err) => {
    if (err) {
      console.error('[Proxy] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
    }
  });
});

// Error handling
proxy.on('error', (err, req, res) => {
  console.error('[Proxy] Proxy error:', err.message);
  if (res.writeHead) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
  }
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`[Proxy] Listening on http://localhost:${PROXY_PORT}`);
  console.log(`[Proxy] Forwarding to ${TARGET_HOST}`);
});
