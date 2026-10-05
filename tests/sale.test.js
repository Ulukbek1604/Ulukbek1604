'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { open, stop } = require('./helpers.js');

test.after(stop);

/** Каждый тест — чистая касса; страница закрывается и при падении. */
const kassa = (name, opts, fn) => {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  test(name, async () => {
    const k = await open(opts);
    try { await fn(k); assert.deepEqual(k.errors, [], 'ошибки на странице'); }
    finally { await k.close(); }
  });
};

const IPHONE = '4870001234561';   // g1, остаток 3, штучный
const SAMSUNG = '4870001234578';  // g2, остаток 6, штучный
const GLASS = '4870001234615';    // g6, остаток 40, один код на все

/* ------------------------------------------------------------ кассиры */

kassa('без имени: видно только выбор кассира, шапка просит имя', async (k) => {
  assert.equal(await k.page.locator('#who').innerText(), 'Выберите имя');
  const t = await k.text();
  assert.match(t, /Кто за кассой\?/);
  assert.match(t, /Нурбек/);
  assert.equal(await k.page.locator('.scanbox').count(), 0, 'пикалки на экране нет');
});

kassa('без имени: пик, список и продажа заблокированы', async (k) => {
  await k.scan(IPHONE);
  assert.match(await k.flash(), /нажмите на своё имя/i);
  assert.equal(await k.state(() => check.length), 0);

  await k.page.evaluate(() => { check.push({ id: 'g1', qty: 1, off: 0, codes: [] }); sell(); });
  assert.match(await k.flash(), /нажмите на своё имя/i);
  assert.equal(await k.state(() => data.checks.filter((c) => c.at > Date.now() - 5000).length), 0);
});

kassa('выбор имени открывает кассу и подписывает шапку', async (k) => {
  await k.pickName('s1');
  assert.equal(await k.page.locator('#who').innerText(), 'Нурбек');
  assert.match(await k.text(), /Продаёт:\s*Нурбек/);
  assert.equal(await k.page.locator('.scanbox').count(), 1);
});

kassa('несуществующий id кассира игнорируется', async (k) => {
  await k.page.evaluate(() => { sellerId = 'нет'; render(); });
  assert.match(await k.text(), /Кто за кассой\?/);
});

kassa('нет ни одного кассира: подсказка и вход владельца', { seed: { staff: [] } }, async (k) => {
  assert.match(await k.text(), /Кассиров пока нет/);
  assert.equal(await k.page.locator('#owner-in').count(), 1);
});

kassa('сменить кассира: при пустом чеке можно, при непустом нельзя', async (k) => {
  await k.state(() => { data.staff.push({ id: 's2', name: 'Айгерим' }); render(); });
  await k.pickName('s1');
  await k.scan(GLASS);
  await k.page.click('#who-change');
  assert.match(await k.flash(), /закончите или отмените чек/i);
  assert.equal(await k.state(() => me().name), 'Нурбек');

  await k.page.click('#check-drop');
  await k.page.click('#who-change');
  assert.match(await k.text(), /Кто за кассой\?/);
  await k.pickName('s2');
  assert.equal(await k.page.locator('#who').innerText(), 'Айгерим');
});

kassa('удалённый из списка кассир возвращает экран выбора', async (k) => {
  await k.pickName('s1');
  await k.state(() => { data.staff = []; render(); });
  assert.match(await k.text(), /Кассиров пока нет/);
  assert.equal(await k.state(() => me()), null);
});

/* ---------------------------------------------- владелец и кассиры */

kassa('владелец добавляет кассира', { role: 'owner' }, async (k) => {
  await k.page.click('[data-tab="more"]');
  await k.page.fill('#staff-name', '  Айгерим   Токтобекова ');
  await k.page.click('#staff-add');
  assert.match(await k.flash(), /добавлен/);
  assert.deepEqual(await k.state(() => data.staff.map((s) => s.name)), ['Нурбек', 'Айгерим Токтобекова']);
  assert.match(await k.text(), /Айгерим Токтобекова/);
});

