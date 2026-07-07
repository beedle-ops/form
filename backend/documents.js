const fs = require('fs');
const path = require('path');

const DOCUMENTS_DIR = path.join(__dirname, 'documents');
const CHUNK_MAX_CHARS = 800;
const TOP_K_CHUNKS = 6;

let cache = { mtimeKey: null, chunks: [] };

function listDocumentFiles() {
  if (!fs.existsSync(DOCUMENTS_DIR)) return [];
  return fs.readdirSync(DOCUMENTS_DIR)
    .filter(f => f.toLowerCase() !== 'readme.md' && /\.(txt|md|pdf|docx)$/i.test(f))
    .map(f => path.join(DOCUMENTS_DIR, f));
}

function mtimeKeyFor(files) {
  return files.map(f => `${f}:${fs.statSync(f).mtimeMs}`).join('|');
}

async function extractText(file) {
  const ext = path.extname(file).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(file, 'utf8');
  }
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(fs.readFileSync(file));
    return data.text;
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: file });
    return result.value;
  }
  return '';
}

function chunkText(text, sourceName) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let buffer = '';

  for (const p of paragraphs) {
    if (buffer && (buffer.length + p.length + 2) > CHUNK_MAX_CHARS) {
      chunks.push({ source: sourceName, text: buffer.trim() });
      buffer = p;
    } else {
      buffer = buffer ? `${buffer}\n\n${p}` : p;
    }
  }
  if (buffer.trim()) chunks.push({ source: sourceName, text: buffer.trim() });

  return chunks;
}

async function loadChunks() {
  const files = listDocumentFiles();
  const key = mtimeKeyFor(files);
  if (key === cache.mtimeKey) return cache.chunks;

  const allChunks = [];
  for (const file of files) {
    try {
      const text = await extractText(file);
      allChunks.push(...chunkText(text, path.basename(file)));
    } catch (e) {
      console.error(`Could not read document ${file}: ${e.message}`);
    }
  }

  cache = { mtimeKey: key, chunks: allChunks };
  return allChunks;
}

function scoreChunk(chunkText, queryWords) {
  const lower = chunkText.toLowerCase();
  let score = 0;
  for (const w of queryWords) {
    if (w.length < 4) continue;
    if (lower.includes(w)) score++;
  }
  return score;
}

// Keyword-overlap retrieval — no vector DB, fine for a small, admin-curated document set.
async function retrieveRelevantChunks(query) {
  const chunks = await loadChunks();
  if (chunks.length === 0) return [];

  const queryWords = [...new Set(query.toLowerCase().split(/\W+/).filter(Boolean))];

  return chunks
    .map(c => ({ ...c, score: scoreChunk(c.text, queryWords) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K_CHUNKS);
}

module.exports = { retrieveRelevantChunks, DOCUMENTS_DIR };
