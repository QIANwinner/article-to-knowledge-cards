const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const server = require('../../scripts/serve.js');

// Hold the origin lock until both clicks have been delivered. In particular, the
// second grade must target the same card, not the next one after a fast refresh.
async function concurrentClicks(tabs, selector) {
  const [owner] = tabs;
  await owner.evaluate(() => new Promise((ready, reject) => {
    navigator.locks.request(Store.KEY, () => new Promise((release) => {
      window.releaseTestLock = release;
      ready();
    })).catch(reject);
  }));
  try {
    await Promise.all(tabs.map((p) => p.click(selector)));
  } finally {
    await owner.evaluate(() => window.releaseTestLock());
  }
}

async function main() {
  let browser;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    browser = await chromium.launch(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : { channel: 'msedge' });
    const context = await browser.newContext();
    context.setDefaultTimeout(10000);
    const tabs = [await context.newPage(), await context.newPage()];
    const [a, b] = tabs;
    const errors = [];
    await Promise.all(tabs.map(async (p, i) => {
      p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`http://127.0.0.1:${server.address().port}`);
      await p.fill('#source', `The archive requires approval for report number ${i + 1}.`);
      await p.click('#btn-generate');
      await p.waitForSelector('#btn-save:enabled');
    }));
    await concurrentClicks(tabs, '#btn-save');
    await Promise.all(tabs.map((p) => p.waitForFunction(() => document.querySelector('#badge-library').textContent === '2')));

    const id = await a.evaluate(() => Store.listCards()[0].id);
    const edit = `[data-action="edit"][data-id="${id}"]`;
    await Promise.all(tabs.map(async (p) => { await p.click('#tab-library'); await p.click(edit); }));
    await b.fill('[data-f="tags"]', 'keep-draft');
    await a.fill('[data-f="title"]', 'Revised title');
    await a.click('[data-action="save-edit"]');
    await b.waitForFunction((id) => Store.getCard(id).title === 'Revised title', id);
    assert.equal(await b.inputValue('[data-f="tags"]'), 'keep-draft');
    await b.click('[data-action="save-edit"]');
    await a.waitForFunction((id) => Store.getCard(id).tags.includes('keep-draft'), id);

    await Promise.all(tabs.map((p) => p.click(edit)));
    await b.fill('[data-f="title"]', 'Uncommitted draft');
    await a.fill('[data-f="title"]', 'Published edit');
    await a.click('[data-action="save-edit"]');
    await b.waitForFunction((id) => Store.getCard(id).title === 'Published edit', id);
    await b.click('[data-action="save-edit"]');
    await b.waitForSelector('#toast-slot.toast-err');
    assert.equal(await b.inputValue('[data-f="title"]'), 'Uncommitted draft');

    await Promise.all(tabs.map(async (p) => { await p.click('#tab-review'); await p.click('#btn-reveal'); }));
    await concurrentClicks(tabs, '[data-grade="good"]');
    await Promise.all(tabs.map((p) => p.waitForFunction(() => document.querySelector('#badge-due').textContent === '1')));
    await a.reload();
    const saved = await a.evaluate(() => ({ cards: Store.listCards(), sources: Store.listSources().length }));
    assert.equal(saved.sources, 2);
    assert.equal(saved.cards.length, 2);
    assert.equal(saved.cards.reduce((n, c) => n + c.reviewCount, 0), 1);
    const edited = saved.cards.find((c) => c.id === id);
    assert.equal(edited.title, 'Published edit');
    assert.deepEqual(edited.tags, ['keep-draft']);

    await Promise.all(tabs.map((p) => p.click('#tab-library')));
    const mark = `[data-action="master"][data-id="${id}"]`;
    await concurrentClicks(tabs, mark);
    await Promise.all(tabs.map((p) => p.waitForSelector(`${mark}[data-mastered="false"]`)));
    await a.reload();
    assert.equal(await a.evaluate((id) => Store.getCard(id).status, id), 'mastered');
    assert.deepEqual(errors, []);
    console.log('PASS: concurrent saves, live updates, field conflicts and concurrent review survive reload');
  } finally {
    try { await browser?.close(); } finally { server.close(); }
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
