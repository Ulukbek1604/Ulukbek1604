'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { open, stop } = require('./helpers.js');

test.after(stop);

const kassa = (name, opts, fn) => {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  test(name, async () => {
    const k = await open(opts);
    // Витринная история продаж браузерной версии мешает считать точно.
    await k.state(() => { data.checks = []; render(); });
    try { await fn(k); assert.deepEqual(k.errors, [], 'ошибки на странице'); }
    finally { await k.close(); }
  });
};

const IPHONE = '4870001234561';   // 67 000, закуп 58 000, штучный
const GLASS = '4870001234615';    // 300, закуп 90

/** Чек напрямую в данные: быстро и без привязки к интерфейсу продажи. */
const addCheck = (k, c) => k.state((x) => {
  data.checks.push({ id: 'c' + Math.random().toString(36).slice(2), at: Date.now() - 1000, cost: 0, off: 0, lines: [], ...x });
}, c);

const closeAs = async (k) => {
  await k.page.click('[data-tab="checks"], [data-tab="report"]');
  await k.page.click('#shift-close');
  await k.page.click('#shift-confirm');
};

/* ------------------------------------------------------- закрытие */

kassa('кассир продал и закрыл смену: итог, запись и сброс счёта', async (k) => {
  await k.pickName();
  await k.scan(IPHONE); await k.scan(GLASS); await k.scan(GLASS);
  await k.page.click('#sell >> nth=0');
  await k.state(() => { sheet = null; render(); });

  await closeAs(k);
  const r = await k.state(() => data.shifts[0]);
  assert.equal(r.revenue, 67600);
  assert.equal(r.cost, 58180);
  assert.equal(r.profit, 9420);
  assert.equal(r.checks, 1);
  assert.equal(r.units, 3);
  assert.equal(r.by, 'Нурбек');
  assert.deepEqual(r.byWho, [{ name: 'Нурбек', n: 1, sum: 67600, ret: 0 }]);
  assert.deepEqual(r.items.map((i) => [i.name, i.qty]), [['Стекло защитное', 2], ['iPhone 13 128 ГБ', 1]]);
  assert.ok(r.to >= r.from);

  assert.equal(await k.state(() => shift().length), 0, 'новая смена пуста');
  assert.equal(await k.state(() => data.shiftStart), r.to + 1);
  assert.equal(await k.state(() => data.checks.length >= 1), true, 'чеки остались в истории');
  assert.match(await k.flash(), /Смена закрыта/);
});

kassa('после закрытия кассир выбирает имя заново', async (k) => {
  await k.pickName();
  await k.scan(GLASS);
  await k.page.click('#sell >> nth=0');
  await k.state(() => { sheet = null; render(); });
  await closeAs(k);
  assert.equal(await k.state(() => sellerId), null);
  await k.page.click('[data-shut="1"]');
  await k.page.click('[data-tab="sale"]');
  assert.match(await k.text(), /Кто за кассой\?/);
});

kassa('лист итога: кассир не видит прибыль, владелец видит', async (k) => {
  await k.pickName();
  await k.scan(IPHONE);
  await k.page.click('#sell >> nth=0');
  await k.state(() => { sheet = null; render(); });
  await k.page.click('[data-tab="checks"]');
  await k.page.click('#shift-close');
  const t = await k.page.locator('.sheet').innerText();
  assert.match(t, /Закрыть смену\?/);
  assert.match(t, /67\s*000/);
  assert.doesNotMatch(t, /прибыль/);

  const owner = await open({ role: 'owner' });
  try {
    await owner.state(() => { data.checks.push({ id: 'z', at: Date.now() - 500, by: 'Нурбек', total: 1000, cost: 400, off: 0, lines: [] }); });
    await owner.page.click('[data-tab="report"]');
    await owner.page.click('#shift-close');
    assert.match(await owner.page.locator('.sheet').innerText(), /прибыль/);
  } finally { await owner.close(); }
});

kassa('отмена закрытия ничего не меняет', async (k) => {
  await k.pickName();
  await k.scan(GLASS);
  await k.page.click('#sell >> nth=0');
  await k.state(() => { sheet = null; render(); });
  await k.page.click('[data-tab="checks"]');
  await k.page.click('#shift-close');
  await k.page.click('.sheet [data-shut="1"]');
  assert.equal(await k.state(() => data.shifts.length), 0);
  assert.equal(await k.state(() => data.shiftStart), null);
  assert.equal(await k.state(() => shift().length > 0), true);
});

