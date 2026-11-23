const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const server = require('../../scripts/serve.js');

async function main() {
  let browser;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : { channel: 'msedge' });
    const context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(origin);
    await page.setInputFiles('#file-input', {
      name: 'notes.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('The cache expires after 250 milliseconds.')
    });
    await page.waitForFunction(() => document.querySelector('#source').value.includes('250 milliseconds'));
    await page.click('#btn-prompt');
    const prompt = await page.evaluate(() => navigator.clipboard.readText());

    assert.match(prompt, /来源文件：notes\.md/);
    assert.match(prompt, /250 milliseconds/);
    assert.doesNotMatch(prompt, /请先完整读取该文件/);
    assert.deepEqual(errors, []);
    console.log('PASS: file-backed prompt includes the loaded source text');
  } finally {
    try { await browser?.close(); } finally { server.close(); }
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
