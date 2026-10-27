/**
 * store.js — 卡片库与本地持久化
 *
 * 数据全部留在本机：浏览器端走 localStorage，Tauri 端用的是同一个 WebView 存储，
 * 不联网、不上传。数据结构刻意保持可读——导出的 JSON 就是库文件的原样，
 * 用记事本打开就能看懂、能改、能备份。
 *
 * 存储结构（单键 JSON，避免 localStorage 键爆炸）：
 *   akc:v1 → { version, updatedAt, sources: {id: Source}, cards: {id: Card} }
 *
 * Source = { id, name, kind: 'file'|'paste', text, disclaimers[], createdAt }
 * Card   = 引擎产出的字段 + { id, sourceId, createdAt, updatedAt, tags[],
 *                            status, due, interval, ease, reps, lapses, streak,
 *                            lastReview, reviewCount }
 */

const Store = (() => {
  'use strict';

  const KEY = 'akc:v1';
  const VERSION = 1;

  const EMPTY = () => ({ version: VERSION, updatedAt: 0, sources: {}, cards: {} });

  // localStorage 不可用时（file:// 协议、隐私模式、配额耗尽）退化为内存库，
  // 界面会提示「本次会话有效」，不会静默丢数据。
  let memory = EMPTY();
  let persistent = true;
  let cache = null;

  function backend() {
    try {
      const ls = typeof window !== 'undefined' ? window.localStorage : null;
      if (!ls) throw new Error('no localStorage');
      const probe = '__akc_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    } catch (e) {
      persistent = false;
      return null;
    }
  }

  function read() {
    if (cache) return cache;
    const ls = backend();
    if (!ls) {
      cache = memory;
      return cache;
    }
    try {
      const raw = ls.getItem(KEY);
      cache = raw ? migrate(JSON.parse(raw)) : EMPTY();
    } catch (e) {
      // 存档损坏时不要静默清空，保留原始串以便人工抢救
      cache = EMPTY();
      cache.corrupted = true;
      cache.rawBackup = (() => {
        try { return ls.getItem(KEY); } catch (_) { return null; }
      })();
    }
    return cache;
  }

  function write() {
    const db = read();
    db.updatedAt = Date.now();
    const ls = backend();
    if (!ls) {
      memory = db;
      return;
    }
    try {
      ls.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      persistent = false; // 配额用尽，转内存模式但保留内存数据
    }
  }

  function migrate(data) {
    const db = Object.assign(EMPTY(), data || {});
    db.sources = db.sources || {};
    db.cards = db.cards || {};
    return db;
  }

  function uid(prefix) {
    return (
      prefix +
      '_' +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7)
    );
  }

  /* ---------- 来源 ---------- */

  function listSources() {
    return Object.values(read().sources).sort((a, b) => b.createdAt - a.createdAt);
  }

  function getSource(id) {
    return read().sources[id] || null;
  }

  /**
   * 保存一次来源。
   * 同名同内容的来源不重复入库——重复粘贴同一篇文章是最常见的误操作。
   * 内容相等必须逐字比较：长度相同但内容不同的两篇文章不叫重复。
   */
  function addSource({ name, text, disclaimers, kind }) {
    const db = read();
    const existed = listSources().find(
      (s) => s.name === name && s.text === text
    );
    if (existed) return existed;

    const src = {
      id: uid('s'),
      name: name || '粘贴的文本',
      kind: kind || (name ? 'file' : 'paste'),
      text,
      disclaimers: disclaimers || [],
      createdAt: Date.now()
    };
    db.sources[src.id] = src;
    write();
    return src;
  }

  function removeSource(id) {
    const db = read();
    delete db.sources[id];
    // 级联删掉该来源下的卡片：留着没有原文可溯源的卡片是负资产
    for (const [cid, c] of Object.entries(db.cards)) {
      if (c.sourceId === id) delete db.cards[cid];
    }
    write();
  }

  /* ---------- 卡片 ---------- */

  function listCards(filter = {}) {
    let cards = Object.values(read().cards);
    if (filter.sourceId) cards = cards.filter((c) => c.sourceId === filter.sourceId);
    if (filter.status) cards = cards.filter((c) => c.status === filter.status);
    if (filter.needsExplanation) cards = cards.filter((c) => c.plainGap);
    if (filter.query) {
      const q = filter.query.toLowerCase();
      cards = cards.filter(
        (c) =>
          (c.title || '').toLowerCase().includes(q) ||
          (c.core || '').toLowerCase().includes(q) ||
          (c.raw || '').toLowerCase().includes(q) ||
          (c.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }
    cards.sort((a, b) => a.createdAt - b.createdAt || a.index - b.index);
    return cards;
  }

  function getCard(id) {
    return read().cards[id] || null;
  }

  /** 批量入库，返回实际新增的卡片数组（已附 id 与调度初始值） */
  function addCards(sourceId, cards) {
    const db = read();
    const now = Date.now();
    const added = [];
    for (const c of cards) {
      const card = Object.assign({}, c, {
        id: uid('c'),
        sourceId,
        createdAt: now,
        updatedAt: now,
        // 保留调用方带来的标签，其余调度字段一律重置为初始值
        tags: Array.isArray(c.tags) ? c.tags.slice() : [],
        status: 'new',
        due: 0,
        interval: 0,
        ease: 2.5,
        reps: 0,
        lapses: 0,
        streak: 0,
        lastReview: 0,
        reviewCount: 0
      });
      db.cards[card.id] = card;
      added.push(card);
    }
    write();
    return added;
  }

  function updateCard(id, patch) {
    const db = read();
    const card = db.cards[id];
    if (!card) return null;
    Object.assign(card, patch, { updatedAt: Date.now() });
    write();
    return card;
  }

  function removeCard(id) {
    const db = read();
    delete db.cards[id];
    write();
  }

  function setTag(id, tags) {
    return updateCard(id, { tags: Array.from(new Set(tags || [])).filter(Boolean) });
  }

  /* ---------- 备份 ---------- */

  function exportAll() {
    const db = read();
    return {
      version: VERSION,
      exportedAt: new Date().toISOString(),
      generator: 'article-to-knowledge-cards',
      sources: db.sources,
      cards: db.cards
    };
  }

  /**
   * 把两种入库格式归一成 { sources: {id: src}, cards: {id: card} }：
   *   - 库备份（exportAll）：sources / cards 本来就是按 id 的对象，调度字段平铺
   *   - 单批导出（exporters.toJson）：cards 是数组，调度状态收在 schedule 子对象里，
   *     旧版导出还可能没有 id——没有就现发一个，否则按数组下标当键会互相撞车
   */
  function normalizeImport(data) {
    const db = EMPTY();
    const sources = (data && data.sources) || {};
    const cards = (data && data.cards) || {};
    const srcList = Array.isArray(sources) ? sources : Object.values(sources);
    const cardList = Array.isArray(cards) ? cards : Object.values(cards);
    for (const s of srcList) {
      if (s && typeof s === 'object') db.sources[s.id || uid('s')] = s;
    }
    for (const c of cardList) {
      if (!c || typeof c !== 'object') continue;
      const card = Object.assign({}, c);
      if (card.schedule && typeof card.schedule === 'object') {
        Object.assign(card, card.schedule);
        delete card.schedule;
      }
      db.cards[card.id || uid('c')] = card;
    }
    db.updatedAt = (data && data.updatedAt) || 0;
    return db;
  }

  /**
   * 从备份导入。
   * @param {'merge'|'replace'} mode merge 保留现有库；replace 清空后导入
   */
  function importAll(data, mode = 'merge') {
    const incoming = normalizeImport(data);
    if (mode === 'replace') {
      cache = incoming;
    } else {
      const db = read();
      for (const [k, v] of Object.entries(incoming.sources)) {
        if (!db.sources[k]) db.sources[k] = v;
      }
      for (const [k, v] of Object.entries(incoming.cards)) {
        if (!db.cards[k]) db.cards[k] = v;
      }
    }
    write();
    return { sources: Object.keys(read().sources).length, cards: Object.keys(read().cards).length };
  }

  /**
   * 原样放回一张卡（撤销删除用）：保留原 id 与复习进度。
   * 走 addCards 会重置调度状态并换新 id，恢复出来的就不是原来那张卡了。
   */
  function restoreCard(card) {
    if (!card || !card.id) return null;
    const db = read();
    db.cards[card.id] = card;
    write();
    return card;
  }

  function clearAll() {
    cache = EMPTY();
    write();
  }

  function stats() {
    const db = read();
    return {
      persistent,
      corrupted: !!db.corrupted,
      sources: Object.keys(db.sources).length,
      cards: Object.keys(db.cards).length,
      updatedAt: db.updatedAt
    };
  }

  return {
    KEY,
    VERSION,
    persistent: () => persistent,
    listSources,
    getSource,
    addSource,
    removeSource,
    listCards,
    getCard,
    addCards,
    updateCard,
    removeCard,
    setTag,
    exportAll,
    importAll,
    restoreCard,
    clearAll,
    stats
  };
})();

if (typeof window !== 'undefined') window.Store = Store;
if (typeof module !== 'undefined' && module.exports) module.exports = Store;