/**
 * Triage Agent — processes "new" submissions and generates a PM summary.
 *
 * Usage:
 *   node backend/triage-agent.js          # process all new submissions
 *   node backend/triage-agent.js --print  # also print the weekly meeting summary
 */

const fs = require('fs');
const path = require('path');

const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');
const SUMMARIES_FILE = path.join(__dirname, 'summaries.json');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

const PRINT_SUMMARY = process.argv.includes('--print');

// ─── Claude helper ───────────────────────────────────────────────────────────

async function callClaude(userMessage) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 600,
      system: `You are a product operations analyst for GOV.UK One Login, a government digital authentication service. You analyse internal feedback from service teams (government departments like DVLA, DWP, HMRC, etc.) and extract structured triage data for product managers. Be precise and conservative — flag as urgent only if genuinely urgent. Respond only with valid JSON, no markdown.`,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || `Claude API error ${res.status}`);
  const text = body.content.find(b => b.type === 'text')?.text || '';
  return text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
}

// ─── Triage one submission ────────────────────────────────────────────────────

async function triageSubmission(submission) {
  const { raw_submission: r } = submission;

  const prompt = `Analyse this GOV.UK One Login service team feedback and return a JSON object:

Problem reported: ${r.problem}
Service/team: ${r.service_team || 'not provided'}
Users affected: ${r.users_affected || 'not provided'}
Business impact: ${r.business_impact || 'not provided'}
Additional details: ${r.details || 'none'}

Return exactly this JSON structure:
{
  "type": one of ["Bug/Blocker", "Usability Issue", "Performance", "Feature Request", "Documentation", "Other"],
  "evidence_level": one of ["High", "Medium", "Low"],
  "affected_scope": one of ["Individual", "Team", "Programme", "Unknown"],
  "urgent": true or false,
  "summary": "2-3 sentence plain-English summary suitable for a PM triage backlog. Include: what the problem is, who is affected, and what the business impact is.",
  "confidence": a number between 0 and 1 indicating how certain you are about the categorisation
}

Evidence level guidance:
- High: scale (number of users) AND impact (business effect) both provided
- Medium: one of scale or impact provided, or vague versions of both
- Low: no scale or impact context — only a description of the problem

Urgent = true if submission mentions: escalation, minister/ministerial office, service down, complete blocker, month-end/year-end deadline, regulatory deadline, or similar high-stakes language.`;

  const raw = await callClaude(prompt);

  let triage;
  try { triage = JSON.parse(raw); }
  catch { throw new Error(`Could not parse Claude response: ${raw}`); }

  return triage;
}

// ─── Pattern detection ────────────────────────────────────────────────────────

function detectPatterns(triaged) {
  const typeCounts = {};
  const summaryWords = {};

  for (const s of triaged) {
    const type = s.triage?.type || 'Other';
    typeCounts[type] = (typeCounts[type] || 0) + 1;

    // Simple keyword fingerprinting for similar issues
    const words = (s.raw_submission?.problem || '').toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 5);

    for (const word of words) {
      summaryWords[word] = summaryWords[word] || [];
      summaryWords[word].push(s.id);
    }
  }

  // Find words that appear in 3+ different submissions
  const patterns = [];
  const seen = new Set();
  for (const [word, ids] of Object.entries(summaryWords)) {
    const unique = [...new Set(ids)];
    if (unique.length >= 3) {
      const key = unique.sort().join(',');
      if (!seen.has(key)) {
        seen.add(key);
        patterns.push({ keyword: word, count: unique.length, ids: unique });
      }
    }
  }

  return { typeCounts, patterns };
}

// ─── Generate weekly meeting summary ─────────────────────────────────────────

function generateMeetingSummary(triaged) {
  const urgent = triaged.filter(s => s.triage?.urgent);
  const highEvidence = triaged.filter(s => !s.triage?.urgent && s.triage?.evidence_level === 'High');
  const medium = triaged.filter(s => !s.triage?.urgent && s.triage?.evidence_level === 'Medium');
  const low = triaged.filter(s => !s.triage?.urgent && s.triage?.evidence_level === 'Low');

  const { patterns } = detectPatterns(triaged);

  const lines = [];
  const timestamp = new Date().toISOString();
  lines.push(`GOV.UK One Login — Triage Summary`);
  lines.push(`Generated: ${timestamp}`);
  lines.push(`Total submissions triaged: ${triaged.length}`);
  lines.push('');

  if (patterns.length > 0) {
    lines.push('=== PATTERN ALERTS ===');
    for (const p of patterns) {
      lines.push(`⚠  "${p.keyword}" appears in ${p.count} separate submissions`);
    }
    lines.push('');
  }

  function renderGroup(items, label) {
    if (items.length === 0) return;
    lines.push(`=== ${label} ===`);
    for (const s of items) {
      const t = s.triage;
      const scope = t?.affected_scope || 'Unknown';
      const team = s.service_team || s.raw_submission?.service_team || 'Unknown team';
      const conf = t?.confidence ? `${Math.round(t.confidence * 100)}% confidence` : '';
      lines.push(`[${t?.type || 'Other'} | ${t?.evidence_level || '?'} | ${scope}] — ${team}`);
      lines.push(`  ID: ${s.id}`);
      lines.push(`  Summary: ${t?.summary || '(no summary)'}`);
      if (conf) lines.push(`  Confidence: ${conf}`);
      lines.push(`  Action: —`);
      lines.push('');
    }
  }

  renderGroup(urgent, 'URGENT');
  renderGroup(highEvidence, 'HIGH EVIDENCE');
  renderGroup(medium, 'MEDIUM EVIDENCE');
  renderGroup(low, 'LOW EVIDENCE');

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let submissions;
  try {
    submissions = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8'));
  } catch {
    console.log('No submissions.json found — nothing to process.');
    return;
  }

  const newSubmissions = submissions.filter(s => s.status === 'new');
  console.log(`Found ${newSubmissions.length} new submission(s) to process.`);

  if (newSubmissions.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let processed = 0;
  let failed = 0;

  for (const submission of newSubmissions) {
    process.stdout.write(`  Triaging ${submission.id}…`);
    try {
      const triage = await triageSubmission(submission);
      submission.triage = triage;
      submission.status = 'triaged';
      submission.triaged_at = new Date().toISOString();
      process.stdout.write(` ✓ ${triage.type} | ${triage.evidence_level} | urgent=${triage.urgent}\n`);
      processed++;
    } catch (e) {
      process.stdout.write(` ✗ ${e.message}\n`);
      submission.triage_error = e.message;
      failed++;
    }
  }

  // Write back updated submissions
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(submissions, null, 2));
  console.log(`\nDone: ${processed} triaged, ${failed} failed.`);

  // Generate summaries
  const triaged = submissions.filter(s => s.status === 'triaged');
  const summaryText = generateMeetingSummary(triaged);
  const summaryOutput = {
    generated_at: new Date().toISOString(),
    total: triaged.length,
    urgent_count: triaged.filter(s => s.triage?.urgent).length,
    items: triaged,
    meeting_summary: summaryText,
  };

  fs.writeFileSync(SUMMARIES_FILE, JSON.stringify(summaryOutput, null, 2));
  console.log(`\nSummary written to backend/summaries.json`);

  if (PRINT_SUMMARY) {
    console.log('\n' + '─'.repeat(60) + '\n');
    console.log(summaryText);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
