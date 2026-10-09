/**
 * app.js — UI 交互层
 * 职责：DOM 绑定、渲染、分批呈现、导出
 */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const el = {
    source: $('source'),
    charCount: $('char-count'),
    sourceLabel: $('source-label'),
    fileInput: $('file-input'),
    btnClear: $('btn-clear'),
    btnGenerate: $('btn-generate'),
    genHint: $('gen-hint'),
    errorSlot: $('error-slot'),
    deck: $('deck'),
    deckStats: $('deck-stats'),
    statCount: $('stat-count'),
    btnCopy: $('btn-copy'),
    btnDownload: $('btn-download')
  };

  let state = {
    sourceText: '',
    sourceName: '',
    cards: [],
    stats: null
  };

  const BATCH_THRESHOLD = 25;
  const GROUP_THRESHOLD = 60;

  /* ---------- 输入侧 ---------- */

  function updateCharCount() {
    const n = el.source.value.length;
    el.charCount.textContent = `${n.toLocaleString('zh-CN')} 字符`;
  }

  function showError(msg) {
    if (!msg) {
      el.errorSlot.hidden = true;
      el.errorSlot.textContent = '';
      return;
    }
    el.errorSlot.hidden = false;
    el.errorSlot.textContent = msg;
  }

  el.source.addEventListener('input', () => {
    updateCharCount();
    showError('');
    if (el.source.value !== state.sourceText && !state.sourceName) {
      el.sourceLabel.textContent = '粘贴的文本';
    }
  });

  el.fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const okExt = /\.(md|markdown|txt)$/i.test(file.name);
    if (!okExt) {
      showError(`不支持的文件类型：${file.name}。仅支持 .md / .markdown / .txt。`);
      el.fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      el.source.value = text;
      state.sourceText = text;
      state.sourceName = file.name;
      el.sourceLabel.textContent = file.name;
      updateCharCount();
      showError('');
    };
    reader.onerror = () => {
      showError(`读取文件失败：${file.name}`);
    };
    reader.readAsText(file, 'utf-8');
  });

  el.btnClear.addEventListener('click', () => {
    el.source.value = '';
    state = { sourceText: '', sourceName: '', cards: [], stats: null };
    el.sourceLabel.textContent = '未选择来源';
    el.fileInput.value = '';
    updateCharCount();
    showError('');
    renderEmpty();
    el.btnCopy.disabled = true;
    el.btnDownload.disabled = true;
  });

  /* ---------- 生成 ---------- */

  el.btnGenerate.addEventListener('click', () => {
    const text = el.source.value.trim();
    if (!text) {
      showError('请先粘贴文章或选择文件。');
      return;
    }
    if (text.length < 50) {
      showError('原文太短（不足 50 字符），无法提取知识点。');
      return;
    }

    el.btnGenerate.disabled = true;
    el.genHint.textContent = '正在切分与筛选…';

    // 让按钮态先渲染，再跑计算
    setTimeout(() => {
      try {
        const { cards, stats } = Engine.generate(text);
        state.cards = cards;
        state.stats = stats;
        render(cards, stats);
        el.btnCopy.disabled = cards.length === 0;
        el.btnDownload.disabled = cards.length === 0;
        el.genHint.textContent = '每张卡一个知识点，不编造原文没有的信息';
        showError('');
      } catch (err) {
        showError(`生成失败：${err && err.message ? err.message : err}`);
        el.genHint.textContent = '每张卡一个知识点，不编造原文没有的信息';
      } finally {
        el.btnGenerate.disabled = false;
      }
    }, 20);
  });

  /* ---------- 渲染 ---------- */

  function renderEmpty() {
    el.deck.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="7" y="10" width="14" height="28" rx="2" />
            <rect x="24" y="10" width="17" height="13" rx="2" />
            <rect x="24" y="26" width="17" height="12" rx="2" />
          </svg>
        </div>
        <p class="empty-title">还没有卡片</p>
        <p class="empty-sub">在左侧粘贴文章后点「生成卡片」</p>
      </div>`;
    el.deckStats.hidden = true;
  }

  function render(cards, stats) {
    el.deckStats.hidden = false;
    el.statCount.textContent = String(cards.length);

    if (!cards.length) {
      const note = stats && stats.note ? stats.note : '未找到可独立成卡的知识点。';
      el.deck.innerHTML = `<div class="engine-note">${escapeHtml(note)}</div>` + statsBlock(stats);
      return;
    }

    const frag = document.createDocumentFragment();

    // 引擎处理统计（折叠在下方）
    frag.appendChild(statsBlock(stats));

    if (cards.length <= GROUP_THRESHOLD) {
      if (cards.length > BATCH_THRESHOLD) frag.appendChild(sectionHead('按原文小节', '分组'));
      for (const card of cards) frag.appendChild(renderCard(card));
    } else {
      // 按 section 分批
      const groups = new Map();
      for (const c of cards) {
        const key = c.section || '正文';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      }
      let i = 0;
      const total = groups.size;
      for (const [name, list] of groups) {
        i += 1;
        frag.appendChild(
          batchHead(i, total, name, `${list[0].index}–${list[list.length - 1].index}`)
        );
        for (const card of list) frag.appendChild(renderCard(card));
      }
    }

    el.deck.innerHTML = '';
    el.deck.appendChild(frag);
  }

  function sectionHead(title, tag) {
    const d = document.createElement('div');
    d.className = 'batch-head';
    d.innerHTML = `
      <span class="batch-no">—</span>
      <span class="batch-title">${escapeHtml(title)}</span>
      <span class="batch-range">${escapeHtml(tag)}</span>`;
    return d;
  }

  function batchHead(i, total, title, range) {
    const d = document.createElement('div');
    d.className = 'batch-head';
    d.innerHTML = `
      <span class="batch-no">${i}/${total}</span>
      <span class="batch-title">${escapeHtml(title)}</span>
      <span class="batch-range">卡片 ${escapeHtml(range)}</span>`;
    return d;
  }

  function statsBlock(stats) {
    if (!stats) return document.createDocumentComment('');
    const d = document.createElement('div');
    d.className = 'engine-stats';
    d.innerHTML =
      `<b>引擎处理</b>：原文 ${stats.sections} 小节 → ${stats.candidates} 候选` +
      ` → ${stats.qualified} 通过资格判定 → 合并重复 ${stats.merged} → ${stats.candidates - stats.rejected - stats.merged} 张卡片` +
      (stats.overCeiling ? `（超上限省略 ${stats.overCeiling}）` : '') +
      ` · ${stats.elapsed}ms`;
    return d;
  }

  function renderCard(card) {
    const div = document.createElement('article');
    div.className = 'card';

    const hasCaveat = card.caveat && card.caveat.trim();
    const mergedNote =
      card.mergedFrom > 1 ? ` · 合并 ${card.mergedFrom} 处重复论述` : '';

    div.innerHTML = `
      <div class="card-head">
        <span class="card-no">${card.index}</span>
        <h3 class="card-title">${escapeHtml(card.title)}</h3>
        <span class="card-section" title="${escapeHtml(card.section)}">${escapeHtml(card.section)}</span>
      </div>
      <div class="field field-core">
        <span class="field-label">核心知识 / Core knowledge</span>
        <p class="field-body">${escapeHtml(card.core)}</p>
      </div>
      <div class="field">
        <span class="field-label">简明解释 / Plain explanation</span>
        <p class="field-body">${escapeHtml(card.plain)}</p>
      </div>
      ${hasCaveat ? `
      <div class="field field-caveat">
        <span class="field-label">口径提示 / Caveat</span>
        <p class="field-body">${escapeHtml(card.caveat)}</p>
      </div>` : ''}
      <div class="field field-example">
        <span class="field-label">${escapeHtml(card.exampleLabel)}</span>
        <p class="field-body">${escapeHtml(card.example)}</p>
      </div>
      ${mergedNote ? `<div class="card-foot">${escapeHtml(mergedNote.trim())}</div>` : ''}
    `;
    return div;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- 导出 ---------- */

  function toMarkdown() {
    const lines = [];
    if (state.stats) {
      lines.push(`> 原文：${state.sourceName || '粘贴的文本'}`);
      lines.push(`> 小节 ${state.stats.sections} · 候选 ${state.stats.candidates} · 通过判定 ${state.stats.qualified} · 合并重复 ${state.stats.merged}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    let currentSection = null;
    for (const c of state.cards) {
      if (c.section !== currentSection && state.cards.length > 25) {
        if (currentSection !== null) lines.push('');
        lines.push(`## ${c.section}`);
        lines.push('');
        currentSection = c.section;
      }
      lines.push(`### 卡片 ${c.index} / Card ${c.index}. ${c.title}`);
      lines.push('');
      lines.push('**核心知识 / Core knowledge**');
      lines.push(c.core);
      lines.push('');
      lines.push('**简明解释 / Plain explanation**');
      lines.push(c.plain);
      lines.push('');
      if (c.caveat && c.caveat.trim()) {
        lines.push('**口径提示 / Caveat**');
        lines.push(c.caveat);
        lines.push('');
      }
      lines.push(`**${c.exampleLabel}**`);
      lines.push(c.example);
      lines.push('');
    }

    lines.push('---');
    lines.push(`**卡片数 / Cards**: ${state.cards.length}`);
    lines.push(`**来源 / Source**: ${state.sourceName || '粘贴的文本'}`);
    lines.push(
      `**未收录 / Omitted**: ${state.stats && state.stats.rejected ? `${state.stats.rejected} 段未通过资格判定（计划、框架句或无实质内容）` : '无'}`
    );
    if (state.stats && state.stats.merged) {
      lines.push(`**去重 / Deduplicated**: 合并 ${state.stats.merged} 处重复论述`);
    }
    lines.push('');
    lines.push('> 由 article-to-knowledge-cards 本地生成 · 规则引擎版');
    return lines.join('\n');
  }

  el.btnCopy.addEventListener('click', async () => {
    const md = toMarkdown();
    try {
      await navigator.clipboard.writeText(md);
      flash(el.btnCopy, '已复制');
    } catch (e) {
      // 剪贴板不可用时降级为选中提示
      flash(el.btnCopy, '复制失败，请手动选取');
    }
  });

  el.btnDownload.addEventListener('click', () => {
    const md = toMarkdown();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = (state.sourceName || 'cards').replace(/\.[^.]+$/, '');
    a.href = url;
    a.download = `${base}-知识卡片.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flash(el.btnDownload, '已下载');
  });

  function flash(btn, msg) {
    const old = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => {
      btn.textContent = old;
    }, 1600);
  }

  /* ---------- 快捷键 ---------- */

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!el.btnGenerate.disabled) el.btnGenerate.click();
    }
  });

  /* ---------- 初始化 ---------- */

  updateCharCount();
  renderEmpty();

  // Tauri 环境暴露给后端
  if (typeof window !== 'undefined') {
    window.__app = { state, Engine };
  }
})();