/**
 * test-scheduler.js — 间隔重复调度器与卡片库测试
 *
 * 运行：npm run test:scheduler
 *
 * 覆盖两类：
 *   1. Scheduler —— 间隔递增、ease 夹紧、Again 回退、掌握判定、队列排序
 *   2. Store    —— 持久化读写、筛选、来源级联删除、导出导入往返
 *
 * Store 用注入的假 localStorage 跑真实的持久化分支（不是内存降级分支），
 * 这样 setItem 序列化 / 解析这条路径在 CI 里也被覆盖到。
 */

const path = require('path');

// ---- 注入假 localStorage，让 Store 走真实持久化分支 ----
function makeLocalStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    get size() {
      return data.size;
    },
    __raw: data
  };
}
global.window = { localStorage: makeLocalStorage() };

const Scheduler = require(path.join(__dirname, '..', 'src', 'scheduler.js'));
const Store = require(path.join(__dirname, '..', 'src', 'store.js'));

let pass = 0;
let fail = 0;

function check(cond, msg) {
  if (cond) {
    pass++;
    console.log(`    PASS  ${msg}`);
  } else {
    fail++;
    console.log(`    FAIL  ${msg}`);
  }
}

const DAY = Scheduler.DAY;
const T0 = 1750000000000; // 固定基准时间，避免测试随真实时钟抖动

function makeCard(over = {}) {
  return Object.assign(
    {
      id: 'c_test',
      index: 1,
      title: '测试卡片',
      core: '核心知识',
      plain: '解释',
      plainSource: '原文因果句',
      plainGap: false,
      caveat: '',
      exampleLabel: '例子 / Example',
      example: '例子',
      section: '一节',
      raw: '原文句',
      tags: [],
      status: 'new',
      due: 0,
      interval: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
      streak: 0,
      lastReview: 0,
      reviewCount: 0
    },
    over
  );
}

console.log('='.repeat(64));
console.log('调度器与卡片库测试');
console.log('='.repeat(64));

/* ---------- 1. 初始状态 ---------- */
console.log('\n[初始状态]');
{
  const s = Scheduler.init(makeCard());
  check(s.status === 'new' && s.reps === 0 && s.ease === 2.5, '新卡状态为 new / reps 0 / ease 2.5');
  check(s.reviewCount === 0 && s.due === 0, '新卡未安排复习');
}

/* ---------- 2. Good 的间隔递增 ---------- */
console.log('\n[Good：间隔递增]');
{
  let card = makeCard();
  const s1 = Scheduler.review(card, 'good', T0);
  check(s1.interval === 1, `第 1 次 Good → 1 天（实际 ${s1.interval}）`);
  check(s1.reps === 1 && s1.status === 'learning', '第 1 次后 status = learning');

  card = Object.assign(card, s1);
  const s2 = Scheduler.review(card, 'good', T0);
  check(s2.interval === 6, `第 2 次 Good → 6 天（实际 ${s2.interval}）`);

  card = Object.assign(card, s2);
  const s3 = Scheduler.review(card, 'good', T0);
  check(s3.interval > 6, `第 3 次 Good → 间隔继续增长（实际 ${s3.interval}）`);
  check(s3.reps === 3 && s3.streak === 3, 'reps / streak 累加');
  check(s3.status === 'review', '第 3 次后 status = review');
}

/* ---------- 3. Again 回退 ---------- */
console.log('\n[Again：回退]');
{
  const card = makeCard({ reps: 4, interval: 20, ease: 2.3, streak: 3 });
  const s = Scheduler.review(card, 'again', T0);
  check(s.reps === 0 && s.streak === 0, 'Again 后 reps 与 streak 归零');
  check(s.lapses === 1, 'Again 计入 lapses');
  check(s.ease < 2.3, `ease 下调（${2.3} → ${s.ease}）`);
  check(s.due - T0 === 10 * 60 * 1000, '10 分钟后重来');
  check(s.status === 'learning', 'Again 后 status = learning');
}

