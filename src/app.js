/**
 * app.js — 应用入口：Tab 路由 + 生成面板
 *
 * 面板分工：
 *   生成（本文件）    粘贴原文 → 引擎出卡 → 质量报告 → 存入卡片库
 *   卡片库（library.js）编辑、标签、掌握状态、四种导出、备份导入
 *   复习（review.js）    到期队列 + 三档自评 + 间隔重排
 *
 * 三个面板通过 onChange 回调互相同步徽标，避免各自刷新造成闪烁。
 */

(() => {
  'use strict';

  const { escapeHtml, flash, toast, readFileAsText, nl2br } = UI;

  const BATCH_THRESHOLD = 25;
  const GROUP_THRESHOLD = 60;
  const PROMPT_INLINE_LIMIT = 3000;

  const el = {
    source: UI.$('source'),
    charCount: UI.$('char-count'),
    sourceLabel: UI.$('source-label'),
    fileInput: UI.$('file-input'),
    btnClear: UI.$('btn-clear'),
    btnGenerate: UI.$('btn-generate'),
    btnPrompt: UI.$('btn-prompt'),
    btnSave: UI.$('btn-save'),
    genHint: UI.$('gen-hint'),
    errorSlot: UI.$('error-slot'),
    deck: UI.$('deck'),
    deckStats: UI.$('deck-stats'),
    statCount: UI.$('stat-count'),
    btnCopy: UI.$('btn-copy'),
    btnDownload: UI.$('btn-download'),
    footStorage: UI.$('foot-storage')
  };

  const state = {
    sourceText: '',
    sourceName: '',
    cards: [],
    stats: null,
    disclaimers: [],
    rejected: [],
    saved: false
  };

  /* ---------- 徽标与存储状态 ---------- */

  function refreshBadges() {
    const all = Store.listCards();
    const s = Scheduler.summarize(all);
    UI.$('badge-library').textContent = String(all.length);
    const dueBadge = UI.$('badge-due');
    dueBadge.textContent = String(s.due);
    dueBadge.classList.toggle('is-hot', s.due > 0);
    const st = Store.stats();
    el.footStorage.textContent = st.persistent
      ? `本地存储 · ${st.cards} 张 / ${st.sources} 篇`
      : '⚠ 仅本次会话有效（浏览器存储不可用）';
    el.footStorage.classList.toggle('is-warn', !st.persistent);
  }

  /* ---------- Tab 路由 ---------- */

  const TABS = [
    { id: 'make', panel: 'panel-make', tab: 'tab-make' },
    { id: 'library', panel: 'panel-library', tab: 'tab-library' },
    { id: 'review', panel: 'panel-review', tab: 'tab-review' }
  ];

  function showTab(id) {
    for (const t of TABS) {
      const active = t.id === id;
      UI.$(t.panel).hidden = !active;
      const btn = UI.$(t.tab);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    if (id === 'library') Library.render();
    if (id === 'review') Review.start();
  }

  function bindTabs() {
    for (const t of TABS) UI.$(t.tab).addEventListener('click', () => showTab(t.id));
  }

  /* ---------- 输入侧 ---------- */

  function updateCharCount() {
    el.charCount.textContent = `${el.source.value.length.toLocaleString('zh-CN')} 字符`;
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

  el.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      showError(`不支持的文件类型：${file.name}。仅支持 .md / .markdown / .txt。`);
      el.fileInput.value = '';
      return;
    }
    try {
      const text = await readFileAsText(file);
      el.source.value = text;
      state.sourceText = text;
      state.sourceName = file.name;
      el.sourceLabel.textContent = file.name;
      updateCharCount();
      showError('');
    } catch (err) {
      showError(`读取文件失败：${file.name}`);
    }
  });

  el.btnClear.addEventListener('click', () => {
    el.source.value = '';
    state.sourceText = '';
    state.sourceName = '';
    state.cards = [];
    state.stats = null;
    state.disclaimers = [];
    state.rejected = [];
    state.saved = false;
    el.sourceLabel.textContent = '未选择来源';
    el.fileInput.value = '';
    updateCharCount();
    showError('');
    renderEmpty();
    el.btnCopy.disabled = true;
    el.btnDownload.disabled = true;
    el.btnSave.disabled = true;
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
    if (text.length > 400000) {
      showError('原文超过 40 万字符，建议按小节分次处理。');
      return;
    }

    el.btnGenerate.disabled = true;
    el.genHint.textContent = '正在切分与筛选…';

    // 让按钮态先渲染，再跑计算
    setTimeout(() => {
      try {
        const result = Engine.generate(text);
        state.cards = result.cards;
        state.stats = result.stats;
        state.disclaimers = result.disclaimers || [];
        state.rejected = result.rejected || [];
        state.saved = false;
        render(result.cards, result.stats);
        el.btnCopy.disabled = state.cards.length === 0;
        el.btnDownload.disabled = state.cards.length === 0;
        el.btnSave.disabled = state.cards.length === 0;
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
      el.deck.innerHTML = `<div class="engine-note">${escapeHtml(note)}</div>` + qualityPanel(stats, cards);
      return;
    }

    let html = qualityPanel(stats, cards);

    if (cards.length <= GROUP_THRESHOLD) {
      if (cards.length > BATCH_THRESHOLD) {
        html += `<div class="batch-head"><span class="batch-no">—</span><span class="batch-title">按原文小节</span><span class="batch-range">分组</span></div>`;
      }
      html += cards.map(cardHtml).join('');
    } else {
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
        html += `<div class="batch-head">
          <span class="batch-no">${i}/${total}</span>
          <span class="batch-title">${escapeHtml(name)}</span>
          <span class="batch-range">卡片 ${list[0].index}–${list[list.length - 1].index}</span>
        </div>`;
        html += list.map(cardHtml).join('');
      }
    }

    el.deck.innerHTML = html;
  }

  function cardHtml(card) {
    const hasCaveat = card.caveat && card.caveat.trim();
    const merged =
      (card.mergedFrom || 1) > 1
        ? `<div class="card-foot">合并 ${card.mergedFrom} 处重复论述</div>`
        : '';

    return `
    <article class="card">
      <div class="card-head">
        <span class="card-no">${card.index}</span>
        <h3 class="card-title">${escapeHtml(card.title)}</h3>
        <span class="card-section" title="${escapeHtml(card.section)}">${escapeHtml(card.section)}</span>
      </div>
      <div class="field field-core">
        <span class="field-label">核心知识 / Core knowledge</span>
        <p class="field-body">${nl2br(card.core)}</p>
      </div>
      <div class="field">
        <div class="field-head">
          <span class="field-label">简明解释 / Plain explanation</span>
          <span class="${card.plainGap ? 'field-tag is-gap' : 'field-tag'}">${escapeHtml(card.plainSource || '原文未提供')}</span>
        </div>
        <p class="field-body">${nl2br(card.plain)}</p>
      </div>
      ${hasCaveat ? `<div class="field field-caveat">
        <span class="field-label">口径提示 / Caveat</span>
        <p class="field-body">${nl2br(card.caveat)}</p>
      </div>` : ''}
      <div class="field field-example">
        <span class="field-label">${escapeHtml(card.exampleLabel)}</span>
        <p class="field-body">${nl2br(card.example)}</p>
      </div>
      ${merged}
    </article>`;
  }

  /**
   * 质量报告：把引擎的判定过程摊开给用户看。
   * 「不凑数」是本项目的立身之本，只给一个数字等于让人没法验证。
   */
  function qualityPanel(stats, cards) {
    if (!stats) return '';

    const produced = stats.qualified - stats.merged - stats.overCeiling;
    const gapCards = cards.filter((c) => c.plainGap);
    const mergedCards = cards.filter((c) => (c.mergedFrom || 1) > 1);

    // 拒判按原因分组
    const byWhy = new Map();
    for (const r of state.rejected) {
      if (!byWhy.has(r.why)) byWhy.set(r.why, []);
      byWhy.get(r.why).push(r);
    }

    const summary =
      `原文 ${stats.sections} 小节 → ${stats.candidates} 候选 → ${stats.qualified} 通过判定` +
      ` → 合并重复 ${stats.merged} → ${produced} 张卡片` +
      (stats.overCeiling ? `（超上限省略 ${stats.overCeiling}）` : '');

    const detail = [];

    detail.push(`<div class="qr-block">
      <div class="qr-title">候选去留<span>${stats.candidates} → ${stats.qualified}</span></div>
      <div class="qr-sum">${escapeHtml(summary)}</div>
      ${Array.from(byWhy.entries())
        .map(
          ([why, items]) => `<details class="qr-sub">
            <summary>未通过：${escapeHtml(why)} · ${items.length} 条</summary>
            <ul class="qr-list">${items
              .slice(0, 20)
              .map(
                (r) =>
                  `<li><span class="qr-sec">${escapeHtml(r.section || '正文')}</span>${nl2br(r.text)}</li>`
              )
              .join('')}</ul>
            ${items.length > 20 ? `<div class="qr-more">仅显示前 20 条，共 ${items.length} 条</div>` : ''}
          </details>`
        )
        .join('')}
    </div>`);

    if (gapCards.length) {
      detail.push(`<div class="qr-block">
        <div class="qr-title">解释缺口<span>${gapCards.length} 张</span></div>
        <div class="qr-sum">这些卡片的主张在原文里成立，但原文没给出可引用的推导。引擎不替你补，标出来等你或模型补。</div>
        <ul class="qr-list">${gapCards
          .map((c) => `<li>#${c.index} ${escapeHtml(c.title)}</li>`)
          .join('')}</ul>
      </div>`);
    }

    if (mergedCards.length) {
      detail.push(`<div class="qr-block">
        <div class="qr-title">合并重复<span>${stats.merged} 处</span></div>
        <ul class="qr-list">${mergedCards
          .map(
            (c) => `<li>#${c.index} ${escapeHtml(c.title)}
              <ul class="qr-list-sub">${(c.mergedTexts || [])
                .map((t) => `<li>${nl2br(t)}</li>`)
                .join('')}</ul></li>`
          )
          .join('')}</ul>
      </div>`);
    }

    if (stats.caveats || stats.disclaimers) {
      detail.push(`<div class="qr-block">
        <div class="qr-title">保真处理</div>
        <div class="qr-sum">口径提示 ${stats.caveats} 张${
          stats.disclaimers
            ? ` · 原文声明 ${stats.disclaimers} 段已逐字保留`
            : ' · 原文无免责声明'
        } · 解释取自原文 ${produced - stats.plainGaps} 张 / 原文未提供 ${stats.plainGaps} 张</div>
      </div>`);
    }

    return `
    <details class="quality">
      <summary class="quality-summary">
        <span class="quality-dot"></span>
        引擎处理 · ${produced} 张卡片
        <span class="quality-hint">展开可看到候选为什么被拒、哪些解释是原文没写的</span>
      </summary>
      <div class="quality-body">
        ${detail.join('')}
        <div class="qr-block qr-foot">耗时 ${stats.elapsed}ms</div>
      </div>
    </details>`;
  }

  /* ---------- 导出与入库 ---------- */

  function exportMeta() {
    return {
      sourceName: state.sourceName || '粘贴的文本',
      stats: state.stats,
      disclaimers: state.disclaimers
    };
  }

  el.btnCopy.addEventListener('click', async () => {
    const md = Exporters.toMarkdown(state.cards, exportMeta());
    if (await UI.copy(md)) flash(el.btnCopy, '已复制');
    else toast('剪贴板不可用，请改用「下载 .md」', 'err');
  });

  el.btnDownload.addEventListener('click', () => {
    const base = (state.sourceName || 'cards').replace(/\.[^.]+$/, '');
    UI.download(
      `${base}-知识卡片.md`,
      Exporters.toMarkdown(state.cards, exportMeta()),
      'text/markdown;charset=utf-8'
    );
  });

  el.btnSave.addEventListener('click', () => {
    if (!state.cards.length) return;
    const src = Store.addSource({
      name: state.sourceName || '粘贴的文本',
      text: state.sourceText || el.source.value,
      disclaimers: state.disclaimers,
      kind: state.sourceName ? 'file' : 'paste'
    });
    const added = Store.addCards(src.id, state.cards);
    state.saved = true;
    refreshBadges();
    el.btnSave.disabled = true;
    toast(`已存入卡片库：${added.length} 张`, 'ok', {
      label: '去看卡片库',
      onClick: () => showTab('library')
    });
  });

  /* ---------- 提示词 ---------- */

  // 规则引擎只做结构化抽取，语义层的取舍交给模型。
  // 这条通路把 SKILL.md 的硬约束压成一段可直接投喂的提示词。
  const PROMPT_RULES = [
    '规则（必须逐条遵守）：',
    '1. 先读完整篇原文再选卡，不要从局部读到的内容里挑。',
    '2. 只有「能被原文反驳」的断言才可成卡：事实、机制、规则、结论、数字。',
    '计划、待办、预测、未决问题不做卡，但要在 footer 的「未收录」行写明为什么没做。',
    '3. 不引入原文之外的信息：不补教科书定义、不补真实统计数字、不补原文没提的名字与机构。',
    '4. 例子只能来自原文，或是原文数字的显式算式（写出算式）。否则改出自测题。',
    '5. 一张卡一个知识点。同一主张的不同表述合并成一张；共享一句原文但各自带不同数字或结论的，分开成卡。',
    '6. 原文的免责声明、虚构标记、数据时效声明必须逐字带到 footer，并重复进带数字卡片的「口径提示」。',
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
    if (text.length > PROMPT_INLINE_LIMIT) {
      return `${head}\n\n正文（${text.length} 字符，超过 ${PROMPT_INLINE_LIMIT}，请分批粘贴并保持编号连续）：\n${text.slice(0, PROMPT_INLINE_LIMIT)}\n……（其余部分我会继续粘贴）`;
    }
    return `${head}\n\n正文：\n${text}`;
  }

  el.btnPrompt.addEventListener('click', async () => {
    if (!el.source.value.trim() && !state.sourceName) {
      showError('请先粘贴文章或选择文件，提示词需要带上来源。');
      return;
    }
    if (await UI.copy(buildPrompt())) {
      flash(el.btnPrompt, '提示词已复制');
      showError('');
    } else {
      showError('剪贴板不可用，请手动选取。');
    }
  });

  /* ---------- 快捷键 ---------- */

  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable);
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!el.btnGenerate.disabled) el.btnGenerate.click();
    }
  });

  /* ---------- 初始化 ---------- */

  function boot() {
    bindTabs();
    Library.init({ onChange: refreshBadges });
    Review.init({ onChange: refreshBadges });
    updateCharCount();
    renderEmpty();
    refreshBadges();
    // Tauri 环境暴露给后端（用 getter，state 会被整体替换，持有引用会失效）
    if (typeof window !== 'undefined') {
      window.__app = {
        get state() { return state; },
        Engine,
        Store,
        Scheduler,
        Exporters
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();