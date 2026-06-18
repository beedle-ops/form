const http = require('http');
const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

if (!ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

async function callClaude(body) {
  const { fetch } = await import('node-fetch').catch(() => ({ fetch: globalThis.fetch }));
  const fn = typeof fetch === 'function' ? fetch : globalThis.fetch;
  const res = await fn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  return res;
}

const server = http.createServer(async (req, res) => {
  // Serve index.html
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // Validate endpoint
  if (req.method === 'POST' && req.url === '/api/validate') {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(raw);
        const { area, type, description, affectedUsers, businessImpact, evidence } = data;

        const prompt = `You are a product operations assistant. A customer has submitted product feedback. Your job is to evaluate whether the feedback contains sufficient evidence for a product manager to prioritize it.

Good feedback should include:
1. **Scale of impact** — how many users, accounts, or what percentage are affected
2. **Business impact** — effect on revenue, churn, support load, deals, or productivity
3. **Concrete evidence** — data, quotes, ticket IDs, usage metrics, specific examples

Here is the submitted feedback:

Product area: ${area}
Feedback type: ${type}
Description: ${description}
Affected users: ${affectedUsers || '(not provided)'}
Business impact: ${businessImpact || '(not provided)'}
Supporting evidence: ${evidence || '(not provided)'}

Respond ONLY with a JSON object (no markdown, no explanation) in this exact format:
{
  "score": <integer 0-100 representing overall evidence quality>,
  "sufficient": <true if score >= 65, else false>,
  "missing": [<list of short strings naming what's missing, e.g. "scale of impact", "business impact", "supporting data">],
  "summary": "<1-2 sentence summary of the quality of evidence>",
  "suggestions": [<list of 1-3 specific, actionable suggestions to improve the feedback, each a complete sentence>]
}`;

        const claudeRes = await callClaude({
          model: 'claude-opus-4-8',
          max_tokens: 512,
          thinking: { type: 'adaptive' },
          messages: [{ role: 'user', content: prompt }],
        });

        const payload = await claudeRes.json();

        if (!claudeRes.ok) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: payload.error?.message || 'Claude API error' }));
          return;
        }

        let text = '';
        for (const block of payload.content) {
          if (block.type === 'text') { text = block.text; break; }
        }
        text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(text);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