kassa('нельзя закрыть с открытым чеком', async (k) => {
  await k.pickName();
  await k.scan(GLASS);
  await k.state(() => { data.checks.push({ id: 'z', at: Date.now() - 500, by: 'Нурбек', byId: 's1', total: 1, cost: 0, off: 0, lines: [] }); tab = 'checks'; render(); });
  await k.page.click('#shift-close');
  assert.match(await k.flash(), /закончите или отмените чек/i);
  assert.equal(await k.state(() => sheet), null);
  // и в обход кнопки — тоже
  await k.state(() => { sheet = { k: 'close' }; render(); });
  await k.page.click('#shift-confirm');
  assert.match(await k.flash(), /закончите или отмените чек/i);
  assert.equal(await k.state(() => data.shifts.length), 0);
});

kassa('нельзя закрыть смену без продаж', async (k) => {
  await k.pickName();
  await k.state(() => { data.checks = []; tab = 'checks'; render(); });
  await k.page.click('#shift-close');
  assert.match(await k.flash(), /закрывать нечего/);
  await k.state(() => { sheet = { k: 'close' }; render(); });
  await k.page.click('#shift-confirm');
  assert.match(await k.flash(), /закрывать нечего/);
  assert.equal(await k.state(() => data.shifts.length), 0);
});

kassa('без выбранного имени закрыть нельзя', async (k) => {
  await k.state(() => { tab = 'checks'; render(); });
  await k.page.click('#shift-close');
  assert.match(await k.flash(), /нажмите на своё имя/i);
  assert.equal(await k.state(() => sheet), null);
});

/* ------------------------------------------------ несколько смен */

kassa('две смены подряд считаются отдельно', async (k) => {
  await k.pickName();
  await k.scan(GLASS);
  await k.page.click('#sell >> nth=0');
  await k.state(() => { sheet = null; render(); });
  await closeAs(k);
  await k.page.click('[data-shut="1"]');
  await k.page.click('[data-tab="sale"]');

  await k.pickName();
  await k.scan(GLASS); await k.scan(GLASS);
  await k.page.click('#sell >> nth=0');
  await k.state(() => { sheet = null; render(); });
  assert.equal(await k.state(() => shift().length), 1, 'в новой смене один чек');
  await closeAs(k);

  const shifts = await k.state(() => data.shifts);
  assert.equal(shifts.length, 2);
  assert.equal(shifts[0].revenue, 300);
  assert.equal(shifts[1].revenue, 600);
  assert.ok(shifts[1].from > shifts[0].to, 'смены не пересекаются');
});

kassa('несколько кассиров: разбивка по каждому', async (k) => {
  await addCheck(k, { by: 'Нурбек', byId: 's1', total: 100, lines: [{ name: 'А', price: 100, qty: 1, off: 0 }] });
  await addCheck(k, { by: 'Айгерим', byId: 's2', total: 500, lines: [{ name: 'Б', price: 250, qty: 2, off: 0 }] });
  await addCheck(k, { by: 'Нурбек', byId: 's1', total: 50, lines: [{ name: 'А', price: 50, qty: 1, off: 0 }] });
  await k.pickName();
  const r = await k.state(() => shiftSummary());
  assert.deepEqual(r.byWho, [{ name: 'Айгерим', n: 1, sum: 500, ret: 0 }, { name: 'Нурбек', n: 2, sum: 150, ret: 0 }]);
  assert.deepEqual(r.items, [{ name: 'А', qty: 2 }, { name: 'Б', qty: 2 }].sort((a, b) => b.qty - a.qty || 0));
  assert.equal(r.units, 4);
  assert.equal(r.avg, Math.round(650 / 3));
});

kassa('смена до первого закрытия — прежние двенадцать часов', async (k) => {
  await k.state(() => { data.checks = []; data.shiftStart = null; });
  await addCheck(k, { at: Date.now() - 13 * 3600e3, total: 5, by: 'Нурбек' });
  await addCheck(k, { at: Date.now() - 1 * 3600e3, total: 7, by: 'Нурбек' });
  assert.equal(await k.state(() => shift().length), 1);
});

