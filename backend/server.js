const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');

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

app.listen(PORT, () => {
  console.log(`GOV.UK One Login Feedback — http://localhost:${PORT}`);
});