kassa('пустое, дублирующееся и «Владелец» не добавляются', { role: 'owner' }, async (k) => {
  await k.page.click('[data-tab="more"]');
  for (const [name, re] of [['', /Впишите имя/], ['   ', /Впишите имя/], ['нурбек', /занято/], ['ВЛАДЕЛЕЦ', /занято/]]) {
    await k.page.fill('#staff-name', name);
    await k.page.click('#staff-add');
    assert.match(await k.flash(), re, `имя «${name}»`);
  }
  assert.equal(await k.state(() => data.staff.length), 1);
});

kassa('владелец убирает кассира, старые чеки остаются', { role: 'owner' }, async (k) => {
  await k.state(() => { data.checks.push({ id: 'c9', at: Date.now(), by: 'Нурбек', byId: 's1', total: 1, cost: 0, off: 0, lines: [] }); });
  await k.page.click('[data-tab="more"]');
  await k.page.click('[data-staffdel="s1"]');
  assert.match(await k.flash(), /убран/);
  assert.equal(await k.state(() => data.staff.length), 0);
  assert.ok(await k.state(() => data.checks.some((c) => c.id === 'c9')));
});

kassa('кассир не видит управление кассирами и закупку', async (k) => {
  await k.pickName('s1');
  await k.page.click('[data-tab="more"]');
  assert.equal(await k.page.locator('#staff-add').count(), 0);
  assert.equal(await k.page.locator('#limit-save').count(), 0);
});

/* --------------------------------------------------- остаток на складе */

kassa('штучный товар: нельзя добавить больше остатка, один код — один раз', async (k) => {
  await k.pickName();
  await k.scan(IPHONE);
  assert.equal(await k.state(() => check[0].qty), 1);
  for (let i = 0; i < 5; i += 1) {
    await k.scan(IPHONE);
    assert.match(await k.flash(), /уже в чеке/);
  }
  assert.equal(await k.state(() => check[0].qty), 1);
});

kassa('штучный товар: набор из списка упирается в остаток (3)', async (k) => {
  await k.pickName();
  for (let i = 0; i < 6; i += 1) await k.state(() => document.querySelector('[data-add="g1"]').click());
  assert.equal(await k.state(() => check[0].qty), 3);
  assert.match(await k.flash(), /на остатке 3 шт/);
});

kassa('товар с одним кодом на все штуки пикается много раз до остатка', async (k) => {
  await k.pickName();
  for (let i = 0; i < 10; i += 1) await k.scan(GLASS);
  assert.equal(await k.state(() => check[0].qty), 10);
  await k.state(() => { good('g6').stock = 10; });
  await k.scan(GLASS);
  assert.equal(await k.state(() => check[0].qty), 10);
  assert.match(await k.flash(), /на остатке 10 шт/);
});

kassa('убрали одну штуку — снова можно добавить, но не выше остатка', async (k) => {
  await k.pickName();
  for (let i = 0; i < 3; i += 1) await k.state(() => document.querySelector('[data-add="g1"]').click());
  await k.page.click('[data-less="g1"]');
  assert.equal(await k.state(() => check[0].qty), 2);
  await k.state(() => document.querySelector('[data-add="g1"]').click());
  assert.equal(await k.state(() => check[0].qty), 3);
  await k.state(() => document.querySelector('[data-add="g1"]').click());
  assert.equal(await k.state(() => check[0].qty), 3);
});

kassa('нулевой остаток: не добавить ни пиком, ни из списка', async (k) => {
  await k.pickName();
  await k.state(() => { good('g1').stock = 0; render(); });
  await k.scan(IPHONE);
  assert.match(await k.flash(), /остатке ноль/);
  assert.equal(await k.state(() => check.length), 0);
  assert.equal(await k.page.locator('[data-add="g1"][disabled]').count(), 1);
});

