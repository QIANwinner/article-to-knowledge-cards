/**
 * scheduler.js — 间隔重复调度（SM-2 变体）
 *
 * 诚实说明：这是 SM-2 的变体，**不是 FSRS**。
 *   SM-2 是 1987 年的工业标准，公式简单、行为可解释、可手工核对；
 *   FSRS 用 17 个权重拟合遗忘曲线，效果更好但参数需按个人数据标定，
 *   在没有标定数据之前套FSRS 只会得到一个「看起来高级但不可信」的间隔。
 *   等卡片量过百、有了真实的「记得/忘了」记录，再换 FSRS 不迟。
 *
 * 三档自评（不做 0-5 六档：三档在键盘和触屏上都用得动，且不易乱按）：
 *   Again —— 完全想不起来
 *   Hard  — 想起来很费力
 *   Good  — 正常想起
 *
 * 调度规则：
 *   Again → 复习次数清零，10 分钟后重来，ease 下调
 *   Hard  → 间隔 × 1.2（至少 1 天），ease 小幅下调
 *   Good  → 间隔 × ease，首次 1 天、第二次 6 天，之后按 ease 递增
 *   ease 恒被夹在 [1.3, 3.0]，避免难度失控
 *   连续 3 次 Good 且间隔 ≥ 30 天 → 标记为已掌握
 */

const Scheduler = (() => {
  'use strict';

  const MIN_EASE = 1.3;
  const MAX_EASE = 3.0;
  const DAY = 24 * 60 * 60 * 1000;
  const AGAIN_DELAY = 10 * 60 * 1000; // 10 分钟后重来
  const MASTER_STREAK = 3;
  const MASTER_INTERVAL = 30 * DAY;

  const GRADES = {
    again: { key: 'again', label: '想不起来', delta: -0.20 },
    hard: { key: 'hard', label: '很费力', delta: -0.15 },
    good: { key: 'good', label: '想起来了', delta: 0 }
  };

  function clampEase(v) {
    return Math.min(MAX_EASE, Math.max(MIN_EASE, v));
  }

  /** 新卡片的初始调度状态 */
  function init(card) {
    return {
      status: 'new',
      due: 0,
      interval: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
      streak: 0,
      lastReview: 0,
      reviewCount: 0
    };
  }

  /** 取出卡片的调度状态，缺字段时补全（兼容旧数据） */
  function stateOf(card) {
    const base = init(card);
    return {
      status: card.status || base.status,
      due: typeof card.due === 'number' ? card.due : base.due,
      interval: typeof card.interval === 'number' ? card.interval : base.interval,
      ease: typeof card.ease === 'number' ? card.ease : base.ease,
      reps: typeof card.reps === 'number' ? card.reps : base.reps,
      lapses: typeof card.lapses === 'number' ? card.lapses : base.lapses,
      streak: typeof card.streak === 'number' ? card.streak : base.streak,
      lastReview: typeof card.lastReview === 'number' ? card.lastReview : base.lastReview,
      reviewCount: typeof card.reviewCount === 'number' ? card.reviewCount : base.reviewCount
    };
  }

  /**
   * 应用一次自评，返回新的调度状态（不修改传入对象）。
   * @param {Object} card 卡片
   * @param {'again'|'hard'|'good'} grade
   * @param {number} now 当前时间戳，默认 Date.now()
   */
  function review(card, grade, now = Date.now()) {
    const s = stateOf(card);
    const g = GRADES[grade] ? GRADES[grade] : GRADES.good;

    let ease = s.ease;
    let interval = s.interval;
    let reps = s.reps;
    let lapses = s.lapses;
    let streak = s.streak;

    if (g.key === 'again') {
      lapses += 1;
      reps = 0;
      streak = 0;
      ease = clampEase(ease + g.delta);
      interval = AGAIN_DELAY / DAY; // 以「天」为单位保存，展示时换算
      return finalize({
        status: 'learning',
        ease,
        interval,
        reps,
        lapses,
        streak,
        due: now + AGAIN_DELAY,
        lastReview: now,
        reviewCount: s.reviewCount + 1
      });
    }

    ease = clampEase(ease + g.delta);

    if (g.key === 'hard') {
      streak = 0;
      // 间隔太小会让 Hard 变成「和 Again 差不多」，用 1 天兜底
      interval = Math.max(1, interval * 1.2);
    } else {
      reps += 1;
      streak += 1;
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 6;
      else interval = Math.max(interval + 1, interval * ease);
    }

    const next = finalize({
      status: reps >= 2 ? 'review' : 'learning',
      ease,
      interval,
      reps,
      lapses,
      streak,
      due: now + interval * DAY,
      lastReview: now,
      reviewCount: s.reviewCount + 1
    });

    if (streak >= MASTER_STREAK && interval * DAY >= MASTER_INTERVAL) {
      next.status = 'mastered';
    }
    return next;
  }

  function finalize(s) {
    // interval 保留 3 位小数，避免浮点尾巴污染 JSON 与展示
    s.interval = Math.round(s.interval * 1000) / 1000;
    s.ease = Math.round(s.ease * 1000) / 1000;
    return s;
  }

  /** 是否到期（含 new 状态：没复习过的卡立即进入队列） */
  function isDue(card, now = Date.now()) {
    const s = stateOf(card);
    if (s.status === 'mastered') return false;
    return s.reviewCount === 0 || s.due <= now;
  }

  /** 到期队列，按到期时间升序；new 卡排在最前 */
  function dueQueue(cards, now = Date.now()) {
    return cards
      .filter((c) => isDue(c, now))
      .sort((a, b) => {
        const sa = stateOf(a);
        const sb = stateOf(b);
        const na = sa.reviewCount === 0 ? -Infinity : sa.due;
        const nb = sb.reviewCount === 0 ? -Infinity : sb.due;
        return na - nb;
      });
  }

  /** 库级统计 */
  function summarize(cards, now = Date.now()) {
    const s = { total: cards.length, new: 0, learning: 0, review: 0, mastered: 0, due: 0 };
    for (const c of cards) {
      const st = stateOf(c);
      s[st.status] = (s[st.status] || 0) + 1;
      if (isDue(c, now)) s.due += 1;
    }
    return s;
  }

  /** 人类可读的「下次复习」文案 */
  function dueLabel(card, now = Date.now()) {
    const s = stateOf(card);
    if (s.status === 'mastered') return '已掌握';
    if (s.reviewCount === 0) return '待首次复习';
    const diff = s.due - now;
    if (diff <= 0) return '现在可复习';
    if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.round(diff / 60000))} 分钟后`;
    if (diff < DAY) return `${Math.round(diff / 3600000)} 小时后`;
    return `${Math.round(diff / DAY)} 天后`;
  }

  return {
    DAY,
    GRADES,
    MIN_EASE,
    MAX_EASE,
    init,
    stateOf,
    review,
    isDue,
    dueQueue,
    summarize,
    dueLabel
  };
})();

if (typeof window !== 'undefined') window.Scheduler = Scheduler;
if (typeof module !== 'undefined' && module.exports) module.exports = Scheduler;