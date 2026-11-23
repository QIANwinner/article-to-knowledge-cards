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

  const EMPTY = () => ({
    version: VERSION,
    updatedAt: 0,
    sources: Object.create(null),
    cards: Object.create(null)
  });

  // localStorage 不可用时（file:// 协议、隐私模式、配额耗尽）退化为内存库，
  // 界面会提示「本次会话有效」，不会静默丢数据。
  let persistent = true;
  let cache = null;
  let lastRaw = null;
  let dirty = false;

  function backend() {
    try {
      const ls = typeof window !== 'undefined' ? window.localStorage : null;
      if (!ls) throw new Error('no localStorage');
      return ls;
    } catch (e) {
      persistent = false;
      return null;
    }
  }

  function read(latest = false) {
    if (cache && (!latest || dirty)) return cache;
    const ls = backend();
    if (!ls) return (cache ??= EMPTY());
    let raw;
    try {
      raw = ls.getItem(KEY);
    } catch (e) {
      persistent = false;
      return (cache ??= EMPTY());
    }
    if (cache && raw === lastRaw) return cache;
    lastRaw = raw;
    try {
      cache = raw === null ? EMPTY() : migrate(JSON.parse(raw));
      persistent = !cache.corrupted;
    } catch (e) {
      // 保留磁盘上的原档；本次会话可以继续使用并导出新卡。
      cache = EMPTY();
      cache.corrupted = true;
      persistent = false;
    }
    return cache;
  }

  function write() {
    const db = read();
    db.updatedAt = Date.now();
    dirty = true;
    if (db.corrupted) {
      persistent = false;
      return;
    }
    const ls = backend();
    if (!ls) return;
    try {
      // 配额失败后仍能在会话中编辑和导出，但不能用这份旧快照覆盖其他窗口的新存档。
      if (ls.getItem(KEY) !== lastRaw) {
        persistent = false;
        return;
      }
      const raw = JSON.stringify(db);
      ls.setItem(KEY, raw);
      lastRaw = raw;
      dirty = false;
      persistent = true;
    } catch (e) {
      persistent = false; // 配额用尽，转内存模式但保留内存数据
    }
  }

  function refresh() {
    const previous = cache;
    return read(true) !== previous;
  }

  // 界面的一次读改写共用同源锁；读最新存档和计算补丁都要在拿到锁之后。
  async function withWriteLock(action) {
    const run = () => { refresh(); return action(); };
    if (!backend()) return run();
    const locks = globalThis.navigator?.locks;
    return locks ? locks.request(KEY, run) : run();
  }

  function migrate(data) {
    const db = normalizeImport(data);
    db.updatedAt = data.updatedAt || 0;
    if (data.corrupted) db.corrupted = true;
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
    const db = read(true);
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
    const db = read(true);
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
    const db = read(true);
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
    const db = read(true);
    const card = db.cards[id];
    if (!card) return null;
    Object.assign(card, patch, { updatedAt: Date.now() });
    write();
    return card;
  }

  function removeCard(id) {
    const db = read(true);
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
  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function importTable(table, prefix, label) {
    const list = Array.isArray(table);
    if (!list && !isRecord(table)) throw new Error(`备份中的${label}必须是数组或对象`);
    const rows = Object.create(null);
    for (const [key, item] of Object.entries(table)) {
      if (!isRecord(item)) throw new Error(`无效的${label}记录：${key}`);
      const id = item.id ?? (list ? uid(prefix) : key);
      if (typeof id !== 'string' || !id || Object.hasOwn(rows, id)) {
        throw new Error(`${label} ID 无效或重复：${key}`);
      }
      rows[id] = { ...item, id };
    }
    return rows;
  }

  function normalizeImport(data) {
    if (!isRecord(data) || !Object.hasOwn(data, 'cards')) throw new Error('不是卡片备份：缺少 cards');
    if (data.version != null && data.version !== VERSION) throw new Error('不支持此备份版本');
    const db = EMPTY();
    db.sources = importTable(data.sources ?? {}, 's', '来源');
    db.cards = importTable(data.cards, 'c', '卡片');
    for (const s of Object.values(db.sources)) {
      if (typeof s.name !== 'string' || typeof s.text !== 'string' ||
          (s.disclaimers != null && !isStringList(s.disclaimers))) {
        throw new Error(`来源格式不正确：${s.id}`);
      }
    }
    for (const card of Object.values(db.cards)) {
      if (typeof card.title !== 'string' || typeof card.core !== 'string' ||
          ['sourceId', 'section', 'plain', 'caveat', 'raw', 'example', 'exampleLabel'].some(
            (key) => card[key] != null && typeof card[key] !== 'string'
          ) || (card.tags != null && !isStringList(card.tags)) ||
          (card.index != null && !Number.isSafeInteger(card.index))) {
        throw new Error(`卡片格式不正确：${card.id}`);
      }
      if (card.schedule != null) {
        if (!isRecord(card.schedule)) throw new Error(`复习进度格式不正确：${card.id}`);
        for (const key of ['status', 'due', 'interval', 'ease', 'reps', 'lapses', 'streak', 'lastReview', 'reviewCount']) {
          if (Object.hasOwn(card.schedule, key)) card[key] = card.schedule[key];
        }
        delete card.schedule;
      }
      if (card.status != null && !['new', 'learning', 'review', 'mastered'].includes(card.status)) {
        throw new Error(`未知的复习状态：${card.id}`);
      }
    }
    return db;
  }

  function isStringList(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }

  function sameSource(a, b) {
    return a.name === b.name && a.text === b.text &&
      JSON.stringify(a.disclaimers || []) === JSON.stringify(b.disclaimers || []);
  }

  function sameCard(a, b) {
    return a.sourceId === b.sourceId &&
      (a.raw || a.core) === (b.raw || b.core) &&
      (a.index == null || b.index == null || a.index === b.index);
  }

  function freshId(table, prefix) {
    let id;
    do {
      id = uid(prefix);
    } while (Object.hasOwn(table, id));
    return id;
  }

  /**
   * 从备份导入。
   * @param {'merge'|'replace'} mode merge 保留现有库；replace 清空后导入
   */
  function importAll(data, mode = 'merge') {
    const incoming = normalizeImport(data);
    const db = read(true);
    if (mode === 'replace') {
      cache = incoming;
    } else {
      const sourceIds = new Map();
      for (const src of Object.values(incoming.sources)) {
        let id = src.id;
        const direct = Object.hasOwn(db.sources, id) ? db.sources[id] : null;
        if (direct && sameSource(direct, src)) {
          sourceIds.set(src.id, id);
          continue;
        }
        const existing = Object.values(db.sources).find((s) => sameSource(s, src));
        if (existing) {
          sourceIds.set(src.id, existing.id);
          continue;
        }
        if (direct) id = freshId(db.sources, 's');
        db.sources[id] = { ...src, id };
        sourceIds.set(src.id, id);
      }

      for (const card of Object.values(incoming.cards)) {
        const next = {
          ...card,
          sourceId: sourceIds.get(card.sourceId) ?? card.sourceId
        };
        const direct = Object.hasOwn(db.cards, card.id) ? db.cards[card.id] : null;
        if ((direct && sameCard(direct, next)) ||
            Object.values(db.cards).some((c) => sameCard(c, next))) {
          continue;
        }
        const id = direct ? freshId(db.cards, 'c') : card.id;
        db.cards[id] = { ...next, id };
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
    const db = read(true);
    db.cards[card.id] = card;
    write();
    return card;
  }

  function clearAll() {
    read(true);
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
    refresh,
    withWriteLock,
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