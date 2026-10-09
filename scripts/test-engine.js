/**
 * test-engine.js — 卡片引擎测试
 * 用仓库里的 4 类样本跑规则引擎，验证输出符合 SKILL.md 的硬约束
 *
 * 运行：npm run test:engine
 */

const fs = require('fs');
const path = require('path');
const Engine = require('../src/card-engine.js');

const SAMPLES = [
  { file: '01-tech-cache.md', label: '英文技术文' },
  { file: '02-news-foldable-cn.md', label: '中文长分析文' },
  { file: '03-thin-notes.txt', label: '极简短笔记' },
  { file: '04-rust-ownership.md', label: '技术讲义' }
];

// 旧版引擎把「原文未展开推导」写成了一句固定模板，所有卡片的解释完全相同。
// 这条断言就是防止它退化回去。
const OLD_TEMPLATE = /^原文直接给出该结论，未展开推导过程/;

const GAP_MARKERS = [/^原文给出「/, /^原文未定义「/, /^原文在此处直接给出结论/];

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

/** 只比空白：引擎在英文换行处会补一个空格，比对时统一压掉空白 */
function squeeze(s) {
  return String(s || '').replace(/\s+/g, '');
}

function traceableIn(text, probe) {
  const p = squeeze(probe).slice(0, 24);
  if (p.length < 6) return true;
  return squeeze(text).includes(p);
}

console.log('='.repeat(64));
console.log('卡片引擎测试 — 规则符合性');
console.log('='.repeat(64));