kassa('остаток упал, пока чек лежал: продажа отклоняется и ничего не списывает', async (k) => {
  await k.pickName();
  await k.scan(GLASS); await k.scan(GLASS); await k.scan(GLASS);
  await k.state(() => { good('g6').stock = 1; });
  const before = await k.state(() => data.checks.length);
  await k.state(() => sell());
  assert.match(await k.flash(), /на остатке 1 шт, в чеке 3/);
  assert.equal(await k.state(() => data.checks.length), before);
  assert.equal(await k.state(() => good('g6').stock), 1);
  assert.equal(await k.state(() => check[0].qty), 3, 'чек не потерян');
});

/* ------------------------------------------------ уникальные коробки */

kassa('продажа списывает остаток и записывает проданные коробки', async (k) => {
  await k.pickName();
  await k.scan(IPHONE);
  await k.page.click('#sell >> nth=0');
  assert.equal(await k.state(() => good('g1').stock), 2);
  assert.ok(await k.state((c) => !!data.sold[c], IPHONE));
  assert.equal(await k.state(() => check.length), 0);
});

kassa('проданную коробку нельзя продать второй раз', async (k) => {
  await k.pickName();
  await k.scan(IPHONE);
  await k.page.click('#sell >> nth=0');
  await k.state(() => { sheet = null; render(); });
  await k.scan(IPHONE);
  assert.match(await k.flash(), /уже продана/);
  assert.equal(await k.state(() => check.length), 0);
  assert.equal(await k.state(() => good('g1').stock), 2);
});

kassa('две разные коробки одной модели продаются одним чеком', async (k) => {
  await k.pickName();
  await k.state(() => { good('g1').codes.push('IMEI-2'); });
  await k.scan(IPHONE); await k.scan('IMEI-2');
  assert.equal(await k.state(() => check[0].qty), 2);
  assert.deepEqual(await k.state(() => check[0].codes), [IPHONE, 'IMEI-2']);
  await k.page.click('#sell >> nth=0');
  assert.deepEqual(await k.state(() => Object.keys(data.sold).sort()), ['IMEI-2', IPHONE].sort());
});

kassa('несколько штук разных товаров: проданы только штучные коды', async (k) => {
  await k.pickName();
  await k.scan(IPHONE); await k.scan(GLASS); await k.scan(GLASS);
  await k.page.click('#sell >> nth=0');
  assert.deepEqual(await k.state(() => Object.keys(data.sold)), [IPHONE]);
  assert.equal(await k.state(() => good('g6').stock), 38);
});

kassa('приём: знакомая и проданная коробка не принимаются повторно', async (k) => {
  await k.pickName();
  await k.scan(IPHONE);
  await k.page.click('#sell >> nth=0');
  await k.page.evaluate(() => { data.role = 'owner'; tab = 'intake'; sheet = null; render(); });
  await k.scan(IPHONE);
  assert.match(await k.flash(), /уже продана/);
  await k.scan(SAMSUNG);
  assert.match(await k.flash(), /уже принята/);
  assert.equal(await k.state(() => sheet), null);
  assert.equal(await k.state(() => good('g2').stock), 6);
});

kassa('приём: новая коробка той же модели добавляет код и остаток', { role: 'owner' }, async (k) => {
  await k.page.click('[data-tab="intake"]');
  await k.scan('NEW-IMEI-001');
  assert.equal(await k.state(() => sheet.k), 'newcode');
  await k.page.click('[data-attach="g1"]');
  assert.equal(await k.state(() => good('g1').stock), 4);
  assert.ok(await k.state(() => good('g1').codes.includes('NEW-IMEI-001')));
  await k.scan('NEW-IMEI-001');
  assert.match(await k.flash(), /уже принята/);
  assert.equal(await k.state(() => good('g1').stock), 4);
});

