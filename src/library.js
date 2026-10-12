/**
 * library.js — 卡片库面板
 *
 * 职责：渲染已入库的卡片、行内编辑、删除、标签、状态标记、四种导出、备份导入。
 * 事件全部走容器委托（data-action + data-id），避免为每张卡挂监听器——
 * 几百张卡时逐个挂监听会让渲染变成 O(n) 的监听器堆叠。
 */

const Library = (() => {
  'use strict';

  const { escapeHtml, toast, flash, download, confirm, readFileAsText, relativeTime, nl2br } = UI;

  const STATUS_META = {
    new: { label: '未复习', cls: 'st-new' },
    learning: { label: '学习中', cls: 'st-learning' },
    review: { label: '复习中', cls: 'st-review' },
    mastered: { label: '已掌握', cls: 'st-mastered' }
  };

  let onChange = () => {};

  function init(opts = {}) {
    onChange = opts.onChange || (() => {});
    const deck = UI.$('lib-deck');

    deck.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'edit') startEdit(id, deck);
      else if (action === 'cancel-edit') render();
      else if (action === 'save-edit') saveEdit(id, deck);
      else if (action === 'delete') remove(id);
      else if (action === 'master') setMastered(id);
      else if (action === 'source') showSource(id);
    });

    UI.$('lib-search').addEventListener('input', () => render());
    UI.$('lib-status').addEventListener('change', () => render());
    UI.$('lib-source').addEventListener('change', () => render());
    UI.$('lib-gap').addEventListener('change', () => render());

    UI.$('lib-export-md').addEventListener('click', () => exportAs('markdown'));
    UI.$('lib-export-anki').addEventListener('click', () => exportAs('anki'));
    UI.$('lib-export-json').addEventListener('click', () => exportAs('json'));
    UI.$('lib-export-obs').addEventListener('click', () => exportAs('obsidian'));

    const importInput = UI.$('lib-import');
    importInput.addEventListener('change', async () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = '';
      if (!file) return;
      try {
        const text = await readFileAsText(file);
        const data = JSON.parse(text);
        const res = Store.importAll(data, 'merge');
        toast(`已导入：${res.cards} 张卡片 / ${res.sources} 个来源`, 'ok');
        render();
        onChange();
      } catch (err) {
        toast('导入失败：' + (err && err.message ? err.message : err), 'err');
      }
    });
  }

  /* ---------- 筛选 ---------- */

  function filter() {
    return {
      query: UI.$('lib-search').value.trim(),
      status: UI.$('lib-status').value,
      sourceId: UI.$('lib-source').value,
      needsExplanation: UI.$('lib-gap').checked
    };
  }

  function renderSourceOptions() {
    const sel = UI.$('lib-source');
    const current = sel.value;
    const sources = Store.listSources();
    sel.innerHTML =
      '<option value="">全部来源</option>' +
      sources
        .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}（${s.cards || 0}）</option>`)
        .join('');
    sel.value = current;
  }

  /* ---------- 渲染 ---------- */

  function render() {
    const deck = UI.$('lib-deck');
    const f = filter();
    const all = Store.listCards();
    const cards = Store.listCards(f);
    const summary = Scheduler.summarize(all);

    renderSourceOptions();

    UI.$('lib-meta').textContent =
      `${cards.length} 张` +
      (cards.length !== all.length ? `（共 ${all.length} 张）` : '') +
      ` · 未复习 ${summary.new} · 学习中 ${summary.learning} · 复习中 ${summary.review} · 已掌握 ${summary.mastered}`;

    if (!all.length) {
      deck.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="7" y="10" width="14" height="28" rx="2" />
              <rect x="24" y="10" width="17" height="13" rx="2" />
              <rect x="24" y="26" width="17" height="12" rx="2" />
            </svg>
          </div>
          <p class="empty-title">卡片库还是空的</p>
          <p class="empty-sub">在「生成」页做出一批卡片后点「存入卡片库」</p>
        </div>`;
      return;
    }

    if (!cards.length) {
      deck.innerHTML = '<div class="engine-note">没有符合筛选条件的卡片。</div>';
      return;
    }

    deck.innerHTML = cards.map((c, i) => cardHtml(c, i)).join('');
  }

  function cardHtml(c) {
    const st = Scheduler.stateOf(c);
    const meta = STATUS_META[st.status] || STATUS_META.new;
    const src = Store.getSource(c.sourceId);
    const due = Scheduler.dueLabel(c);

    return `
    <article class="card lib-card" data-id="${escapeHtml(c.id)}" style="--i:${Math.min(i, 11)}">
      <div class="card-head">
        <span class="card-no">${c.index}</span>
        <h3 class="card-title">${escapeHtml(c.title)}</h3>
        <span class="status-pill ${meta.cls}">${meta.label}</span>
        <span class="card-due">${escapeHtml(due)}</span>
      </div>

      <div class="lib-actions">
        <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${escapeHtml(c.id)}" type="button">编辑</button>
        <button class="btn btn-ghost btn-sm" data-action="master" data-id="${escapeHtml(c.id)}" type="button">${
          st.status === 'mastered' ? '取消掌握' : '标记已掌握'
        }</button>
        <button class="btn btn-ghost btn-sm" data-action="source" data-id="${escapeHtml(c.id)}" type="button">查看原文</button>
        <button class="btn btn-ghost btn-sm is-danger" data-action="delete" data-id="${escapeHtml(c.id)}" type="button">删除</button>
      </div>

      <div class="card-body">
        <div class="field field-core">
          <span class="field-label">核心知识 / Core knowledge</span>
          <p class="field-body">${nl2br(c.core)}</p>
        </div>
        <div class="field">
          <div class="field-head">
            <span class="field-label">简明解释 / Plain explanation</span>
            <span class="${c.plainGap ? 'field-tag is-gap' : 'field-tag'}">${escapeHtml(c.plainSource || '原文未提供')}</span>
          </div>
          <p class="field-body">${nl2br(c.plain)}</p>
        </div>
        ${c.caveat ? `<div class="field field-caveat">
          <span class="field-label">口径提示 / Caveat</span>
          <p class="field-body">${nl2br(c.caveat)}</p>
        </div>` : ''}
        <div class="field field-example">
          <span class="field-label">${escapeHtml(c.exampleLabel || '例子 / Example')}</span>
          <p class="field-body">${nl2br(c.example)}</p>
        </div>
        ${c.tags && c.tags.length ? `<div class="lib-tags">${c.tags
          .map((t) => `<span class="lib-tag">#${escapeHtml(t)}</span>`)
          .join('')}</div>` : ''}
        <div class="card-foot">
          来源：${escapeHtml(src ? src.name : '（已删除）')} · 小节：${escapeHtml(c.section || '正文')} ·
          复习 ${st.reviewCount} 次 · 间隔 ${st.interval} 天 · ease ${st.ease} · 入库 ${relativeTime(c.createdAt)}
        </div>
        <div class="lib-source-text" hidden>
          <span class="field-label">原文句（卡片就是从这一句切出来的）</span>
          <p class="field-body">${nl2br(c.raw || c.core)}</p>
        </div>
      </div>
    </article>`;
  }

  /* ---------- 编辑 ---------- */

  function startEdit(id, deck) {
    const c = Store.getCard(id);
    if (!c) return;
    const card = deck.querySelector(`.lib-card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const body = card.querySelector('.card-body');
    body.innerHTML = `
      <div class="card-editor">
        <label class="ed-row"><span>标题</span><input type="text" data-f="title" value="${escapeHtml(c.title || '')}" /></label>
        <label class="ed-row"><span>核心知识</span><textarea data-f="core" rows="3">${escapeHtml(c.core || '')}</textarea></label>
        <label class="ed-row"><span>简明解释</span><textarea data-f="plain" rows="3">${escapeHtml(c.plain || '')}</textarea></label>
        <label class="ed-row"><span>口径提示</span><textarea data-f="caveat" rows="2">${escapeHtml(c.caveat || '')}</textarea></label>
        <label class="ed-row"><span>${escapeHtml(c.exampleLabel || '例子 / Example')}</span><textarea data-f="example" rows="2">${escapeHtml(c.example || '')}</textarea></label>
        <label class="ed-row"><span>标签</span><input type="text" data-f="tags" placeholder="逗号分隔，如：缓存, 性能" value="${escapeHtml((c.tags || []).join(', '))}" /></label>
        <div class="ed-actions">
          <button class="btn btn-primary btn-sm" data-action="save-edit" data-id="${escapeHtml(id)}" type="button">保存</button>
          <button class="btn btn-ghost btn-sm" data-action="cancel-edit" type="button">取消</button>
          <span class="ed-hint">改了简明解释后，「原文未提供」标记会自动解除</span>
        </div>
      </div>`;
    body.querySelector('[data-f="plain"]').focus();
  }

  function saveEdit(id, deck) {
    const c = Store.getCard(id);
    if (!c) return;
    const card = deck.querySelector(`.lib-card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const val = (f) => {
      const el = card.querySelector(`[data-f="${f}"]`);
      return el ? el.value : '';
    };

    const plain = val('plain');
    const patch = {
      title: val('title').trim() || c.title,
      core: val('core'),
      plain,
      caveat: val('caveat').trim(),
      example: val('example')
    };

    // 人工补了解释就不要再显示「原文未提供」——那是对引擎状态的描述，不是对人的评价
    if (c.plainGap && plain && plain !== c.plain) {
      patch.plainGap = false;
      patch.plainSource = '人工补充';
    }
    if (!patch.plain) patch.plain = c.plain;

    Store.updateCard(id, patch);
    Store.setTag(id, val('tags').split(/[,，]/).map((s) => s.trim()).filter(Boolean));
    toast('已保存', 'ok');
    render();
    onChange();
  }

  /* ---------- 操作 ---------- */

  function remove(id) {
    const c = Store.getCard(id);
    if (!c) return;
    if (!confirm(`删除这张卡片？\n\n${c.title}`)) return;
    const src = Store.getSource(c.sourceId);
    Store.removeCard(id);
    toast('已删除', 'info', {
      label: '撤销',
      onClick: () => {
        Store.addCards(c.sourceId, [c]);
        toast('已恢复', 'ok');
        render();
        onChange();
      }
    });
    //来源卡片数变化时同步来源筛选器里的计数
    if (src) renderSourceOptions();
    render();
    onChange();
  }

  function setMastered(id) {
    const c = Store.getCard(id);
    if (!c) return;
    const st = Scheduler.stateOf(c);
    if (st.status === 'mastered') {
      Store.updateCard(id, { status: 'new', due: 0, reps: 0, streak: 0, interval: 0 });
      toast('已移回未复习');
    } else {
      Store.updateCard(id, {
        status: 'mastered',
        due: Date.now() + Scheduler.DAY * 365,
        streak: Math.max(st.streak, 3),
        reviewCount: Math.max(st.reviewCount, 1)
      });
      toast('已标记为掌握', 'ok');
    }
    render();
    onChange();
  }

  function showSource(id) {
    const c = Store.getCard(id);
    if (!c) return;
    const card = document.querySelector(`.lib-card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const box = card.querySelector('.lib-source-text');
    if (!box) return;
    box.hidden = !box.hidden;
  }

  /* ---------- 导出 ---------- */

  function exportAs(format) {
    const cards = Store.listCards(filter());
    if (!cards.length) {
      toast('当前筛选结果为空，没有可导出的卡片', 'err');
      return;
    }
    const f = filter();
    const sources = new Set(cards.map((c) => (Store.getSource(c.sourceId) || {}).name).filter(Boolean));
    const sourceName = f.sourceId
      ? (Store.getSource(f.sourceId) || {}).name || '卡片库'
      : sources.size === 1
        ? [...sources][0]
        : `卡片库（${cards.length} 张，${sources.size} 个来源）`;

    const base = (sourceName || 'cards').replace(/\.[^.]+$/, '');
    const meta = { sourceName, tags: [] };

    if (format === 'markdown') {
      download(`${base}-知识卡片.md`, Exporters.toMarkdown(cards, meta), 'text/markdown;charset=utf-8');
    } else if (format === 'anki') {
      // BOM 让 Excel / Anki 正确识别 UTF-8，否则中文全是乱码
      download(`${base}-anki.csv`, '﻿' + Exporters.toAnkiCsv(cards, { deck: base }), 'text/csv;charset=utf-8');
    } else if (format === 'json') {
      download(`${base}-cards.json`, Exporters.toJson(cards, meta), 'application/json;charset=utf-8');
    } else if (format === 'obsidian') {
      download(`${base}-obsidian.md`, Exporters.toObsidian(cards, meta), 'text/markdown;charset=utf-8');
    }
    toast(`已导出 ${cards.length} 张（${format}）`, 'ok');
  }

  function flashBtn(btn, msg) {
    flash(btn, msg);
  }

  return { init, render, exportAs, renderSourceOptions };
})();

if (typeof window !== 'undefined') window.Library = Library;