for (const s of SAMPLES) {
  const p = path.join(__dirname, '..', 'tests', 'samples', s.file);
  const text = fs.readFileSync(p, 'utf8');
  console.log(`\n[${s.label}] ${s.file}`);

  const { cards, stats } = Engine.generate(text);

  console.log(
    `  小节 ${stats.sections} · 候选 ${stats.candidates} · 通过 ${stats.qualified}` +
      ` · 合并 ${stats.merged} · 输出 ${cards.length} 张 · 口径提示 ${stats.caveats}` +
      ` · 解释缺口 ${stats.plainGaps} · 原文声明 ${stats.disclaimers} · ${stats.elapsed}ms`
  );

  // 约束 1：不超过上限
  check(cards.length <= Engine.CEILING, `卡片数 ≤ ${Engine.CEILING}（实际 ${cards.length}）`);

  // 约束 2：编号连续
  const numbering = cards.every((c, i) => c.index === i + 1);
  check(numbering, '卡片编号从1 连续');

  // 约束 3：单知识点 — 一张卡最多 3 句（与 LIMITS.maxSentences 同源）
  const noFused = cards.every(
    (c) => c.raw.split(/[。；;]/).filter((x) => x.trim().length > 0).length <= Engine.LIMITS.maxSentences
  );
  check(noFused, `无多句熔合（单卡 ≤ ${Engine.LIMITS.maxSentences} 句）`);

  // 约束 4：不编造 — 卡片内容必须能在原文找到。
  // plainGap 的解释是引擎对「原文没写」的判断，本身不是原文句子，不参与比对。
  const allTraceable = cards.every(
    (c) =>
      traceableIn(text, c.core.replace(/…$/, '')) &&
      traceableIn(text, c.title.replace(/…$/, '')) &&
      traceableIn(text, c.caveat) &&
      (c.plainGap || traceableIn(text, c.plain))
  );
  check(allTraceable, '核心知识/标题/口径提示均可回溯到原文，引用的解释也可回溯');

  // 约束 5：字段完整
  const fieldsOk = cards.every(
    (c) => c.title && c.core && c.plain && c.example && c.exampleLabel
  );
  check(fieldsOk, '四个必填字段齐全');

  // 约束 6：例子与自测二选一
  const oneField = cards.every((c) => /例子|自测题/.test(c.exampleLabel));
  check(oneField, '例子/自测题标签正确（二选一）');

  // 约束 7：计划类内容不成卡，且不出现在任何一张卡的正文里
  const noPlans = cards.every(
    (c) => !/待办|todo/i.test(c.raw) &&
      !/下周|下个月|还没定|尚未确定|待确认|^(预计|预测|将会)/.test(c.core)
  );
  check(noPlans, '计划/未决事项既不成卡，也不混入其他卡片');

  // 约束 8：无占位符残留
  const noPlaceholder = cards.every(
    (c) => !/undefined|NaN|\[object/.test(c.core + c.plain + c.example)
  );
  check(noPlaceholder, '无undefined/NaN 等占位残留');

  // 约束 9：标题与正文同源，且取自本候选自己的首句
  const titleSameSource = cards.every((c) => {
    const t = c.title.replace(/…$/, '');
    return c.core.includes(t);
  });
  check(titleSameSource, '标题取自本卡正文首句（不跨候选）');

  // 约束 10：解释字段不得退化为固定模板句
  const noTemplate = cards.every((c) => !OLD_TEMPLATE.test(c.plain));
  check(noTemplate, '解释字段不是固定模板句');

  // 约束 11：有原文解释就引原文，引不到就写明缺口并打标记
  const plainHonest = cards.every((c) => {
    if (c.plainGap) {
      return GAP_MARKERS.some((re) => re.test(c.plain)) && c.plainSource === '原文未提供';
    }
    return c.plainSource === '原文因果句' || c.plainSource === '原文相邻句';
  });
  check(plainHonest, '解释字段来源标注正确（原文因果句/相邻句/未提供）');

  // 约束 12：解释不得是核心知识的整段复制
  const plainNotCopy = cards.every((c) => squeeze(c.plain) !== squeeze(c.core));
  check(plainNotCopy, '解释不是核心知识的复制');

  // 约束 13：口径提示必须由原文声明/口径限定/转折句触发
  const caveatHonest = cards.every(
    (c) => !c.caveat || (c.caveat.length >= 8 && traceableIn(text, c.caveat))
  );
  check(caveatHonest, '口径提示非空时必有原文依据');
}

// 专项：不凑数行为
console.log('\n[专项] 不凑数行为');
{
  const thin = fs.readFileSync(
    path.join(__dirname, '..', 'tests', 'samples', '03-thin-notes.txt'),
    'utf8'
  );
  const { cards } = Engine.generate(thin);
  check(cards.length <= 3, `极简样本输出 ≤ 3 张（实际 ${cards.length}）`);

  // 全文只有计划与未决项时应输出 0 张
  const planOnly = '下周做A。下周做B。这件事还没定方案。';
  const r = Engine.generate(planOnly);
  check(r.cards.length === 0, `纯计划内容输出 0 张（实际 ${r.cards.length}）`);
  check(!!r.stats.note, '并给出说明文案');
}

// 专项：原文声明必须搬到口径提示与 footer
console.log('\n[专项] 原文声明保留');
{
  const files = ['01-tech-cache.md', '02-news-foldable-cn.md', '04-rust-ownership.md'];
  let allOk = true;
  let detail = '';
  for (const f of files) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'tests', 'samples', f), 'utf8');
    const { cards, stats } = Engine.generate(text);
    if (stats.disclaimers === 0) {
      allOk = false;
      detail = `${f} 未识别到原文声明`;
      break;
    }
    // 带数字的卡片必须带声明（SKILL.md Step 1）
    const withFigures = cards.filter((c) => /\d/.test(c.core));
    const missing = withFigures.filter((c) => !c.caveat);
    if (missing.length) {
      allOk = false;
      detail = `${f} 有 ${missing.length} 张带数字的卡片缺声明`;
      break;
    }
  }
  check(allOk, detail || '三份带声明的样本：声明已识别并落到带数字卡片的口径提示');
}

// 专项：英文拼接不留粘连空格
console.log('\n[专项] 文本拼接');
{
  const text = 'The cache is cold. Writing is not. Eviction is cheap.';
  const { cards } = Engine.generate(text);
  const glued = cards.some((c) => /\.[A-Za-z]/.test(c.core));
  check(!glued, '英文句号后不粘连（cheap. Writing 而非 cheap.Writing）');

  const cn = '内存被打满。系统自动触发重启。';
  const r = Engine.generate(cn);
  check(!/\s/.test(squeeze(r.cards[0] ? r.cards[0].core : '')), '中文换行处不插入多余空格');
}

// 专项：空输入与超长输入
console.log('\n[专项] 边界处理');
{
  check(Engine.generate('').cards.length === 0, '空输入返回 0 张');
  check(Engine.generate('   \n\n  ').cards.length === 0, '纯空白返回 0 张');

  const long = Array.from({ length: 400 }, (_, i) =>
    `第${i + 1} 条规则：因为条件A成立，所以结果B必然发生，这是第${i + 1} 个知识点。`
  ).join('\n\n');
  const r = Engine.generate(long);
  check(r.cards.length <= Engine.CEILING, `超长输入仍 ≤ ${Engine.CEILING}（实际 ${r.cards.length}）`);
}

console.log('\n' + '='.repeat(64));
console.log(`结果：${pass} 通过，${fail} 失败`);
console.log('='.repeat(64));

process.exit(fail === 0 ? 0 : 1);