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

const GLASS = '4870001234615';    // g6, один код на все штуки, остаток 40
const IPHONE = '4870001234561';   // g1, штучный, остаток 3

/* ------------------------------------------------ приёмка у кассира */

kassa('у кассира есть вкладка «Приём»', async (k) => {
  await k.page.click('[data-who="s1"]');
  assert.equal(await k.page.locator('[data-tab="intake"]').count(), 1);
  await k.page.click('[data-tab="intake"]');
  assert.match(await k.text(), /Приём товара/);
});

kassa('кассир принимает коробку: код прибавляется, остаток растёт', async (k) => {
  await k.pickName();
  await k.page.click('[data-tab="intake"]');
  await k.scan('CASHIER-BOX-1');
  assert.equal(await k.state(() => sheet.k), 'newcode');
  const text = await k.page.locator('.sheet').innerText();
  assert.doesNotMatch(text, /закуп/i, 'закупка кассиру не видна');
  await k.page.click('[data-attach="g1"]');
  assert.equal(await k.state(() => good('g1').stock), 4);
  assert.ok(await k.state(() => good('g1').codes.includes('CASHIER-BOX-1')));
});

kassa('кассир видит список остатка без закупки и наценки', async (k) => {
  await k.pickName();
  await k.page.click('[data-tab="intake"]');
  const t = await k.text();
  assert.match(t, /Что на остатке/);
  assert.doesNotMatch(t, /закуп/i);
  assert.doesNotMatch(t, /наценка/i);
});

kassa('кассир принимает штуки известного товара: только количество, цены не трогаются', async (k) => {
  await k.pickName();
  await k.page.click('[data-tab="intake"]');
  await k.scan(GLASS);
  assert.equal(await k.state(() => sheet.k), 'take');
  assert.equal(await k.page.locator('#tk-qty').count(), 1);
  assert.equal(await k.page.locator('#tk-cost, #tk-price, #tk-markup').count(), 0);
  await k.page.fill('#tk-qty', '10');
  await k.page.click('[data-tksave="g6"]');
  assert.equal(await k.state(() => good('g6').stock), 50);
  assert.equal(await k.state(() => good('g6').cost), 90);
  assert.equal(await k.state(() => good('g6').price), 300);
});

kassa('кассир не может править цены, остаток и убирать товар', async (k) => {
  await k.pickName();
  await k.page.click('[data-tab="intake"]');
  await k.page.click('[data-edit="g6"]');
  assert.equal(await k.page.locator('#ed-cost, #ed-price, #ed-stock').count(), 0);
  assert.equal(await k.page.locator('[data-eddel]').count(), 0);
  await k.page.fill('#ed-name', 'Стекло 9H');
  await k.page.click('[data-edsave="g6"]');
  const g = await k.state(() => good('g6'));
  assert.equal(g.name, 'Стекло 9H');
  assert.deepEqual([g.cost, g.price, g.stock], [90, 300, 40]);
  // и в обход кнопки — тоже
  await k.state(() => document.body.insertAdjacentHTML('beforeend', '<button data-eddel="g6" id="x"></button>'));
  await k.page.click('#x');
  assert.ok(await k.state(() => !!good('g6')));
});

kassa('кассир заводит новую модель: цена закупа нужна, штука одна', async (k) => {
  await k.pickName();
  await k.page.click('[data-tab="intake"]');
  await k.scan('CASHIER-NEW-1');
  await k.page.click('#ng-open');
  assert.equal(await k.page.locator('#ng-qty').count(), 0);
  assert.equal(await k.page.locator('[data-ngserial]').count(), 0);
  await k.page.fill('#ng-model', 'Redmi 14');
  await k.page.click('[data-ngset="mem"][data-ngval="128 ГБ"]');
  await k.page.fill('#ng-cost', '9000');
  await k.page.fill('#ng-price', '11500');
  await k.page.click('#ng-save');
  assert.equal(await k.state(() => data.goods.at(-1).stock), 1);
});

kassa('принятую кассиром коробку можно продать, повторно принять нельзя', async (k) => {
  await k.pickName();
  await k.page.click('[data-tab="intake"]');
  await k.scan('CASHIER-BOX-2');
  await k.page.click('[data-attach="g1"]');
  await k.scan('CASHIER-BOX-2');
  assert.match(await k.flash(), /уже принята/);
  assert.equal(await k.state(() => good('g1').stock), 4);
  await k.page.click('[data-tab="sale"]');
  await k.scan('CASHIER-BOX-2');
  assert.equal(await k.state(() => check[0].codes[0]), 'CASHIER-BOX-2');
});

/* ------------------------------------------------- предел скидки */

const discount = async (k, value) => {
  await k.page.click('[data-off="g6"]');
  await k.page.fill('#off-value', String(value));
  await k.page.click('[data-offsave="g6"]');
};

kassa('предел включён по умолчанию: кассир не скинет больше', async (k) => {
  assert.equal(await k.state(() => data.limitOn), true);
  await k.pickName();
  for (let i = 0; i < 3; i += 1) await k.scan(GLASS);  // 3 × 300 = 900
  await k.page.click('[data-off="g6"]');
  assert.match(await k.page.locator('.sheet').innerText(), /Ваш предел/);
  await k.page.fill('#off-value', '600');
  await k.page.click('[data-offsave="g6"]');
  assert.equal(await k.state(() => check[0].off), 600);  // 3 шт × 500 = 1500 на позицию, 600 в пределе
});

kassa('предел включён: больше лимита на позицию отклоняется', async (k) => {
  await k.state(() => { data.limit = 50; });
  await k.pickName();
  await k.scan(GLASS);
  await discount(k, 100);
  assert.match(await k.flash(), /Ваш предел/);
  assert.equal(await k.state(() => check[0].off), 0);
});

