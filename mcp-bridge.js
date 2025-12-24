#!/usr/bin/env node

/**
 * MCP Bridge Server for Prompt DB
 *
 * This bridge server connects Claude Desktop (via stdio/MCP SDK)
 * to the HTTP-based MCP endpoints on the main server (port 3003).
 *
 * Usage:
 * 1. Start the main server: npm start
 * 2. Configure Claude Desktop to use this bridge via stdio
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// Configuration
const PROMPT_DB_URL = process.env.PROMPT_DB_URL || 'http://localhost:3003';

// Create MCP server
const server = new Server(
  {
    name: 'prompt-db-bridge',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper function to fetch from HTTP endpoint using native http/https modules
async function httpFetch(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlString);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: options.headers || {},
      };

      const req = protocol.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(new Error(`Failed to parse JSON: ${err.message}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('[Bridge] HTTP request error:', error.message);
        reject(error);
      });

      // Send body if present
      if (options.body) {
        req.write(options.body);
      }

      req.end();
    } catch (error) {
      console.error('[Bridge] HTTP fetch error:', error.message);
      reject(error);
    }
  });
}

// List available tools from the HTTP endpoint
server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    console.error('[Bridge] Fetching tools from:', `${PROMPT_DB_URL}/mcp/tools`);
    const data = await httpFetch(`${PROMPT_DB_URL}/mcp/tools`);

    return {
      tools: data.tools || [],
    };
  } catch (error) {
    console.error('[Bridge] Failed to fetch tools:', error.message);
    return {
      tools: [],
    };
  }
});

// Handle tool calls by forwarding to HTTP endpoint
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    console.error(`[Bridge] Calling tool "${name}" via HTTP`);

    const result = await httpFetch(`${PROMPT_DB_URL}/mcp/call-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        arguments: args,
      }),
    });

    return result;
  } catch (error) {
    console.error(`[Bridge] Tool call failed:`, error.message);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Bridge error: ${error.message}`,
          }),
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  try {
    // Check if main server is accessible
    console.error('[Bridge] Node version:', process.version);
    console.error('[Bridge] Using http/https modules for requests');
    console.error('[Bridge] Checking connection to Prompt DB server...');
    console.error('[Bridge] Target URL:', `${PROMPT_DB_URL}/mcp/health`);
    await httpFetch(`${PROMPT_DB_URL}/mcp/health`);
    console.error('[Bridge] Connected to Prompt DB server at:', PROMPT_DB_URL);

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('[Bridge] MCP Bridge Server running on stdio');
    console.error('[Bridge] Ready to forward requests to:', PROMPT_DB_URL);
  } catch (error) {
    console.error('[Bridge] Failed to start server:', error.message);
    console.error('[Bridge] Make sure the main Prompt DB server is running on', PROMPT_DB_URL);
    process.exit(1);
  }
}

main();