/* ---------- 4. Hard 的 1.2 倍间隔与下限 ---------- */
console.log('\n[Hard：1.2 倍与下限]');
{
  const card = makeCard({ reps: 3, interval: 10, ease: 2.5, status: 'review' });
  const s = Scheduler.review(card, 'hard', T0);
  check(Math.abs(s.interval - 12) < 0.01, `10 天 × 1.2 = 12 天（实际 ${s.interval}）`);

  const tiny = makeCard({ reps: 1, interval: 0, ease: 2.5, status: 'learning' });
  const s2 = Scheduler.review(tiny, 'hard', T0);
  check(s2.interval === 1, '间隔不会低于 1 天');
  check(s2.streak === 0, 'Hard 会清空 streak');
}

/* ---------- 5. ease 夹紧 ---------- */
console.log('\n[ease 夹紧]');
{
  let card = makeCard({ ease: 1.35, reps: 2, interval: 10 });
  for (let i = 0; i < 5; i++) {
    card = Object.assign(card, Scheduler.review(card, 'again', T0));
  }
  check(card.ease === Scheduler.MIN_EASE, `多次 Again 后 ease 停在 ${Scheduler.MIN_EASE}（实际 ${card.ease}）`);

  let hi = makeCard({ ease: 2.9, reps: 5, interval: 40 });
  for (let i = 0; i < 5; i++) {
    hi = Object.assign(hi, Scheduler.review(hi, 'good', T0));
  }
  check(hi.ease <= Scheduler.MAX_EASE, `多次 Good 后 ease 不超过 ${Scheduler.MAX_EASE}（实际 ${hi.ease}）`);
}

/* ---------- 6. 掌握判定 ---------- */
console.log('\n[掌握判定]');
{
  let card = makeCard();
  let mastered = false;
  for (let i = 0; i < 8; i++) {
    card = Object.assign(card, Scheduler.review(card, 'good', T0));
    if (card.status === 'mastered') {
      mastered = true;
      break;
    }
  }
  check(mastered, '连续 Good 后达到已掌握');
  check(card.streak >= 3 && card.interval >= 30, `掌握门槛：streak ≥ 3 且间隔 ≥ 30 天（实际 ${card.streak} / ${card.interval}）`);

  const masteredCard = makeCard({ status: 'mastered', due: T0 - DAY, reviewCount: 5 });
  check(!Scheduler.isDue(masteredCard, T0), '已掌握的卡不再进入队列');
}

/* ---------- 7. 不修改入参 ---------- */
console.log('\n[纯函数性]');
{
  const card = makeCard({ reps: 2, interval: 6, ease: 2.5 });
  const snapshot = JSON.stringify(card);
  Scheduler.review(card, 'good', T0);
  check(JSON.stringify(card) === snapshot, 'review() 不修改传入的卡片对象');
}

/* ---------- 8. 到期判定与队列 ---------- */
console.log('\n[到期队列]');
{
  const fresh = makeCard({ id: 'new', reviewCount: 0 });
  const due = makeCard({ id: 'due', due: T0 - 1000, reviewCount: 2, status: 'review' });
  const later = makeCard({ id: 'later', due: T0 + 5 * DAY, reviewCount: 3, status: 'review' });

  check(Scheduler.isDue(fresh, T0), '没复习过的卡立即到期');
  check(Scheduler.isDue(due, T0), '已到期的卡可复习');
  check(!Scheduler.isDue(later, T0), '未到期的卡不进队列');

  const q = Scheduler.dueQueue([later, due, fresh], T0);
  check(q.length === 2, `队列只含到期卡（实际 ${q.length}）`);
  check(q[0].id === 'new', '新卡排在最前');
}

