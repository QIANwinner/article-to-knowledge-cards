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
      ` · 合并 ${stats.merged} · 输出 ${cards.length} 张 · ${stats.elapsed}ms`
  );

  // 约束 1：不超过上限
  check(cards.length <= Engine.CEILING, `卡片数 ≤ ${Engine.CEILING}（实际 ${cards.length}）`);

  // 约束 2：编号连续
  const numbering = cards.every((c, i) => c.index === i + 1);
  check(numbering, '卡片编号从1 连续');

  // 约束 3：单知识点 — 不应出现多个段落拼接
  const noFused = cards.every((c) => {
    const sentences = c.raw.split(/[。；;]/).filter((x) => x.trim().length > 0);
    return sentences.length <= 4;
  });
  check(noFused, '无多句熔合（单卡≤ 4 句）');

  // 约束 4：不编造 — 卡片内容必须能在原文找到
  // 用较长 probe（避开截断在 markdown 标记中间导致的假阴性），
  // 且只对中文按去空格比对，英文保留原样
  const allTraceable = cards.every((c) => {
    const probe = c.core.replace(/…$/, '').slice(0, 24);
    if (probe.length < 6) return true;
    if (/[一-龥]/.test(probe)) {
      return text.replace(/\s/g, '').includes(probe.replace(/\s/g, ''));
    }
    return text.includes(probe);
  });
  check(allTraceable, '所有卡片内容可回溯到原文');

  // 约束 5：字段完整
  const fieldsOk = cards.every(
    (c) => c.title && c.core && c.plain && c.example && c.exampleLabel
  );
  check(fieldsOk, '四个必填字段齐全');

  // 约束 6：例子与自测二选一
  const oneField = cards.every(
    (c) => /例子|自测题/.test(c.exampleLabel)
  );
  check(oneField, '例子/自测题标签正确（二选一）');

  // 约束 7：计划类内容不成卡
  const noPlans = cards.every(
    (c) => !/^(待办|todo)|^(下周|下个月).*计划|^还没定|^(预计|预测)/i.test(c.raw)
  );
  check(noPlans, '计划/未决事项未成卡');

  // 约束 8：无占位符残留
  const noPlaceholder = cards.every(
    (c) => !/undefined|NaN|\[object/.test(c.core + c.plain + c.example)
  );
  check(noPlaceholder, '无undefined/NaN 等占位残留');
}

// 专项：极简样本不应强行凑数
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