kassa('карточка нового товара: штучный по умолчанию, переключается', { role: 'owner' }, async (k) => {
  await k.page.click('[data-tab="intake"]');
  await k.page.click('#good-new');
  assert.equal(await k.page.getAttribute('[data-ngserial]', 'aria-pressed'), 'true');
  await k.page.fill('#ng-model', 'Чехол прозрачный');
  await k.page.fill('#ng-cost', '100');
  await k.page.fill('#ng-price', '300');
  await k.page.click('[data-ngserial]');
  assert.equal(await k.page.getAttribute('[data-ngserial]', 'aria-pressed'), 'false');
  assert.equal(await k.page.inputValue('#ng-model'), 'Чехол прозрачный', 'введённое не стёрлось');
  await k.page.click('#ng-save');
  const g = await k.state(() => data.goods.at(-1));
  assert.equal(g.name, 'Чехол прозрачный');
  assert.equal(g.serial, false);
});

kassa('правка товара: отметка IMEI переключается и сохраняется', { role: 'owner' }, async (k) => {
  await k.page.click('[data-tab="intake"]');
  await k.page.click('[data-edit="g6"]');
  assert.equal(await k.page.getAttribute('[data-edserial]', 'aria-pressed'), 'false');
  await k.page.click('[data-edserial="g6"]');
  assert.equal(await k.state(() => good('g6').serial), true);
});

/* ---------------------------------------------------- чеки и отчёты */

kassa('чек записывается на выбранного кассира', async (k) => {
  await k.state(() => { data.staff.push({ id: 's2', name: 'Айгерим' }); render(); });
  await k.pickName('s2');
  await k.scan(GLASS);
  await k.page.click('#sell >> nth=0');
  const c = await k.state(() => data.checks.at(-1));
  assert.equal(c.by, 'Айгерим');
  assert.equal(c.byId, 's2');
  assert.match(await k.page.locator('.sheetpaper').innerText(), /продал Айгерим/);
});

kassa('владелец продаёт как «Владелец»', { role: 'owner' }, async (k) => {
  await k.scan(GLASS);
  await k.state(() => sell());
  const c = await k.state(() => data.checks.at(-1));
  assert.equal(c.by, 'Владелец');
  assert.equal(c.byId, 'owner');
});

kassa('«Мои чеки»: кассир видит только свои', async (k) => {
  await k.state(() => {
    data.staff.push({ id: 's2', name: 'Айгерим' });
    data.checks = [
      { id: 'a', at: Date.now() - 1000, by: 'Айгерим', byId: 's2', total: 10, cost: 0, off: 0, lines: [] },
      { id: 'b', at: Date.now() - 900, by: 'Нурбек', byId: 's1', total: 20, cost: 0, off: 0, lines: [] },
      { id: 'c', at: Date.now() - 800, by: 'Нурбек', total: 30, cost: 0, off: 0, lines: [] },
      { id: 'd', at: Date.now() - 700, by: 'Владелец', byId: 'owner', total: 40, cost: 0, off: 0, lines: [] },
    ];
  });
  await k.pickName('s1');
  assert.deepEqual(await k.state(() => mine().map((c) => c.id).sort()), ['b', 'c']);
  await k.state(() => { sellerId = 's2'; });
  assert.deepEqual(await k.state(() => mine().map((c) => c.id)), ['a']);
});

kassa('отчёт: блок «По кассирам» суммирует чеки смены', { role: 'owner' }, async (k) => {
  await k.state(() => {
    data.checks = [
      { id: 'a', at: Date.now() - 1000, by: 'Айгерим', total: 100, cost: 0, off: 0, lines: [] },
      { id: 'b', at: Date.now() - 900, by: 'Айгерим', total: 50, cost: 0, off: 0, lines: [] },
      { id: 'c', at: Date.now() - 800, by: 'Нурбек', total: 30, cost: 0, off: 0, lines: [] },
    ];
  });
  await k.page.click('[data-tab="report"]');
  const t = await k.text();
  assert.match(t, /По кассирам/);
  assert.match(t, /Айгерим[\s\S]*2 чека[\s\S]*150/);
  assert.match(t, /Нурбек[\s\S]*1 чек[\s\S]*30/);
});