/* ---------- 9. 统计与文案 ---------- */
console.log('\n[统计与文案]');
{
  const cards = [
    makeCard({ id: 'a', status: 'new', reviewCount: 0 }),
    makeCard({ id: 'b', status: 'learning', due: T0 + 2 * 3600000, reviewCount: 1 }),
    makeCard({ id: 'c', status: 'review', due: T0 + 3 * DAY, reviewCount: 4 }),
    makeCard({ id: 'd', status: 'mastered', due: T0 + 365 * DAY, reviewCount: 9 })
  ];
  const s = Scheduler.summarize(cards, T0);
  check(s.total === 4, `总数 4（实际 ${s.total}）`);
  check(s.new === 1 && s.learning === 1 && s.review === 1 && s.mastered === 1, '四种状态计数正确');
  check(s.due === 1, `到期 1 张（实际 ${s.due}）`);

  check(Scheduler.dueLabel(cards[0], T0) === '待首次复习', '新卡文案');
  check(Scheduler.dueLabel(cards[3], T0) === '已掌握', '已掌握文案');
  check(/小时后/.test(Scheduler.dueLabel(cards[1], T0)), '小时级文案');
  check(/天后/.test(Scheduler.dueLabel(cards[2], T0)), '天级文案');
}

/* ---------- 10. Store 持久化 ---------- */
console.log('\n[卡片库持久化]');
{
  check(Store.persistent(), 'localStorage 可用（走真实持久化分支）');

  const src = Store.addSource({ name: 'a.md', text: '原文内容 A' });
  check(!!src.id, '来源入库');
  const again = Store.addSource({ name: 'a.md', text: '原文内容 A' });
  check(again.id === src.id, '同名同内容的来源不重复入库');

  const added = Store.addCards(src.id, [
    { index: 1, title: '卡一', core: '核心一', plain: '解释一', plainGap: true, tags: ['缓存'] },
    { index: 2, title: '卡二', core: '核心二', plain: '解释二', plainGap: false, caveat: '声明' }
  ]);
  check(added.length === 2, '批量入库 2 张');
  check(added[0].status === 'new' && added[0].ease === 2.5, '入库时写入调度初始值');
  check(added[0].sourceId === src.id, '卡片关联来源');

  const all = Store.listCards();
  check(all.length === 2, `列出 2 张（实际 ${all.length}）`);
  check(Store.listCards({ needsExplanation: true }).length === 1, '按「待补解释」筛选');
  check(Store.listCards({ query: '卡二' }).length === 1, '按关键词筛选');
  check(Store.listCards({ query: '缓存' }).length === 1, '按标签筛选');

  const updated = Store.updateCard(all[0].id, { title: '改过的标题' });
  check(updated.title === '改过的标题', '更新标题');
  Store.setTag(all[0].id, ['缓存', '性能', '缓存']);
  check(Store.getCard(all[0].id).tags.length === 2, '标签去重');

  // 落盘验证：换一个 Store 实例读回来，数据仍在
  const raw = global.window.localStorage.getItem(Store.KEY);
  check(!!raw && raw.includes('改过的标题'), '数据已写入 localStorage');

  Store.removeCard(all[1].id);
  check(Store.listCards().length === 1, '删除单卡');

  const backup = Store.exportAll();
  check(backup.cards && Object.keys(backup.cards).length === 1, '导出备份含全部卡片');

  Store.clearAll();
  check(Store.listCards().length === 0, '清空库');

  const res = Store.importAll(backup, 'merge');
  check(res.cards === 1, `导入还原（实际 ${res.cards}）`);
  check(Store.listCards()[0].title === '改过的标题', '导入后字段完整');

  Store.removeSource(src.id);
  check(Store.listCards().length === 0, '删除来源会级联删除其卡片');
  check(Store.listSources().length === 0, '来源已删除');
}

console.log('\n' + '='.repeat(64));
console.log(`结果：${pass} 通过，${fail} 失败`);
console.log('='.repeat(64));

process.exit(fail === 0 ? 0 : 1);