'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { open, stop } = require('./helpers.js');

test.after(stop);

const kassa = (name, opts, fn) => {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  test(name, async () => {
    const k = await open(opts);
    await k.state(() => { data.checks = []; render(); });
    try { await fn(k); assert.deepEqual(k.errors, [], 'ошибки на странице'); }
    finally { await k.close(); }
  });
};

const GLASS = '4870001234615';

kassa('смена не открыта: на экране только кнопка открытия', async (k) => {
  await k.page.click('[data-who="s1"]');
  const t = await k.text();
  assert.match(t, /Смена не открыта/);
  assert.equal(await k.page.locator('#shift-open').count(), 1);
  assert.equal(await k.page.locator('.scanbox').count(), 0);
});

kassa('без открытой смены пик, список и продажа заблокированы', async (k) => {
  await k.page.click('[data-who="s1"]');
  await k.scan(GLASS);
  assert.match(await k.flash(), /откройте смену/i);
  assert.equal(await k.state(() => check.length), 0);

  await k.state(() => { check.push({ id: 'g6', qty: 1, off: 0, codes: [] }); sell(); });
  assert.match(await k.flash(), /откройте смену/i);
  assert.equal(await k.state(() => data.checks.length), 0);
  assert.equal(await k.state(() => good('g6').stock), 40);
});

kassa('кассир открывает смену: запись с именем и временем, касса появляется', async (k) => {
  const before = Date.now();
  await k.page.click('[data-who="s1"]');
  await k.page.click('#shift-open');
  const o = await k.state(() => data.shiftOpen);
  assert.equal(o.by, 'Нурбек');
  assert.equal(o.byId, 's1');
  assert.ok(o.at >= before && o.at <= Date.now());
  assert.match(await k.flash(), /Смена открыта, Нурбек/);
  assert.equal(await k.page.locator('.scanbox').count(), 1);
  await k.scan(GLASS);
  assert.equal(await k.state(() => check.length), 1);
});

kassa('владелец тоже открывает смену перед продажей', { role: 'owner' }, async (k) => {
  assert.match(await k.text(), /Смена не открыта/);
  await k.page.click('#shift-open');
  assert.equal(await k.state(() => data.shiftOpen.by), 'Владелец');
  assert.equal(await k.state(() => data.shiftOpen.byId), 'owner');
  await k.scan(GLASS);
  assert.equal(await k.state(() => check.length), 1);
});

kassa('открытая смена не открывается второй раз и не меняет автора', async (k) => {
  await k.state(() => { data.staff.push({ id: 's2', name: 'Айгерим' }); render(); });
  await k.page.click('[data-who="s1"]');
  await k.page.click('#shift-open');
  const first = await k.state(() => data.shiftOpen);
  await k.state(() => { sellerId = 's2'; });
  await k.page.evaluate(() => { const b = document.createElement('button'); b.id = 'shift-open'; document.body.appendChild(b); });
  await k.page.click('body > #shift-open');
  assert.deepEqual(await k.state(() => data.shiftOpen), first);
});

kassa('смена остаётся открытой при смене кассира', async (k) => {
  await k.state(() => { data.staff.push({ id: 's2', name: 'Айгерим' }); render(); });
  await k.page.click('[data-who="s1"]');
  await k.page.click('#shift-open');
  await k.page.click('#who-change');
  await k.page.click('[data-who="s2"]');
  assert.equal(await k.page.locator('.scanbox').count(), 1, 'открывать заново не нужно');
  assert.equal(await k.state(() => data.shiftOpen.by), 'Нурбек');
});

kassa('закрытие: в итоге кто открыл, смена закрывается и снова требует открытия', async (k) => {
  await k.page.click('[data-who="s1"]');
  await k.page.click('#shift-open');
  const openedAt = await k.state(() => data.shiftOpen.at);
  await k.scan(GLASS);
  await k.page.click('#sell >> nth=0');
  await k.state(() => { sheet = null; render(); });
  await k.page.click('[data-tab="checks"]');
  await k.page.click('#shift-close');
  assert.match(await k.page.locator('.sheet').innerText(), /Открыл\(а\) Нурбек/);
  await k.page.click('#shift-confirm');

  const rec = await k.state(() => data.shifts[0]);
  assert.equal(rec.from, openedAt);
  assert.equal(rec.openedBy, 'Нурбек');
  assert.equal(await k.state(() => data.shiftOpen), null);

  await k.page.click('.sheet [data-shut="1"]');
  await k.page.click('[data-tab="sale"]');
  await k.page.click('[data-who="s1"]');
  assert.match(await k.text(), /Смена не открыта/);
  await k.scan(GLASS);
  assert.match(await k.flash(), /откройте смену/i);
});

kassa('итог текстом называет того, кто открыл', async (k) => {
  await k.page.click('[data-who="s1"]');
  await k.page.click('#shift-open');
  await k.state(() => { data.checks.push({ id: 'z', at: Date.now() + 1, by: 'Нурбек', byId: 's1', total: 100, cost: 0, off: 0, lines: [] }); });
  const text = await k.state(() => shiftText({ ...shiftSummary(), to: Date.now(), by: 'Нурбек' }));
  assert.match(text, /открыл\(а\) Нурбек, закрыл\(а\) Нурбек/);
});

kassa('открытая смена переживает перезагрузку, имя кассира выбирают заново', async (k) => {
  await k.page.click('[data-who="s1"]');
  await k.page.click('#shift-open');
  const o = await k.state(() => data.shiftOpen);
  await k.page.reload();
  assert.deepEqual(await k.state(() => data.shiftOpen), o);
  assert.match(await k.text(), /Кто за кассой\?/);
  await k.page.click('[data-who="s1"]');
  assert.equal(await k.page.locator('.scanbox').count(), 1, 'смена уже открыта');
});

kassa('старые данные без открытия: смена не открыта, но закрыть можно, если были продажи', {
  seed: {
    role: 'cashier', goods: [], accounts: { owner: '', cashier: '' }, notes: [],
    staff: [{ id: 's1', name: 'Нурбек' }],
    checks: [{ id: 'old', at: Date.now() - 3600e3, by: 'Нурбек', byId: 's1', total: 500, cost: 200, off: 0, lines: [] }],
  },
}, async (k) => {
  await k.state(() => { data.checks = [{ id: 'old', at: Date.now() - 3600e3, by: 'Нурбек', byId: 's1', total: 500, cost: 200, off: 0, lines: [] }]; });
  assert.equal(await k.state(() => data.shiftOpen), null);
  await k.page.click('[data-who="s1"]');
  assert.match(await k.text(), /Смена не открыта/);
  await k.state(() => { tab = 'checks'; render(); });
  await k.page.click('#shift-close');
  await k.page.click('#shift-confirm');
  const rec = await k.state(() => data.shifts[0]);
  assert.equal(rec.revenue, 500);
  assert.equal(rec.openedBy, null);
});

kassa('программа на компьютере: открытие уходит в файл через мостик', { desk: { initial: null } }, async (k) => {
  await k.state(() => { data.staff = [{ id: 's1', name: 'Бакыт' }]; render(); });
  await k.page.click('[data-who="s1"]');
  await k.page.click('#shift-open');
  const saved = await k.state(() => window.__saved.at(-1));
  assert.equal(saved.shiftOpen.by, 'Бакыт');
});
