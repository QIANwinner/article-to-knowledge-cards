/**
 * check-ui-contract.js — UI 契约自检
 *
 * 为什么需要它：本地没有可用的无头浏览器，界面层的运行时错误无法靠 CI 拦住。
 * 这个脚本用静态检查覆盖最容易出、后果最直接的三类问题：
 *   1. JS 里查询了 HTML 中不存在的 id —— 运行时必崩（null.addEventListener）
 *   2. HTML / JS 里用了 CSS 中不存在的类名 —— 界面上「凭空消失」但不会报错
 *   3. 模块导出的方法与调用处不一致 —— 拼错方法名，运行时 undefined is not a function
 *
 * 覆盖不到：真实渲染、事件绑定后的交互、视觉正确性。这些仍需人工过一遍。
 *
 * 运行：npm run check:ui
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
const jsFiles = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
const js = {};
for (const f of jsFiles) js[f] = fs.readFileSync(path.join(SRC, f), 'utf8');

let pass = 0;
let fail = 0;
const warnings = [];

function check(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL  ${msg}`);
  }
}

/* ---------- 1. id 契约 ---------- */

const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Map(); // id -> [文件]

// 动态生成的 id（写在 JS 模板字符串里的 id="..."）也算已声明，
// 否则 review.js 里的 btn-reveal 会被误报成「HTML 中不存在」
const dynamicIds = new Set();

for (const [file, code] of Object.entries(js)) {
  // UI.$('x') 与模块内裸 $('x') 都匹配这一条
  const re = /\$\('([^']+)'\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (!usedIds.has(m[1])) usedIds.set(m[1], []);
    usedIds.get(m[1]).push(file);
  }
  const idRe = /\sid="([^"]+)"/g;
  while ((m = idRe.exec(code)) !== null) dynamicIds.add(m[1]);
}

console.log('\n[1] 元素 id 契约');
for (const [id, files] of usedIds) {
  check(
    htmlIds.has(id) || dynamicIds.has(id),
    `UI.$(#${id}) 有声明  ← ${[...new Set(files)].join(', ')}${htmlIds.has(id) ? '' : '（JS 动态生成）'}`
  );
}
// 通过 TABS 数组之类间接引用的 id，静态扫不到，只作为提示不算失败
const INDIRECT = new Set(['tab-make', 'tab-library', 'tab-review', 'panel-make', 'panel-library', 'panel-review']);
const unusedIds = [...htmlIds].filter((id) => !usedIds.has(id) && !INDIRECT.has(id));
if (unusedIds.length) warnings.push(`HTML 中未被 JS 使用的 id：${unusedIds.join(', ')}`);

/* ---------- 2. CSS 类名契约 ---------- */

console.log('\n[2] CSS 类名契约');
const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

// 收集类名来源，两条路径分开处理，避免把模板表达式当成类名
const usedClasses = new Map();
const CLASS_TOKEN = /^[a-z][\w-]*$/;

// 路径 A：静态 class="a b c"（含 ${ 或 ? 的是动态拼接，跳过整个属性）
const scanStaticAttrs = (code, where) => {
  const re = /class="([^"]*)"/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (m[1].includes('${') || m[1].includes('?')) continue;
    for (const token of m[1].split(/\s+/)) {
      if (!CLASS_TOKEN.test(token)) continue;
      if (!usedClasses.has(token)) usedClasses.set(token, where);
    }
  }
};

// 路径 B：JS 里的三元分支类名（如 'field-tag is-gap' : 'field-tag'）。
// 只在「所有 token 都长得像类名，且至少有一个确实是已知类」时才认定为类名串，
// 否则中文文案、普通字符串会被误报。
const scanTernaryClasses = (code, where) => {
  const re = /'([a-z][\w-]*(?: [a-z][\w-]*)*)'/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const tokens = m[1].split(/\s+/);
    if (!tokens.every((t) => CLASS_TOKEN.test(t))) continue;
    if (!tokens.some((t) => cssClasses.has(t))) continue;
    // 'toast toast-' 这类拼接前缀不是类名，跳过以 - 结尾的 token
    for (const t of tokens) {
      if (t.endsWith('-')) continue;
      if (!usedClasses.has(t)) usedClasses.set(t, where);
    }
  }
};

scanStaticAttrs(html, 'index.html');
for (const [file, code] of Object.entries(js)) {
  scanStaticAttrs(code, file);
  scanTernaryClasses(code, file);
}

