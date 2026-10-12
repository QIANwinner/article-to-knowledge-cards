/**
 * review.js — 复习面板
 *
 * 流程刻意做成「先想 → 再翻面 → 再自评」三步：
 * 直接把答案摊开会让复习退化成重读，自评三档是间隔重复唯一需要用户输入的东西。
 * 键盘 1/2/3 对应 Again/Hard/Good，触屏点按钮——桌面与手机都不用瞄准。
 */

const Review = (() => {
  'use strict';

  const { escapeHtml, toast, nl2br } = UI;

  let queue = [];
  let pos = 0;
  let revealed = false;
  let onChange = () => {};
  let reviewedCount = 0;

  function init(opts = {}) {
    onChange = opts.onChange || (() => {});
    document.addEventListener('keydown', (e) => {
      if (!isActive()) return;
      if (e.key === ' ' || e.key === 'Enter') {
        if (revealed) return;
        e.preventDefault();
        reveal();
      } else if (revealed && (e.key === '1' || e.key === '2' || e.key === '3')) {
        e.preventDefault();
        grade(['again', 'hard', 'good'][Number(e.key) - 1]);
      }
    });
  }

  function isActive() {
    const panel = UI.$('panel-review');
    return panel && !panel.hidden;
  }

  /** 重建队列并渲染第一张 */
  function start() {
    queue = Scheduler.dueQueue(Store.listCards());
    pos = 0;
    revealed = false;
    reviewedCount = 0;
    render();
  }

  /** 外部改动了卡片库（删除、编辑、导入）后重置队列 */
  function refresh() {
    start();
  }

  function reveal() {
    revealed = true;
    render();
  }

  function grade(kind) {
    const card = queue[pos];
    if (!card) return;
    const next = Scheduler.review(card, kind);
    Store.updateCard(card.id, next);
    reviewedCount += 1;
    revealed = false;
    pos += 1;
    onChange();
    render();
  }

  function render() {
    const deck = UI.$('review-deck');
    const total = queue.length;

    UI.$('review-count').textContent = `${Math.min(pos + (total ? 1 : 0), total)} / ${total}`;
    UI.$('review-sub').textContent = '今日待复习';

    if (!total) {
      deck.innerHTML = doneHtml();
      return;
    }
    if (pos >= total) {
      deck.innerHTML = doneHtml();
      return;
    }

    const card = queue[pos];
    const st = Scheduler.stateOf(card);
    const src = Store.getSource(card.sourceId);

    deck.innerHTML = `
      <article class="card review-card">
        <div class="card-head">
          <span class="card-no">${pos + 1}</span>
          <h3 class="card-title">${escapeHtml(card.title)}</h3>
          <span class="card-due">${escapeHtml(Scheduler.dueLabel(card))}</span>
        </div>

        <div class="field field-core">
          <span class="field-label">核心知识 / Core knowledge</span>
          <p class="field-body">${nl2br(card.core)}</p>
        </div>

        ${
          revealed
            ? `<div class="review-back">
                 <div class="field">
                   <div class="field-head">
                     <span class="field-label">简明解释 / Plain explanation</span>
                     <span class="${card.plainGap ? 'field-tag is-gap' : 'field-tag'}">${escapeHtml(card.plainSource || '原文未提供')}</span>
                   </div>
                   <p class="field-body">${nl2br(card.plain)}</p>
                 </div>
                 ${card.caveat ? `<div class="field field-caveat">
                   <span class="field-label">口径提示 / Caveat</span>
                   <p class="field-body">${nl2br(card.caveat)}</p>
                 </div>` : ''}
                 <div class="field field-example">
                   <span class="field-label">${escapeHtml(card.exampleLabel || '例子 / Example')}</span>
                   <p class="field-body">${nl2br(card.example)}</p>
                 </div>
                 <div class="grade-row">
                   ${gradeBtn('again', '想不起来', card)}
                   ${gradeBtn('hard', '很费力', card)}
                   ${gradeBtn('good', '想起来了', card)}
                 </div>
                 <div class="review-hint">按 1 / 2 / 3 也可以</div>
               </div>`
            : `<div class="review-front">
                 <button class="btn btn-primary" id="btn-reveal" type="button">显示答案</button>
                 <div class="review-hint">先自己回想，再翻面 —— 直接看答案等于没复习</div>
               </div>`
        }

        <div class="card-foot">
          间隔 ${st.interval} 天 · ease ${st.ease} · 已复习 ${st.reviewCount} 次 ·
          来源：${escapeHtml(src ? src.name : '（已删除）')}
        </div>
      </article>`;

    const revealBtn = UI.$('btn-reveal');
    if (revealBtn) revealBtn.addEventListener('click', reveal);

    deck.querySelectorAll('[data-grade]').forEach((btn) => {
      btn.addEventListener('click', () => grade(btn.dataset.grade));
    });
  }

  /** 自评按钮上预告「按下之后多久再见」，让间隔决策有依据 */
  function gradeBtn(kind, label, card) {
    const next = Scheduler.review(card, kind);
    const dueTs = next.due;
    const diff = dueTs - Date.now();
    let when;
    if (diff < 60000) when = '10 分钟后';
    else if (diff < Scheduler.DAY) when = `${Math.round(diff / 3600000)} 小时后`;
    else when = `${Math.round(diff / Scheduler.DAY)} 天后`;
    const cls = kind === 'again' ? 'is-again' : kind === 'hard' ? 'is-hard' : 'is-good';
    return `<button class="grade-btn ${cls}" data-grade="${kind}" type="button">
      <span class="grade-label">${label}</span>
      <span class="grade-when">${when}</span>
    </button>`;
  }

  function doneHtml() {
    const all = Store.listCards();
    const s = Scheduler.summarize(all);
    const remaining = Scheduler.dueQueue(all).length;
    return `
      <div class="review-done">
        <div class="review-done-title">${reviewedCount > 0 ? `本轮复习完成 ${reviewedCount} 张` : '当前没有到期的卡片'}</div>
        <div class="review-done-grid">
          <div><b>${s.total}</b><span>总卡片</span></div>
          <div><b>${s.new}</b><span>未复习</span></div>
          <div><b>${s.learning}</b><span>学习中</span></div>
          <div><b>${s.review}</b><span>复习中</span></div>
          <div><b>${s.mastered}</b><span>已掌握</span></div>
          <div><b>${remaining}</b><span>仍到期</span></div>
        </div>
        <div class="review-done-hint">${
          remaining
            ? '还有到期卡片，可能刚刚的「很费力」把它们排到了稍后。'
            : '下一次复习时间由每张卡的 ease 与间隔决定，到期时这里会亮起徽标。'
        }</div>
      </div>`;
  }

  return { init, start, refresh, render, isActive };
})();

if (typeof window !== 'undefined') window.Review = Review;