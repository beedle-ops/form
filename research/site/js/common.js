/* Shared utilities: data loading, nav/footer, search scoring, bookmarks, analytics. */

const CII = (() => {
  let dataPromise = null;

  function loadData() {
    if (!dataPromise) {
      dataPromise = Promise.all([
        fetch('/data/records.json').then((r) => r.json()),
        fetch('/data/collections.json').then((r) => r.json()),
      ]).then(([records, collections]) => ({ records, collections }));
    }
    return dataPromise;
  }

  function qs(params) {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') usp.set(k, v);
    });
    const s = usp.toString();
    return s ? `?${s}` : '';
  }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
  }

  // ─── Search ────────────────────────────────────────────────────────

  function scoreRecord(record, queryLower) {
    const terms = queryLower.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return 1;

    const fields = {
      company: (record.company || '').toLowerCase(),
      problem: (record.problem || '').toLowerCase(),
      industry: (record.industry || '').toLowerCase(),
      category: (record.category || '').toLowerCase(),
      tags: (record.tags || []).join(' ').toLowerCase(),
      summary: (record.summary || '').toLowerCase(),
      analysis: (record.analysis || '').toLowerCase(),
      title: (record.title || '').toLowerCase(),
    };

    // Every query term must match somewhere, so multi-word queries like
    // "account deletion" don't surface unrelated records that only match one word.
    let score = 0;
    for (const term of terms) {
      let termScore = 0;
      if (fields.company.includes(term)) termScore += 5;
      if (fields.problem.includes(term)) termScore += 4;
      if (fields.tags.includes(term)) termScore += 4;
      if (fields.category.includes(term)) termScore += 3;
      if (fields.industry.includes(term)) termScore += 3;
      if (fields.title.includes(term)) termScore += 2;
      if (fields.summary.includes(term)) termScore += 1;
      if (fields.analysis.includes(term)) termScore += 1;
      if (termScore === 0) return 0;
      score += termScore;
    }
    return score;
  }

  function search(records, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return records.slice();
    return records
      .map((r) => ({ r, score: scoreRecord(r, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.r);
  }

  function filterRecords(records, { industry, category, tag, company } = {}) {
    return records.filter((r) => {
      if (industry && r.industry !== industry) return false;
      if (category && r.category !== category) return false;
      if (company && r.company !== company) return false;
      if (tag && !(r.tags || []).includes(tag)) return false;
      return true;
    });
  }

  // ─── Bookmarks (localStorage) ─────────────────────────────────────

  const SAVE_KEY = 'cii_saved_records';

  function getSaved() {
    try {
      return JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function isSaved(id) {
    return getSaved().includes(id);
  }

  function toggleSave(id) {
    const saved = getSaved();
    const idx = saved.indexOf(id);
    if (idx >= 0) {
      saved.splice(idx, 1);
      localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
      track('record_unsaved', { id });
      return false;
    } else {
      saved.push(id);
      localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
      track('record_saved', { id });
      return true;
    }
  }

  // ─── Analytics ─────────────────────────────────────────────────────

  function track(event, data) {
    try {
      fetch('/api/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, data }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* analytics must never break the app */
    }
  }

  // ─── Rendering helpers ─────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function tagsHtml(tags) {
    return (tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  }

  function recordCardHtml(record) {
    const saved = isSaved(record.id);
    return `
      <div class="card" data-id="${escapeHtml(record.id)}">
        <div class="card-top">
          <div>
            <div class="card-company">${escapeHtml(record.company)}</div>
            <div class="card-industry">${escapeHtml(record.industry)}</div>
          </div>
        </div>
        <div class="card-problem">${escapeHtml(record.problem)}</div>
        <div class="card-impl">${escapeHtml(record.implementation_type)}</div>
        <div class="card-summary">${escapeHtml(record.summary)}</div>
        <div class="card-tags">${tagsHtml(record.tags)}</div>
        <div class="card-actions">
          <a href="/record.html${qs({ id: record.id })}" class="btn-secondary" data-record-link="${escapeHtml(record.id)}">View research &rarr;</a>
          <button class="save-btn ${saved ? 'saved' : ''}" data-save="${escapeHtml(record.id)}">${saved ? '★ Saved' : '☆ Save'}</button>
        </div>
      </div>
    `;
  }

  function wireCardEvents(container) {
    container.querySelectorAll('[data-save]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const id = btn.getAttribute('data-save');
        const nowSaved = toggleSave(id);
        btn.classList.toggle('saved', nowSaved);
        btn.textContent = nowSaved ? '★ Saved' : '☆ Save';
      });
    });
    container.querySelectorAll('[data-record-link]').forEach((a) => {
      a.addEventListener('click', () => {
        track('result_clicked', { id: a.getAttribute('data-record-link') });
      });
    });
  }

  function renderNav(active) {
    const el = document.getElementById('nav');
    if (!el) return;
    const links = [
      ['/search.html', 'Browse'],
      ['/collections.html', 'Collections'],
      ['/compare.html', 'Compare'],
      ['/saved.html', 'Saved'],
    ];
    el.innerHTML = `
      <div class="wrap">
        <a class="brand" href="/">Implementation<span class="brand-dot">.</span>Intel</a>
        <div class="nav-search">
          <form id="nav-search-form" role="search">
            <input type="search" id="nav-search-input" placeholder="Search implementations…" aria-label="Search">
          </form>
        </div>
        <div class="navlinks">
          ${links.map(([href, label]) => `<a href="${href}" ${active === label ? 'style="color: var(--accent)"' : ''}>${label}</a>`).join('')}
        </div>
      </div>
    `;
    const form = document.getElementById('nav-search-form');
    const input = document.getElementById('nav-search-input');
    input.value = getParam('q');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) {
        track('search', { query: q });
        window.location.href = `/search.html${qs({ q })}`;
      }
    });
  }

  function renderFooter() {
    const el = document.getElementById('footer');
    if (!el) return;
    el.innerHTML = `
      <div class="wrap">
        Company Implementation Intelligence — a research experiment. Every record cites a public source and a checked date.
        Facts are observed; analysis is editorial and marked as such.
      </div>
    `;
  }

  return {
    loadData, qs, getParam, search, filterRecords,
    getSaved, isSaved, toggleSave, track,
    escapeHtml, tagsHtml, recordCardHtml, wireCardEvents,
    renderNav, renderFooter,
  };
})();