kassa('чек, сделанный до закрытия, в новую смену не попадает', async (k) => {
  await k.state(() => { data.checks = []; });
  await addCheck(k, { at: Date.now() - 5000, total: 10, by: 'Нурбек' });
  await k.pickName();
  await closeAs(k);
  assert.equal(await k.state(() => shift().length), 0);
  assert.equal(await k.state(() => data.checks.length), 1);
});

/* --------------------------------------------- история и отчёты */

kassa('владелец видит закрытые смены и открывает итог', { role: 'owner' }, async (k) => {
  await k.state(() => { data.checks = []; });
  await addCheck(k, { by: 'Нурбек', total: 700, cost: 300, lines: [{ name: 'Кабель', price: 700, qty: 1, off: 0 }] });
  await k.page.click('[data-tab="report"]');
  assert.match(await k.text(), /Пока ни одной/);
  await k.page.click('#shift-close');
  await k.page.click('#shift-confirm');
  assert.match(await k.page.locator('.sheet').innerText(), /Смена закрыта/);
  await k.page.click('.sheet [data-shut="1"]');

  const t = await k.text();
  assert.match(t, /Закрытые смены/);
  assert.match(t, /700 с/);
  assert.match(t, /В этой смене продаж ещё не было/);
  await k.page.click('[data-shiftview]');
  const sheet = await k.page.locator('.sheet').innerText();
  assert.match(sheet, /Итог смены/);
  assert.match(sheet, /Кабель/);
  assert.match(sheet, /400 с/, 'прибыль у владельца');
});

kassa('итог копируется текстом без закупки для кассира', async (k) => {
  await k.pickName();
  await addCheck(k, { by: 'Нурбек', byId: 's1', total: 700, cost: 300, lines: [{ name: 'Кабель', price: 700, qty: 1, off: 0 }] });
  const text = await k.state(() => shiftText({ ...shiftSummary(), to: Date.now(), by: 'Нурбек' }));
  assert.match(text, /Выручка: 700/);
  assert.match(text, /Кабель — 1 шт/);
  assert.match(text, /Нурбек: 1 чек/);
  assert.doesNotMatch(text, /Прибыль/);
  await k.state(() => { data.role = 'owner'; });
  assert.match(await k.state(() => shiftText({ ...shiftSummary(), to: Date.now(), by: 'В' })), /Прибыль: 400/);
});

kassa('выгрузка Excel с листом «Смены» собирается', async (k) => {
  await addCheck(k, { by: 'Нурбек', total: 700, cost: 300, lines: [{ name: 'Кабель', price: 700, qty: 1, off: 0 }] });
  await k.pickName();
  await closeAs(k);
  const size = await k.state(() => buildWorkbook().length);
  assert.ok(size > 1000);
});

/* ------------------------------------------------------ данные */

kassa('закрытая смена переживает перезагрузку', async (k) => {
  await k.pickName();
  await k.scan(GLASS);
  await k.page.click('#sell >> nth=0');
  await k.state(() => { sheet = null; render(); });
  await closeAs(k);
  const before = await k.state(() => ({ s: data.shifts, start: data.shiftStart }));
  await k.page.reload();
  assert.deepEqual(await k.state(() => ({ s: data.shifts, start: data.shiftStart })), before);
  assert.equal(await k.state(() => shift().length), 0);
});

kassa('данные без смен (старая версия) открываются: пустая история', {
  seed: { role: 'cashier', goods: [], checks: [], accounts: { owner: '', cashier: '' }, notes: [] },
}, async (k) => {
  assert.deepEqual(await k.state(() => ({ s: data.shifts, st: data.shiftStart })), { s: [], st: null });
});

kassa('программа на компьютере: закрытие уходит в файл через мостик', { desk: { initial: null } }, async (k) => {
  await k.state(() => {
    data.staff = [{ id: 's1', name: 'Бакыт' }];
    data.checks.push({ id: 'x', at: Date.now() - 100, by: 'Бакыт', byId: 's1', total: 900, cost: 400, off: 0, lines: [{ name: 'Кабель', price: 900, qty: 1, off: 0 }] });
    sellerId = 's1'; tab = 'checks'; render();
  });
  await k.page.click('#shift-close');
  await k.page.click('#shift-confirm');
  const saved = await k.state(() => window.__saved.at(-1));
  assert.equal(saved.shifts.length, 1);
  assert.equal(saved.shifts[0].revenue, 900);
  assert.equal(saved.shifts[0].by, 'Бакыт');
  assert.equal(typeof saved.shiftStart, 'number');
});