const missingClasses = [...usedClasses.entries()].filter(([c]) => !cssClasses.has(c));
check(
  missingClasses.length === 0,
  missingClasses.length === 0
    ? `${usedClasses.size} 个类名全部在 styles.css 中有定义`
    : `缺少样式定义：${missingClasses.map(([c, w]) => `${c}（${w}）`).join(', ')}`
);

/* ---------- 3. 模块导出契约（运行时） ---------- */

console.log('\n[3] 模块导出契约');
const CONTRACTS = {
  'card-engine.js': [
    ['generate', 'function'],
    ['segment', 'function'],
    ['qualify', 'function']
  ],
  'store.js': [
    ['listSources', 'function'],
    ['getSource', 'function'],
    ['addSource', 'function'],
    ['removeSource', 'function'],
    ['listCards', 'function'],
    ['getCard', 'function'],
    ['addCards', 'function'],
    ['updateCard', 'function'],
    ['removeCard', 'function'],
    ['setTag', 'function'],
    ['exportAll', 'function'],
    ['importAll', 'function'],
    ['clearAll', 'function'],
    ['stats', 'function'],
    ['persistent', 'function']
  ],
  'scheduler.js': [
    ['init', 'function'],
    ['stateOf', 'function'],
    ['review', 'function'],
    ['isDue', 'function'],
    ['dueQueue', 'function'],
    ['summarize', 'function'],
    ['dueLabel', 'function']
  ],
  'exporters.js': [
    ['toMarkdown', 'function'],
    ['toAnkiCsv', 'function'],
    ['toJson', 'function'],
    ['toObsidian', 'function']
  ]
};

for (const [file, contract] of Object.entries(CONTRACTS)) {
  const mod = require(path.join(SRC, file));
  const bad = contract.filter(([name, kind]) => typeof mod[name] !== kind).map(([n]) => n);
  check(bad.length === 0, `${file} 导出 ${contract.length} 个 API` + (bad.length ? `  缺：${bad.join(', ')}` : ''));
}

// 引擎常量
const Engine = require(path.join(SRC, 'card-engine.js'));
check(Engine.CEILING === 128, `Engine.CEILING = ${Engine.CEILING}`);
check(Engine.LIMITS && Engine.LIMITS.maxSentences === 3, `Engine.LIMITS.maxSentences = ${Engine.LIMITS && Engine.LIMITS.maxSentences}`);

/* ---------- 4. 跨模块调用点拼写 ---------- */

console.log('\n[4] 跨模块调用拼写');
const CALLERS = {
  Store: CONTRACTS['store.js'],
  Scheduler: CONTRACTS['scheduler.js'],
  Exporters: CONTRACTS['exporters.js'],
  Engine: CONTRACTS['card-engine.js']
};
const EXTRAS = { Scheduler: ['DAY', 'GRADES'], Engine: ['CEILING', 'LIMITS'] };

for (const [mod, contract] of Object.entries(CALLERS)) {
  const names = new Set([...contract.map(([n]) => n), ...(EXTRAS[mod] || [])]);
  const used = new Set();
  for (const code of Object.values(js)) {
    const re = new RegExp(`\\b${mod}\\.([A-Za-z_$][\\w$]*)`, 'g');
    let m;
    while ((m = re.exec(code)) !== null) used.add(m[1]);
  }
  // 这些是模块自引用/枚举键，不算调用
  const ignored = new Set(['KEY', 'VERSION', 'prototype']);
  const bad = [...used].filter((n) => !names.has(n) && !ignored.has(n));
  check(bad.length === 0, `${mod}.* 调用点全部存在` + (bad.length ? `  未知：${bad.join(', ')}` : ''));
}

/* ---------- 5. data-action 处理分支 ---------- */

console.log('\n[5] 交互动作契约');
{
  const declared = new Set();
  for (const code of Object.values(js)) {
    const re = /data-action="([a-z-]+)"/g;
    let m;
    while ((m = re.exec(code)) !== null) declared.add(m[1]);
  }
  const handled = new Set();
  for (const code of Object.values(js)) {
    const re = /action === '([a-z-]+)'/g;
    let m;
    while ((m = re.exec(code)) !== null) handled.add(m[1]);
  }
  const orphan = [...declared].filter((a) => !handled.has(a));
  check(orphan.length === 0, `${declared.size} 个 data-action 都有处理分支` + (orphan.length ? `  漏：${orphan.join(', ')}` : ''));
}

/* ---------- 汇总 ---------- */

if (warnings.length) {
  console.log('\n提示（不阻塞）：');
  for (const w of warnings) console.log('  · ' + w);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);