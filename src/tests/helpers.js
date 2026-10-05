'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const PAGE = pathToFileURL(path.join(__dirname, '..', 'kassa.html')).href;

let browser = null;

async function start() {
  if (browser) return browser;
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  browser = await chromium.launch(executablePath ? { executablePath } : {});
  return browser;
}

async function stop() {
  if (browser) await browser.close();
  browser = null;
}

/**
 * Новая касса в чистом браузере.
 *
 * `seed` кладёт данные в localStorage до запуска страницы (проверка переноса
 * старых данных); `desk` подменяет мостик программы на компьютере.
 */
async function open({ role = 'cashier', seed = null, desk = null } = {}) {
  const context = await (await start()).newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  // Service worker на file:// не регистрируется — это не ошибка кассы.
  page.on('pageerror', (e) => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });

  if (seed) {
    await page.addInitScript((value) => {
      if (!localStorage.getItem('demo-phones-v3')) localStorage.setItem('demo-phones-v3', JSON.stringify(value));
    }, seed);
  }
  if (desk) {
    await page.addInitScript((initial) => {
      window.__saved = []; window.__backups = 0;
      window.kassa = {
        load: () => initial,
        save: (d) => { window.__saved.push(JSON.parse(JSON.stringify(d))); return true; },
        where: () => 'C:\\Касса\\касса.json',
        reveal: () => true, backup: () => { window.__backups += 1; return 'копия.json'; }, saveFile: () => 'x',
        autoGet: () => false, autoSet: () => false,
      };
    }, desk.initial ?? null);
  }

  await page.goto(`${PAGE}?role=${role}`);
  const k = {
    page, context, errors,
    flash: async () => (await page.locator('#flash').innerText()).trim(),
    text: async () => page.locator('#screen').innerText(),
    scan: (code) => page.evaluate((c) => onScan(c), code),
    state: (fn, arg) => page.evaluate(fn, arg),
    pickName: async (id = 's1') => {
      await page.click(`[data-who="${id}"]`);
      // Продавать можно только в открытой смене.
      if (await page.locator('#shift-open').count()) await page.click('#shift-open');
    },
    openShift: () => page.evaluate(() => { data.shiftOpen = { at: Date.now(), by: sellerName() ?? 'Владелец', byId: 'owner' }; render(); }),
    close: () => context.close(),
  };
  return k;
}

module.exports = { open, stop, PAGE };
