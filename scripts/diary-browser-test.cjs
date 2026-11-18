/* Diary calendar regression checks against the bundled UI and a local Android bridge. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.ADIARYT_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '../app/src/main/assets');
const output = path.resolve(__dirname, '../build/screenshots');
fs.mkdirSync(output, {recursive:true});

(async () => {
  const server = http.createServer((req, res) => {
    const relative = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', {'.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.svg':'image/svg+xml'}[path.extname(file)] || 'text/plain');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'");
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true, args:['--no-sandbox','--disable-dev-shm-usage']});
    const context = await browser.newContext({viewport:{width:360,height:800}, locale:'en-US', timezoneId:'Asia/Tehran'});
    await context.addInitScript(() => {
      const NativeDate = Date;
      const fixed = NativeDate.parse('2026-11-18T09:00:00Z');
      window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
      window.__persisted = null;
      window.ADiaryTNative = {dispatch(raw) {
        const command = JSON.parse(raw);
        if (command.type === 'ready') setTimeout(() => window.App.nativeEvent({type:'bootstrap', payload:{entries:{'2026-11-17':{text:'Yesterday stays unchanged.'}}}}), 0);
        if (command.type === 'persist') window.__persisted = command.payload;
      }};
    });
    const page = await context.newPage();
    const errors = [], external = [];
    const base = 'http://127.0.0.1:' + server.address().port;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (!req.url().startsWith(base)) external.push(req.url()); });
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('#dateTitle').textContent === 'Wednesday, November 18');
    await page.locator('#editor').fill('Today remains editable.');
    await page.waitForFunction(() => window.__persisted?.entries?.['2026-11-18']?.text === 'Today remains editable.');

    await page.locator('#bottomCalendar').click();
    const today = page.locator('[data-date="2026-11-18"]');
    assert.equal(await today.locator('.calendar-gregorian').textContent(), '18');
    assert.equal(await today.locator('.calendar-jalali').textContent(), '27');
    assert.equal(await page.locator('#nextDay').count(), 0);
    const rows = await today.evaluate(cell => {
      const a = cell.querySelector('.calendar-gregorian'), b = cell.querySelector('.calendar-jalali');
      return {separate:a.getBoundingClientRect().bottom <= b.getBoundingClientRect().top, smaller:parseFloat(getComputedStyle(b).fontSize) < parseFloat(getComputedStyle(a).fontSize)};
    });
    assert.deepEqual(rows, {separate:true, smaller:true});
    const tomorrow = page.locator('[data-date="2026-11-19"]');
    assert.equal(await tomorrow.isEnabled(), true);
    await tomorrow.click();
    assert.match(await page.locator('.calendar-preview').textContent(), /November 19, 2026.*28 Aban 1405.*Future date/);
    assert.equal(await page.locator('#dialogBackdrop').isVisible(), true);
    await page.locator('button[aria-label="Next month"]').click();
    assert.equal(await page.locator('.calendar-head strong').textContent(), 'December 2026');
    await page.locator('button[aria-label="Next month"]').click();
    assert.equal(await page.locator('.calendar-head strong').textContent(), 'January 2027');
    await page.locator('[data-date="2027-01-02"]').click();
    assert.match(await page.locator('.calendar-preview').textContent(), /January 2, 2027/);
    assert.equal(await page.locator('.calendar-cell.selected').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(53, 107, 88)', 'Selected date stays readable during hover');
    const screenshot = path.join(output, 'calendar-future-360.png');
    await page.screenshot({path:screenshot});
    assert.equal(await page.locator('.dialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.locator('#dialogClose').click();
    assert.equal(await page.locator('#editor').inputValue(), 'Today remains editable.');
    assert.equal(await page.locator('#editor').evaluate(el => el.readOnly), false);
    await page.evaluate(() => window.App.flushSession());
    assert.equal(await page.evaluate(() => Object.keys(window.__persisted.entries).some(key => key > '2026-11-18')), false);

    await page.locator('#bottomCalendar').click();
    await page.locator('[data-date="2026-11-17"]').click();
    assert.equal(await page.locator('#editor').inputValue(), 'Yesterday stays unchanged.');
    assert.equal(await page.locator('#editor').evaluate(el => el.readOnly), true);
    await page.locator('#bottomToday').click();
    assert.equal(await page.locator('#editor').inputValue(), 'Today remains editable.');
    await page.locator('#bottomCalendar').click();
    await page.locator('button[aria-label="Next month"]').click();
    await page.locator('button[aria-label="Previous month"]').click();
    assert.equal(await page.locator('.calendar-head strong').textContent(), 'November 2026');
    await page.setViewportSize({width:800,height:600});
    await page.screenshot({path:path.join(output,'calendar-future-800.png')});
    assert.deepEqual(errors, [], 'No runtime JavaScript errors');
    assert.deepEqual(external, [], 'No requests outside bundled local assets');
    console.log('Diary browser checks passed: future previews/months/year rollover, two-row dates, no future entries, today editing, past locks, responsive layout, and offline requests.');
    console.log('Screenshots: ' + output);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
