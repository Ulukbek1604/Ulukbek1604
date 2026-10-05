'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { open, stop } = require('./helpers.js');

test.after(stop);

const kassa = (name, opts, fn) => {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  test(name, async () => {
    const k = await open(opts);
    try { await fn(k); assert.deepEqual(k.errors, [], 'ошибки на странице'); }
    finally { await k.close(); }
  });
};

const IPHONE = '4870001234561';
const GLASS = '4870001234615';

/* --------------------------------------------------- номера чеков */

kassa('чеки нумеруются по порядку, возврат получает следующий номер', async (k) => {
  await k.state(() => { data.checks = []; });
  await k.pickName();
  await k.scan(GLASS); await k.page.click('#sell >> nth=0');
  assert.match(await k.page.locator('.sheetpaper').innerText(), /Товарный чек № 1\b/);
  await k.state(() => { sheet = null; render(); });
  await k.scan(GLASS); await k.page.click('#sell >> nth=0');
  assert.match(await k.page.locator('.sheetpaper').innerText(), /Товарный чек № 2\b/);
  await k.page.click('#ret-open');
  await k.page.click('[data-retmore="0"]');
  await k.page.click('#ret-confirm');
  assert.match(await k.page.locator('.sheetpaper').innerText(), /Возврат № 3 по чеку № 2/);
  assert.deepEqual(await k.state(() => data.checks.map((c) => c.no)), [1, 2, 3]);
});

kassa('старым чекам без номера номера выдаются по времени и продолжаются', {
  seed: {
    role: 'cashier', goods: [], notes: [], accounts: { owner: '', cashier: '' },
    checks: [
      { id: 'c3', at: 3000, by: 'Н', total: 3, cost: 0, off: 0, lines: [] },
      { id: 'c1', at: 1000, by: 'Н', total: 1, cost: 0, off: 0, lines: [] },
      { id: 'c2', at: 2000, by: 'Н', total: 2, cost: 0, off: 0, lines: [] },
    ],
  },
}, async (k) => {
  const nums = await k.state(() => Object.fromEntries(data.checks.filter((c) => ['c1', 'c2', 'c3'].includes(c.id)).map((c) => [c.id, c.no])));
  assert.deepEqual(nums, { c1: 1, c2: 2, c3: 3 });
  assert.ok(await k.state(() => nextNo() > 3));
});

kassa('поиск находит чек по короткому номеру', async (k) => {
  await k.state(() => { data.checks = []; });
  await k.pickName();
  await k.scan(IPHONE); await k.page.click('#sell >> nth=0');
  await k.state(() => { sheet = null; render(); });
  await k.scan(GLASS); await k.page.click('#sell >> nth=0');
  await k.state(() => { sheet = null; tab = 'checks'; render(); });
  await k.page.fill('#chk-q', '1');
  const t = await k.text();
  assert.match(t, /iPhone 13/);
});

/* ---------------------------------------------------------- чек */

kassa('на чеке IMEI только у телефона, общий штрих-код чехла не печатается', async (k) => {
  await k.pickName();
  await k.scan(IPHONE); await k.scan(GLASS);
  await k.page.click('#sell >> nth=0');
  const t = await k.page.locator('.sheetpaper').innerText();
  assert.match(t, new RegExp(`IMEI: ${IPHONE}`));
  assert.ok(!t.includes(GLASS), 'код стекла на чеке не нужен');
  assert.doesNotMatch(t, /коробка/);
});

/* ------------------------------------------------- «+» в строке чека */

kassa('«+» есть у товара без IMEI и добавляет до остатка', async (k) => {
  await k.pickName();
  await k.scan(GLASS);
  await k.state(() => { good('g6').stock = 3; render(); });
  await k.page.click('[data-more="g6"]');
  await k.page.click('[data-more="g6"]');
  assert.equal(await k.state(() => check[0].qty), 3);
  await k.page.click('[data-more="g6"]');
  assert.equal(await k.state(() => check[0].qty), 3);
  assert.match(await k.flash(), /на остатке 3 шт/);
});

kassa('у телефона «+» нет: следующую трубку пикают ради IMEI', async (k) => {
  await k.pickName();
  await k.scan(IPHONE);
  assert.equal(await k.page.locator('[data-more="g1"]').count(), 0);
  assert.equal(await k.page.locator('[data-less="g1"]').count(), 1);
});

/* -------------------------------------------------------- экраны */

kassa('выбор кассира: крупные плитки с буквой имени', async (k) => {
  await k.state(() => { data.staff.push({ id: 's2', name: 'айгерим' }); render(); });
  const tiles = await k.page.locator('.staff').allInnerTexts();
  assert.deepEqual(tiles.map((t) => t.replace(/\s+/g, ' ').trim()), ['Н Нурбек', 'А айгерим']);
  const box = await k.page.locator('.staff').first().boundingBox();
  assert.ok(box.height >= 100, 'плитка крупная, по ней легко попасть');
  // шапка не задета стилями плиток
  const head = await k.page.locator('#who').boundingBox();
  assert.ok(head.height < 50);
});

kassa('«сменить» — отдельная кнопка рядом с именем', async (k) => {
  await k.pickName();
  assert.equal(await k.page.locator('#who-change.linkbtn').count(), 1);
});

kassa('ссылки скидок окрашены цветом скидки, а не текста', async (k) => {
  await k.pickName();
  await k.scan(GLASS);
  const [link, cut, ink] = await k.state(() => {
    const css = (el) => getComputedStyle(el).color;
    const probe = document.createElement('span');
    probe.style.color = 'var(--cut)'; document.body.append(probe);
    const ink = document.createElement('span');
    ink.style.color = 'var(--ink)'; document.body.append(ink);
    return [css(document.querySelector('[data-off="g6"]')), css(probe), css(ink)];
  });
  assert.equal(link, cut);
  assert.notEqual(link, ink);
});

kassa('у владельца закрытие смены сразу под цифрами смены', { role: 'owner' }, async (k) => {
  await k.page.click('[data-tab="report"]');
  const t = await k.text();
  assert.ok(t.indexOf('Закрытие смены') < t.indexOf('Кто сколько продал'));
  assert.ok(t.indexOf('Закрытие смены') < t.indexOf('Как идёт торговля'));
});
