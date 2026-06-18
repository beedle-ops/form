const http = require('http');
const fs = require('fs');
const path = require('path');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;
const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');

if (!ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

async function callClaude({ model, system, messages, max_tokens = 512 }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, system, messages, max_tokens }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || `Claude API error ${res.status}`);
  return body.content.find(b => b.type === 'text')?.text || '';
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

// POST /api/chat
// { history: [{q, a}], latestAnswer: string }
// Returns { question: string, done: boolean }
async function handleChat(body) {
  const { history = [], latestAnswer } = body;
  const exchangeCount = history.length; // history has already-answered pairs

  const historyText = history.map(({ q, a }) => `Q: ${q}\nA: ${a}`).join('\n\n');
  const systemPrompt = `You are helping collect product feedback for GOV.UK One Login from internal government service teams (like DWP, DVLA, HMRC). Your job is to ask adaptive follow-up questions to gather enough evidence for a product manager to triage and act on the feedback.

Evidence you're trying to gather:
- What specifically is the problem (not just symptoms)
- How many users/teams/services are affected (scale)
- What the business or service impact is (severity)
- Whether it's urgent (escalations, service down, ministerial concern)

Rules:
- Ask ONE question at a time. Never a list.
- Keep it conversational and warm — acknowledge what they've shared.
- Don't repeat what they've already told you.
- Stop when you have: problem type + at least one of (scale OR impact). Always stop after 3 follow-ups regardless.
- If you have enough to triage, respond with exactly: DONE
- Otherwise respond with a single follow-up question (1-2 sentences max, no preamble like "Great!" just the question).`;

  const userMessage = history.length === 0
    ? `This is the customer's first piece of feedback:\n\n"${latestAnswer}"\n\nDo you have enough to triage this? If yes, respond DONE. If not, what's the single most useful follow-up question?`
    : `Here is the conversation so far:\n\n${historyText}\n\nThe customer just answered the last question:\n"${latestAnswer}"\n\nDo you have enough to triage? (You need: problem type + scale or impact.) If yes, respond DONE. If not (and this is follow-up ${exchangeCount} of max 3), what's the single most useful follow-up?`;

  const raw = await callClaude({
    model: 'claude-sonnet-4-6',
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: 200,
  });

  const done = raw.trim().toUpperCase().startsWith('DONE') || exchangeCount >= 3;
  return { question: done ? null : raw.trim(), done };
}

// POST /api/submit
// { history: [{q, a}], serviceTeam: string }
// Returns { id: string }
async function handleSubmit(body) {
  const { history = [], serviceTeam = '' } = body;

  const transcript = history.map(({ q, a }) => `Q: ${q}\nA: ${a}`).join('\n\n');

  const inference = await callClaude({
    model: 'claude-opus-4-8',
    system: 'You are a product operations analyst for GOV.UK One Login. Analyse feedback from internal government service teams and respond only with a JSON object.',
    messages: [{
      role: 'user',
      content: `Analyse this feedback transcript and return a JSON object with exactly these fields:

{
  "feedbackType": one of ["Bug/Blocker", "Usability Issue", "Performance", "Feature Request", "Documentation", "Other"],
  "evidenceLevel": one of ["High", "Medium", "Low"],
  "evidenceReason": "one sentence explaining why",
  "urgentFlag": true or false,
  "urgentReason": "one sentence if urgent, else null",
  "summary": "2-3 sentence plain English summary of the issue and its impact for a PM"
}

Transcript:
${transcript}

Service team: ${serviceTeam || 'Not provided'}

Respond with only the JSON object, no markdown.`,
    }],
    max_tokens: 512,
  });

  let meta;
  try {
    meta = JSON.parse(inference.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim());
  } catch {
    meta = { feedbackType: 'Other', evidenceLevel: 'Low', urgentFlag: false, summary: '' };
  }

  const submission = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    serviceTeam,
    history,
    ...meta,
    triageStatus: 'pending',
  };

  const all = readJSON(SUBMISSIONS_FILE);
  all.push(submission);
  writeJSON(SUBMISSIONS_FILE, all);

  return { id: submission.id, summary: meta.summary, urgentFlag: meta.urgentFlag };
}

const server = http.createServer(async (req, res) => {
  const respond = (status, data, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    return respond(200, html, 'text/html');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' });
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    try {
      const body = await parseBody(req);
      const result = await handleChat(body);
      return respond(200, result);
    } catch (e) {
      return respond(500, { error: e.message });
    }
  }

  if (req.method === 'POST' && req.url === '/api/submit') {
    try {
      const body = await parseBody(req);
      const result = await handleSubmit(body);
      return respond(200, result);
    } catch (e) {
      return respond(500, { error: e.message });
    }
  }

  respond(404, { error: 'Not found' });
});

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
