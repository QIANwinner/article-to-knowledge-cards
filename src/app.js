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
    btnPrompt: $('btn-prompt'),
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
    stats: null,
    disclaimers: []
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
    state = { sourceText: '', sourceName: '', cards: [], stats: null, disclaimers: [] };
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
        const { cards, stats, disclaimers } = Engine.generate(text);
        state.cards = cards;
        state.stats = stats;
        state.disclaimers = disclaimers || [];
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
    const produced = stats.qualified - stats.merged - stats.overCeiling;
    const d = document.createElement('div');
    d.className = 'engine-stats';
    d.innerHTML =
      `<b>引擎处理</b>：原文 ${stats.sections} 小节 → ${stats.candidates} 候选` +
      ` → ${stats.qualified} 通过资格判定 → 合并重复 ${stats.merged} → ${produced} 张卡片` +
      (stats.overCeiling ? `（超上限省略 ${stats.overCeiling}）` : '') +
      ` · ${stats.elapsed}ms` +
      `<br><b>保真</b>：口径提示 ${stats.caveats} 张` +
      ` · 解释取自原文 ${produced - stats.plainGaps} 张` +
      ` · 原文未提供解释 ${stats.plainGaps} 张` +
      (stats.disclaimers ? ` · 原文声明 ${stats.disclaimers} 段已保留` : ' · 原文无免责声明');
    return d;
  }

  function renderCard(card) {
    const div = document.createElement('article');
    div.className = 'card';

    const hasCaveat = card.caveat && card.caveat.trim();
    const mergedNote =
      card.mergedFrom > 1 ? ` · 合并 ${card.mergedFrom} 处重复论述` : '';
    const tagClass = card.plainGap ? 'field-tag is-gap' : 'field-tag';

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
        <div class="field-head">
          <span class="field-label">简明解释 / Plain explanation</span>
          <span class="${tagClass}">${escapeHtml(card.plainSource || '原文未提供')}</span>
        </div>
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
      lines.push(`_解释来源：${c.plainSource || '原文未提供'}_`);
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
    if (state.disclaimers && state.disclaimers.length) {
      lines.push(`**来源声明 / Source disclaimer**: ${state.disclaimers.join(' ')}`);
    }
    if (state.stats && state.stats.plainGaps) {
      lines.push(
        `**解释缺口 / Gaps**: ${state.stats.plainGaps} 张卡片的解释在原文中没有可引用的推导，已逐张标注「原文未提供」`
      );
    }
    lines.push('');
    lines.push('> 由 article-to-knowledge-cards 本地生成 · 规则引擎版');
    return lines.join('\n');
  }

  /* ---------- 提示词 ---------- */

  // 规则引擎只做结构化抽取，语义层的取舍交给模型。
  // 这条通路把 SKILL.md 的硬约束压成一段可直接投喂的提示词。
  const PROMPT_RULES = [
    '规则（必须逐条遵守）：',
    '1. 先读完整篇原文再选卡，不要从局部读到的内容里挑。',
    '2. 只有「能被原文反驳」的断言才可成卡：事实、机制、规则、结论、数字。',
    '   计划、待办、预测、未决问题不做卡，但要在 footer 的「未收录」行写明为什么没做。',
    '3. 不引入原文之外的信息：不补教科书定义、不补真实统计数字、不补原文没提的名字与机构。',
    '4. 例子只能来自原文，或是原文数字的显式算式（写出算式）。否则改出自测题。',
    '5. 一张卡一个知识点。同一主张的不同表述合并成一张；共享一句原文但各自带不同数字或结论的，分开成卡。',
    '6. 原文的免责声明、虚构标记、数据时效声明必须逐字带到footer，并重复进带数字卡片的「口径提示」。',
    '7. 原文自相矛盾时保留冲突并标注，不要替原文和稀泥。',
    '8. 卡片总数上限 128，没有下限也没有指标：原文支持几张就出几张，绝不凑数，也绝不把一个知识点拆成两张。',
    '输出：Markdown 渲染文本（不要代码块围栏），每张卡依次为',
    '「### 卡片 N / Card N. 标题」「**核心知识 / Core knowledge**」「**简明解释 / Plain explanation**」',
    '「**口径提示 / Caveat**」（仅在需要时出现）「**例子 / Example**」或「**自测题 / Self-test**」（二选一）。',
    '最后跟一个不超过四行的 footer：卡片数、来源、未收录、来源声明。'
  ].join('\n');

  function buildPrompt() {
    const text = el.source.value.trim();
    const head = [
      '用 make-knowledge-cards 把下面这份材料转成知识卡片。',
      state.sourceName
        ? `来源文件：${state.sourceName}（请先完整读取该文件）`
        : '来源：下方粘贴的文本',
      '',
      PROMPT_RULES
    ].join('\n');

    if (state.sourceName || !text) return head;
    if (text.length > 3000) {
      return `${head}\n\n正文（${text.length} 字符，超过 3000，请分批粘贴并保持编号连续）：\n${text.slice(0, 3000)}\n……（其余部分我会继续粘贴）`;
    }
    return `${head}\n\n正文：\n${text}`;
  }

  el.btnPrompt.addEventListener('click', async () => {
    const text = el.source.value.trim();
    if (!text && !state.sourceName) {
      showError('请先粘贴文章或选择文件，提示词需要带上来源。');
      return;
    }
    const prompt = buildPrompt();
    try {
      await navigator.clipboard.writeText(prompt);
      flash(el.btnPrompt, '提示词已复制');
      showError('');
    } catch (e) {
      showError('剪贴板不可用，请手动选取。');
    }
  });

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

  // Tauri 环境暴露给后端（用 getter，state 会被整体替换，持有引用会失效）
  if (typeof window !== 'undefined') {
    window.__app = { get state() { return state; }, Engine };
  }
})();