kassa('предел выключен: кассир скидывает любую сумму, но не выше цены', async (k) => {
  await k.state(() => { data.limit = 50; data.limitOn = false; });
  await k.pickName();
  await k.scan(GLASS);
  await k.page.click('[data-off="g6"]');
  assert.match(await k.page.locator('.sheet').innerText(), /без предела/);
  await k.page.fill('#off-value', '250');
  await k.page.click('[data-offsave="g6"]');
  assert.equal(await k.state(() => check[0].off), 250);
  await discount(k, 9999);
  assert.match(await k.flash(), /Больше 300/);
  assert.equal(await k.state(() => check[0].off), 250);
});

kassa('предел выключен: скидка на весь чек тоже без предела', async (k) => {
  await k.state(() => { data.limit = 10; data.limitOn = false; });
  await k.pickName();
  await k.scan(GLASS);
  await k.page.click('#whole-off');
  await k.page.fill('#whole-value', '200');
  await k.page.click('#whole-save');
  assert.equal(await k.state(() => checkOff), 200);
});

kassa('владелец включает и выключает предел кнопкой', { role: 'owner' }, async (k) => {
  await k.page.click('[data-tab="more"]');
  assert.equal(await k.page.locator('#limit').count(), 1);
  await k.page.click('#limit-toggle');
  assert.equal(await k.state(() => data.limitOn), false);
  assert.match(await k.flash(), /выключен/);
  assert.equal(await k.page.locator('#limit').count(), 0, 'поле суммы скрыто');
  await k.page.click('#limit-toggle');
  assert.equal(await k.state(() => data.limitOn), true);
  assert.equal(await k.page.locator('#limit').count(), 1);
});

kassa('кассир в «Ещё» видит, действует ли предел', async (k) => {
  await k.page.click('[data-who="s1"]');
  await k.page.click('[data-tab="more"]');
  assert.match(await k.text(), /Скинуть можно до/);
  await k.state(() => { data.limitOn = false; render(); });
  assert.match(await k.text(), /Скидку можно давать любую/);
});

kassa('старые данные без переключателя: предел остаётся включённым', {
  seed: { role: 'cashier', goods: [], checks: [], accounts: { owner: '', cashier: '' }, notes: [], limit: 300 },
}, async (k) => {
  assert.equal(await k.state(() => data.limitOn), true);
  assert.equal(await k.state(() => data.limit), 300);
});

/* ----------------------------------------- кто сколько продал */

const sales = (k) => k.state((d) => {
  const now = Date.now();
  const day = 86400e3;
  const mk = (id, ago, by, total, qty) => ({ id, at: now - ago, by, total, cost: total / 2, off: 0,
    lines: [{ name: 'Товар', price: total / qty, qty, off: 0 }] });
  data.checks = [
    mk('a', 1000, 'Айгерим', 1000, 2),          // сегодня
    mk('b', 2000, 'Нурбек', 500, 1),            // сегодня
    mk('c', 3 * day, 'Нурбек', 300, 3),         // за 7 дней
    mk('d', 20 * day, 'Айгерим', 200, 1),       // за 30 дней
    mk('e', 100 * day, 'Нурбек', 100, 1),       // давно
  ];
  data.shiftStart = now - 5000;                  // смена — только a и b
}, null);

kassa('«Кто сколько продал»: смена и другие сроки', { role: 'owner' }, async (k) => {
  await sales(k);
  await k.page.click('[data-tab="report"]');
  const rows = async () => (await k.page.locator('#screen .rows').filter({ hasText: /шт/ }).first().innerText());
  const t = await k.text();
  assert.match(t, /Кто сколько продал/);
  assert.match(t, /Смена[\s\S]*Сегодня[\s\S]*7 дней[\s\S]*30 дней[\s\S]*Всё время/);
  // смена: Айгерим 1000 (2 шт), Нурбек 500 (1 шт)
  assert.match(await rows(), /Айгерим\s+1 чек, 2 шт[\s\S]*Нурбек\s+1 чек, 1 шт/);

  const sum = async (period) => {
    await k.page.click(`[data-period="${period}"]`);
    return k.state(() => periodChecks(repPeriod).reduce((s, c) => s + c.total, 0));
  };
  assert.equal(await sum('today'), 1500);
  assert.equal(await sum('7'), 1800);
  assert.equal(await sum('30'), 2000);
  assert.equal(await sum('all'), 2100);
  assert.equal(await k.page.getAttribute('[data-period="all"]', 'aria-pressed'), 'true');
});

kassa('«Кто сколько продал»: по каждому штуки, чеки и порядок по выручке', { role: 'owner' }, async (k) => {
  await sales(k);
  await k.page.click('[data-tab="report"]');
  await k.page.click('[data-period="all"]');
  const t = await k.text();
  // Нурбек: 500+300+100 = 900, 3 чека, 5 шт; Айгерим: 1000+200 = 1200, 2 чека, 3 шт
  assert.match(t, /Айгерим\s+2 чека, 3 шт[\s\S]*1\s?200 с[\s\S]*Нурбек\s+3 чека, 5 шт[\s\S]*900 с/);
});

kassa('владелец видит прибыль по кассирам, пустой срок — пояснение', { role: 'owner' }, async (k) => {
  await sales(k);
  await k.page.click('[data-tab="report"]');
  assert.match(await k.page.locator('#screen').innerText(), /500 с/, 'прибыль Айгерим за смену (1000 − 500)');
  await k.state(() => { data.checks = []; render(); });
  assert.match(await k.text(), /За этот срок продаж не было/);
});
