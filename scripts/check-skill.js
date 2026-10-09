/**
 * check-skill.js — Skill 结构自检
 *
 * 校验 SKILL.md 的 frontmatter 与目录结构，避免发布一个装不上的 Skill。
 * 运行：node scripts/check-skill.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'make-knowledge-cards');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');

let fail = 0;

function check(cond, msg) {
  if (cond) {
    console.log(`  PASS  ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL  ${msg}`);
  }
}

console.log('Skill 结构自检 — make-knowledge-cards');

check(fs.existsSync(SKILL_MD), 'SKILL.md 存在');

const text = fs.existsSync(SKILL_MD) ? fs.readFileSync(SKILL_MD, 'utf8') : '';
const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);

check(!!fm, 'frontmatter 完整（--- 包裹）');

const meta = fm ? fm[1] : '';
const nameLine = (meta.match(/^name:.*$/m) || [''])[0];
const descLine = (meta.match(/^description:.*$/m) || [''])[0];

check(/^name:\s*make-knowledge-cards\s*$/m.test(meta), 'name 字段为 make-knowledge-cards');
check(descLine.length > 60, `description 字段足够描述触发场景（${descLine.length} 字符）`);
check(/^name:[\x20-\x7e]+$/.test(nameLine), 'name 只用 ASCII（小写字母与连字符）');

check(fs.existsSync(path.join(SKILL_DIR, 'agents', 'openai.yaml')), 'agents/openai.yaml 存在');

const body = fm ? text.slice(fm[0].length) : text;
for (const step of ['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'Step 6']) {
  check(body.includes(step), `工作流包含 ${step}`);
}
check(body.includes('128'), '写明 128 张上限');
check(body.includes('Anti-Fabrication Rules'), '包含 Anti-Fabrication Rules 章节');

console.log(fail === 0 ? '\n结果：全部通过' : `\n结果：${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);