/**
 * check-version.js — 版本号一致性校验
 *
 * 版本号分散在三处，历史上已经漂移过一次：
 * crate 版本停在 0.1.3，而 exe 产物已按 0.1.4 命名。
 * 这里把 package.json 定为唯一源，另外两处对不上就直接失败。
 *
 * 运行：npm run check:version
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
console.log(`唯一源 package.json 版本：${version}\n`);

const targets = [
  { file: 'src-tauri/Cargo.toml', re: /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m, name: 'Cargo package' },
  { file: 'src-tauri/tauri.conf.json', re: /"version"\s*:\s*"([^"]+)"/, name: 'tauri.conf.json' }
];

let fail = 0;
for (const t of targets) {
  const m = read(t.file).match(t.re);
  const found = m ? m[1] : '(未找到)';
  const ok = found === version;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t.name.padEnd(20)} ${found}${ok ? '' : `  ← 应为 ${version}`}`);
}

// Release 附件命名依赖版本号，这里顺手确认脚本不会写出旧版本号
const buildScript = read('scripts/build-exe.sh');
const usesPkgVersion = /require\('\.\/package\.json'\)\.version/.test(buildScript);
console.log(`  ${usesPkgVersion ? 'PASS' : 'FAIL'}  build-exe.sh 从 package.json 读取版本号用于产物命名`);
if (!usesPkgVersion) fail++;

console.log(`\n结果：${fail === 0 ? '版本号一致' : `${fail} 处不一致`}`);
process.exit(fail === 0 ? 0 : 1);