kassa('выгрузка в Excel собирается без ошибок', { role: 'owner' }, async (k) => {
  await k.page.click('[data-tab="report"]');
  const ok = await k.state(() => { const w = buildWorkbook(); return !!w; });
  assert.ok(ok);
});

/* ------------------------------------------------------- скидки */

kassa('скидка кассира выше предела отклоняется, в пределе проходит', async (k) => {
  await k.pickName();
  await k.scan(GLASS);
  await k.page.click('[data-off="g6"]');
  await k.page.fill('#off-value', '10000');
  await k.page.click('[data-offsave="g6"]');
  assert.match(await k.flash(), /Ваш предел/);
  await k.page.fill('#off-value', '100');
  await k.page.click('[data-offsave="g6"]');
  assert.equal(await k.state(() => check[0].off), 100);
});

/* ------------------------------------------------ данные и перенос */

kassa('данные переживают перезагрузку, а имя кассира выбирают заново', async (k) => {
  await k.pickName();
  await k.scan(GLASS);
  await k.page.click('#sell >> nth=0');
  const n = await k.state(() => data.checks.length);
  await k.page.reload();
  assert.equal(await k.state(() => data.checks.length), n);
  assert.equal(await k.page.locator('#who').innerText(), 'Выберите имя');
  assert.ok(await k.state(() => data.checks.some((c) => c.byId === 's1')));
});

kassa('старые данные без кассиров и отметки IMEI переносятся', {
  seed: {
    role: 'cashier', limit: 500, accounts: { owner: '', cashier: '' }, notes: [],
    goods: [
      { id: 'p', code: '111', name: 'Телефон 8/256 ГБ', model: 'Телефон', mem: '256 ГБ', cost: 10, price: 20, stock: 2 },
      { id: 'q', code: '222', name: 'Кабель', cost: 1, price: 2, stock: 5 },
    ],
    checks: [{ id: 'old', at: Date.now() - 2 * 24 * 3600e3, by: 'Кассир', total: 20, cost: 10, off: 0,
      lines: [{ name: 'Телефон 8/256 ГБ', price: 20, qty: 1, off: 0, codes: ['999'] }] }],
  },
}, async (k) => {
  const d = await k.state(() => ({ goods: data.goods, staff: data.staff, sold: data.sold }));
  assert.deepEqual(d.goods[0].codes, ['111']);
  assert.equal(d.goods[0].serial, true);
  assert.equal(d.goods[1].serial, false);
  assert.ok(Array.isArray(d.staff));
  assert.ok(d.sold['999'], 'код из старого чека считается проданным');
  await k.pickName('s1');
  await k.scan('999');
  assert.match(await k.flash(), /уже продана/);
});

kassa('программа на компьютере: пустой магазин, кассиров нет, сохранение идёт через мостик', {
  desk: { initial: null },
}, async (k) => {
  assert.deepEqual(await k.state(() => ({ g: data.goods.length, c: data.checks.length, s: data.staff.length })), { g: 0, c: 0, s: 0 });
  assert.match(await k.text(), /Кассиров пока нет/);

  await k.page.click('#owner-in');
  await k.page.evaluate(() => { data.accounts.owner = '1234'; letIn('owner'); });
  await k.page.click('[data-tab="more"]');
  await k.page.fill('#staff-name', 'Бакыт');
  await k.page.click('#staff-add');
  const saved = await k.state(() => window.__saved.at(-1));
  assert.deepEqual(saved.staff.map((s) => s.name), ['Бакыт']);
});

kassa('сканер как клавиатура: быстрый набор и Enter кладут товар в чек', async (k) => {
  await k.pickName();
  await k.page.evaluate(() => document.activeElement?.blur());
  await k.page.keyboard.type(GLASS, { delay: 0 });
  await k.page.keyboard.press('Enter');
  assert.equal(await k.state(() => check[0]?.qty), 1);
  assert.equal(await k.state(() => check[0]?.id), 'g6');
});
