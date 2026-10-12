/**
 * test-exporters.js — 导出格式测试
 *
 * 导出是本项目唯一会「静默产出错误文件」的地方：
 * CSV 里一个没转义的引号会让 Anki 把一张卡拆成三张；
 * Markdown 里一个没转义的换行会让字段结构塌掉。
 * 这类问题不会报错，只会在用户那边显形——所以必须在这里钉死。
 *
 * 运行：npm run test:exporters
 */

const path = require('path');
const Exporters = require(path.join(__dirname, '..', 'src', 'exporters.js'));

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

const cards = [
  {
    index: 1,
    title: '折叠屏出货量三连降',
    section: '一、市场数据',
    core: '2025 年全球折叠屏手机出货量为 1420 万台，同比下降 8%。',
    plain: '原文给出「8%」这一数值，但没有说明它的来源与统计口径，本卡不代为补足。',
    plainSource: '原文未提供',
    plainGap: true,
    caveat: '本文为虚构测试样本，全部数据均为编造。',
    exampleLabel: '例子 / Example',
    example: '原文出现的数值：1420 万、8%。直接取自原文，未做外推。',
    tags: ['折叠屏', '市场'],
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
  {
    index: 2,
    title: '含"引号"与\ttab 的标题',
    section: '一、市场数据',
    core: '第一行\n第二行',
    plain: '解释含「嵌套」的引号',
    plainSource: '原文因果句',
    plainGap: false,
    caveat: '',
    exampleLabel: '自测题 / Self-test',
    example: '问：为什么？\n答案：因为原文这么说。',
    tags: [],
    status: 'review',
    due: 1750000000000,
    interval: 6,
    ease: 2.5,
    reps: 2,
    lapses: 0,
    streak: 2,
    lastReview: 1749000000000,
    reviewCount: 2
  }
];

const meta = {
  sourceName: '折叠屏.md',
  stats: { sections: 6, candidates: 31, qualified: 22, rejected: 9, merged: 0, plainGaps: 1 },
  disclaimers: ['本文为虚构测试样本。']
};

console.log('='.repeat(64));
console.log('导出格式测试');
console.log('='.repeat(64));

/**
 * 极简 Anki CSV 解析器：跳过 # 文件头，按引号规则切记录与字段。
 * 之所以自己写而不按行统计——卡片正文里有换行，按行数会把一条记录算成多条。
 */
function parseAnkiCsv(text) {
  const lines = text.split('\n');
  let start = 0;
  while (start < lines.length && (lines[start].startsWith('#') || lines[start] === '')) start++;
  const body = lines.slice(start).join('\n');

  const records = [];
  let rec = [];
  let field = '';
  let inQuotes = false;
  let started = false;
  const endField = () => {
    rec.push(field);
    field = '';
    started = true;
  };
  const endRecord = () => {
    endField();
    records.push(rec);
    rec = [];
    started = false;
  };

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inQuotes) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === '\t') endField();
    else if (c === '\n') {
      // 引号外的换行才是记录分隔符；引号内的换行属于字段内容
      if (started || field !== '') endRecord();
    } else field += c;
  }
  if (started || field !== '') endRecord();
  return records;
}

/* ---------- Markdown ---------- */
console.log('\n[Markdown]');
{
  const md = Exporters.toMarkdown(cards, meta);
  check(md.includes('### 卡片 1 / Card 1. 折叠屏出货量三连降'), '卡片标题行格式正确');
  check(md.includes('**核心知识 / Core knowledge**'), '含核心知识字段');
  check(md.includes('_解释来源：原文未提供_'), '解释来源行存在');
  check(md.includes('**口径提示 / Caveat**'), '口径提示被保留');
  check(md.includes('**卡片数 / Cards**: 2'), 'footer 卡片数正确');
  check(md.includes('**来源声明 / Source disclaimer**: 本文为虚构测试样本。'), 'footer 带原文声明');
  check(md.includes('**解释缺口 / Gaps**: 1 张'), 'footer 记账解释缺口');
  check(md.split('### 卡片').length - 1 === 2, '恰好两张卡，没有多切');
  check(!md.includes('undefined'), '无 undefined 残留');
  check(!md.includes('[object'), '无 [object 残留');
}

/* ---------- Anki CSV ---------- */
console.log('\n[Anki CSV]');
{
  const csv = Exporters.toAnkiCsv(cards, { deck: '测试' });
  const lines = csv.split('\n');

  check(lines[0] === '#separator:tab', '首行是 Anki 文件头');
  check(lines.includes('#tags column:1'), '声明 tags 为第一列');
  check(csv.includes('#deck:测试'), '牌组名写入文件头');

  // 卡片正文含换行，不能按行数统计记录——必须用真正的 CSV 解析
  const records = parseAnkiCsv(csv);
  check(records.length === 2, `两条记录（实际 ${records.length}）`);
  check(
    records.every((r) => r.length === 3),
    `每条记录 3 列（实际列数 ${records.map((r) => r.length).join('/')}）`
  );
  check(records[0][0] === '折叠屏 市场', `tags 列用空格分隔（实际 "${records[0][0]}"）`);
  check(records[1][1].includes('第一行') && records[1][1].includes('第二行'), '换行字段完整落在同一格');
  check(records[1][2].includes('问：为什么？'), '背面字段未被换行拆散');

  check(Exporters.csvField('含"引号"') === '"含""引号"""', '双引号被翻倍转义');
  check(Exporters.csvField('a\tb') === '"a\tb"', 'tab 被引号包裹');
  check(Exporters.csvField('plain') === 'plain', '普通字段不加引号');

  check(Exporters.ankiFront(cards[0]).includes('解释：'), '正面含核心知识与解释');
  check(!Exporters.ankiFront(cards[0]).includes('口径提示'), '口径提示不进正面');
  check(Exporters.ankiBack(cards[0]).includes('口径提示：'), '口径提示进背面');
  check(Exporters.ankiBack(cards[0]).includes('来源小节：'), '背面带来源小节');
}

/* ---------- JSON ---------- */
console.log('\n[JSON]');
{
  const json = Exporters.toJson(cards, meta);
  const data = JSON.parse(json);
  check(data.cards.length === 2, '两张卡');
  check(data.generator === 'article-to-knowledge-cards', '带生成器标识');
  check(data.cards[0].plainGap === true, '保留 plainGap 标记');
  check(data.cards[0].caveat.length > 0, '保留口径提示');
  check(data.cards[1].schedule.interval === 6, '保留调度状态');
  check(typeof data.cards[0].tags !== 'undefined', '保留标签字段');
  check(json.includes('折叠屏'), '中文未被转义成\\u 序列（便于人工查看备份）');
}

/* ---------- Obsidian ---------- */
console.log('\n[Obsidian]');
{
  const md = Exporters.toObsidian(cards, { sourceName: '折叠屏.md', tags: ['市场'] });
  check(md.startsWith('---'), '以 frontmatter 开头');
  check(md.includes('来源: 折叠屏.md'), 'frontmatter 记录来源');
  check(md.includes('卡片数: 2'), 'frontmatter 记录卡片数');
  check(md.includes('#市场'), '标签写成 Obsidian 内链形式');
  check(md.includes('[[折叠屏]]'), '指向来源的双链');
  check(md.includes('> [!warning] 口径提示'), '口径提示用 callout 呈现');
  check(md.includes('## 折叠屏出货量三连降'), '每张卡一个二级标题');
}

console.log('\n' + '='.repeat(64));
console.log(`结果：${pass} 通过，${fail} 失败`);
console.log('='.repeat(64));

process.exit(fail === 0 ? 0 : 1);