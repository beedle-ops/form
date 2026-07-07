const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const CHAT_SYSTEM_PROMPT = `You are a helpful assistant answering basic product questions about GOV.UK One Login, the UK government's single sign-on and identity verification service used to access services across government departments (e.g. HMRC, DVLA, DWP). You help service team staff with general questions such as: what One Login is, how it works, which departments use it, how identity verification works, common troubleshooting steps, and where to get further help.

Keep answers short and plain-English. If a question needs account-specific detail, personal data, or something you're not certain about, say you can't help with that and point the user to submit feedback via this form or contact their department's support channel. Never ask for or process personal information (names, National Insurance numbers, addresses, emails, passwords, one-time codes). Do not invent specific policy details, dates, or figures.`;

const CHAT_MAX_HISTORY = 10;
const CHAT_MAX_MESSAGE_LENGTH = 2000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function readSubmissions() {
  try { return JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8')); }
  catch { return []; }
}

function writeSubmissions(data) {
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(data, null, 2));
}

// Serve form
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'form.html'));
});

// Accept submission
app.post('/submit', (req, res) => {
  const { problem, service_team, users_affected, business_impact, details } = req.body;

  if (!problem || !problem.trim()) {
    return res.status(400).json({ error: 'problem is required' });
  }

  const submission = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    status: 'new',
    service_team: service_team || null,
    raw_submission: {
      problem: problem.trim(),
      service_team: service_team?.trim() || null,
      users_affected: users_affected || null,
      business_impact: business_impact || null,
      details: details?.trim() || null,
    },
  };

  const all = readSubmissions();
  all.push(submission);
  writeSubmissions(all);

  console.log(`[${submission.timestamp}] New submission ${submission.id} from "${submission.service_team || 'unknown'}"`);
  res.json({ id: submission.id });
});

// Chatbot — basic product Q&A about GOV.UK One Login
app.post('/chat', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Chat is not configured' });
  }

  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const cleaned = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return res.status(400).json({ error: 'each message needs a role of user/assistant and string content' });
    }
    if (!m.content.trim() || m.content.length > CHAT_MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `message content must be 1-${CHAT_MAX_MESSAGE_LENGTH} characters` });
    }
    cleaned.push({ role: m.role, content: m.content.trim() });
  }

  const recent = cleaned.slice(-CHAT_MAX_HISTORY);

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 400,
        system: CHAT_SYSTEM_PROMPT,
        messages: recent,
      }),
    });

    const body = await apiRes.json();
    if (!apiRes.ok) throw new Error(body.error?.message || `Claude API error ${apiRes.status}`);

    const reply = body.content.find(b => b.type === 'text')?.text || '';
    res.json({ reply });
  } catch (e) {
    console.error(`Chat error: ${e.message}`);
    res.status(502).json({ error: 'Could not reach the chat assistant. Please try again.' });
  }
});

app.listen(PORT, () => {
  console.log(`GOV.UK One Login Feedback — http://localhost:${PORT}`);
});
