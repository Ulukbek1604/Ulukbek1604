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

const GLASS = '4870001234615';    // g6: остаток 40, закуп 90
const count = async (k, id, value) => {
  await k.page.fill(`[data-inv="${id}"]`, String(value));
  await k.page.locator(`[data-inv="${id}"]`).blur();
};
const startInventory = async (k) => {
  await k.page.click('[data-tab="intake"]');
  await k.page.click('#inv-start');
};

/* ================================================= название магазина */

kassa('название по умолчанию: шапка и заголовок окна', async (k) => {
  assert.equal(await k.page.locator('#shop').innerText(), 'Телефоны и чехлы');
  assert.equal(await k.page.title(), 'Касса — Телефоны и чехлы');
});

kassa('владелец меняет название: шапка, заголовок окна, чек, итог смены', { role: 'owner' }, async (k) => {
  await k.page.click('[data-tab="more"]');
  await k.page.fill('#shop-name', '  Мир   гаджетов ');
  await k.page.click('#shop-save');
  assert.match(await k.flash(), /Магазин: Мир гаджетов/);
  assert.equal(await k.state(() => data.shopName), 'Мир гаджетов');
  assert.equal(await k.page.locator('#shop').innerText(), 'Мир гаджетов');
  assert.equal(await k.page.title(), 'Касса — Мир гаджетов');

  await k.state(() => {
    data.checks = [{ id: 'c1', at: Date.now() - 500, by: 'Владелец', total: 100, cost: 40, off: 0, lines: [] }];
    sheet = { k: 'receipt', id: 'c1' }; render();
  });
  assert.match(await k.page.locator('.sheetpaper').innerText(), /Мир гаджетов/);
  assert.match(await k.state(() => shiftText({ ...shiftSummary(), to: Date.now(), by: 'В' })), /^Мир гаджетов/);
});

kassa('название: пустое не принимается, длинное обрезается до 40, переживает перезагрузку', { role: 'owner' }, async (k) => {
  await k.page.click('[data-tab="more"]');
  await k.page.fill('#shop-name', '   ');
  await k.page.click('#shop-save');
  assert.match(await k.flash(), /Впишите название/);
  assert.equal(await k.state(() => data.shopName), 'Телефоны и чехлы');

  await k.state(() => { document.getElementById('shop-name').removeAttribute('maxlength'); });
  await k.page.fill('#shop-name', 'Я'.repeat(60));
  await k.page.click('#shop-save');
  assert.equal(await k.state(() => data.shopName.length), 40);

  await k.page.reload();
  assert.equal(await k.state(() => data.shopName.length), 40);
});

kassa('название в Excel', { role: 'owner' }, async (k) => {
  await k.state(() => { data.shopName = 'Мир гаджетов'; });
  const text = await k.state(() => {
    const bytes = buildWorkbook();
    return new TextDecoder().decode(bytes);
  });
  assert.ok(text.includes('Мир гаджетов'), 'название попало в книгу');
});

kassa('кассир не видит настройку названия', async (k) => {
  await k.page.click('[data-who="s1"]');
  await k.page.click('[data-tab="more"]');
  assert.equal(await k.page.locator('#shop-name').count(), 0);
});

kassa('старые данные без названия: берётся прежнее', {
  seed: { role: 'cashier', goods: [], checks: [], accounts: { owner: '', cashier: '' }, notes: [] },
}, async (k) => {
  assert.equal(await k.state(() => data.shopName), 'Телефоны и чехлы');
});

kassa('повреждённое название в файле заменяется прежним', {
  seed: { role: 'cashier', goods: [], checks: [], accounts: { owner: '', cashier: '' }, notes: [], shopName: 42 },
}, async (k) => {
  assert.equal(await k.state(() => data.shopName), 'Телефоны и чехлы');
});

/* ======================================================= инвентаризация */

kassa('кнопка инвентаризации есть у владельца, у кассира нет', async (k) => {
  await k.page.click('[data-who="s1"]');
  await k.page.click('[data-tab="intake"]');
  assert.equal(await k.page.locator('#inv-start').count(), 0);
  const owner = await open({ role: 'owner' });
  try {
    await owner.page.click('[data-tab="intake"]');
    assert.equal(await owner.page.locator('#inv-start').count(), 1);
  } finally { await owner.close(); }
});

kassa('кассир не может начать инвентаризацию в обход кнопки', async (k) => {
  await k.page.click('[data-who="s1"]');
  await k.state(() => {
    document.body.insertAdjacentHTML('beforeend', '<button id="inv-start">x</button>');
    document.querySelector('body > #inv-start').click();
  });
  assert.equal(await k.state(() => data.invDraft), null);
  assert.equal(await k.state(() => tab), 'sale');
});

kassa('подсчёт: разница видна сразу, непосчитанное не трогается', { role: 'owner' }, async (k) => {
  await startInventory(k);
  assert.match(await k.text(), /Инвентаризация с/);
  await count(k, 'g6', 38);                               // учёт 40
  assert.equal(await k.page.locator('#inv-d-g6').innerText(), 'разница -2');
  await count(k, 'g7', 31);                               // учёт 31
  assert.equal(await k.page.locator('#inv-d-g7').innerText(), 'сошлось');
  const d = await k.state(() => data.invDraft.counts);
  assert.deepEqual(d, { g6: { n: 38, base: 40 }, g7: { n: 31, base: 31 } });
  assert.equal(await k.state(() => good('g6').stock), 40, 'пока ничего не записано');
  assert.match(await k.text(), /2 из 10\s*посчитано/);
  assert.match(await k.text(), /1\s*расхождений/);
});

kassa('пустое поле снимает подсчёт, отрицательное и дробное обрабатываются', { role: 'owner' }, async (k) => {
  await startInventory(k);
  await count(k, 'g6', 38);
  await k.page.fill('[data-inv="g6"]', '');
  assert.equal(await k.state(() => 'g6' in data.invDraft.counts), false);
  await k.page.fill('[data-inv="g6"]', '-5');
  assert.equal(await k.state(() => 'g6' in data.invDraft.counts), false, 'минус не принимается');
  await k.page.fill('[data-inv="g6"]', '37.9');
  assert.equal(await k.state(() => data.invDraft.counts.g6.n), 37, 'дробное округляется вниз');
});

kassa('итог перед записью: только расхождения, суммы по закупу, «назад» оставляет подсчёт', { role: 'owner' }, async (k) => {
  await startInventory(k);
  await count(k, 'g6', 38);     // −2 × 90 = −180
  await count(k, 'g7', 33);     // +2 × 150 = +300
  await count(k, 'g8', 12);     // сошлось
  await k.page.click('#inv-review');
  const t = await k.page.locator('.sheet').innerText();
  assert.match(t, /Итог инвентаризации/);
  assert.match(t, /Посчитано товаров: 3/);
  assert.match(t, /Стекло защитное[\s\S]*по учёту 40 → есть 38[\s\S]*-2 шт[\s\S]*-180 с/);
  assert.match(t, /Кабель Type-C, 1 м[\s\S]*по учёту 31 → есть 33[\s\S]*\+2 шт[\s\S]*300 с/);
  assert.doesNotMatch(t, /Наушники/, 'совпавшее в итог не попадает');
  assert.match(t, /недостача по закупу/);
  assert.match(t, /излишек по закупу/);
  await k.page.click('.sheet [data-shut="1"]');
  assert.ok(await k.state(() => !!data.invDraft));
  assert.equal(await k.state(() => tab), 'inv');
});

kassa('запись: остатки, журнал, история, черновик закрыт', { role: 'owner' }, async (k) => {
  await startInventory(k);
  await count(k, 'g6', 38);
  await count(k, 'g7', 33);
  await k.page.click('#inv-review');
  await k.page.click('#inv-apply');
  assert.match(await k.flash(), /расхождений 2/);

  assert.equal(await k.state(() => good('g6').stock), 38);
  assert.equal(await k.state(() => good('g7').stock), 33);
  assert.equal(await k.state(() => data.invDraft), null);
  assert.equal(await k.state(() => tab), 'intake');

  const log = await k.state(() => data.intakes.map((i) => [i.by, i.name, i.qty, i.kind]));
  assert.deepEqual(log, [['Владелец', 'Стекло защитное', -2, 'inv'], ['Владелец', 'Кабель Type-C, 1 м', 2, 'inv']]);
  const rec = await k.state(() => data.inventories[0]);
  assert.equal(rec.counted, 2);
  assert.equal(rec.by, 'Владелец');
  assert.deepEqual(rec.lines.map((l) => [l.name, l.was, l.now, l.diff, l.cost]),
    [['Стекло защитное', 40, 38, -2, 90], ['Кабель Type-C, 1 м', 31, 33, 2, 150]]);

  // видно в отчёте, открывается
  await k.page.click('[data-tab="report"]');
  assert.match(await k.text(), /Инвентаризации[\s\S]*посчитано 2, расхождений 2/);
  assert.match(await k.text(), /инвентаризация/, 'и в журнале приёмки');
  await k.page.click('[data-invview]');
  const t = await k.page.locator('.sheet').innerText();
  assert.match(t, /провёл\(а\) Владелец/);
  assert.match(t, /Стекло защитное/);
});

kassa('продажа после пересчёта не теряется: остаток сдвигается на разницу', { role: 'owner' }, async (k) => {
  await startInventory(k);
  await count(k, 'g1', 2);                                  // было 3, посчитано 2: недостача 1
  await k.state(() => { good('g1').stock = 2; });           // а тем временем одну штуку продали
  await k.page.click('#inv-review');
  await k.page.click('#inv-apply');
  assert.equal(await k.state(() => good('g1').stock), 1, '2 − 1, а не «установить 2»');
});

kassa('остаток не уходит ниже нуля', { role: 'owner' }, async (k) => {
  await startInventory(k);
  await count(k, 'g1', 0);                                  // было 3: разница −3
  await k.state(() => { good('g1').stock = 1; });
  await k.page.click('#inv-review');
  await k.page.click('#inv-apply');
  assert.equal(await k.state(() => good('g1').stock), 0);
});

kassa('всё сошлось: запись без расхождений', { role: 'owner' }, async (k) => {
  await startInventory(k);
  await count(k, 'g7', 31);
  await k.page.click('#inv-review');
  assert.match(await k.page.locator('.sheet').innerText(), /Расхождений нет/);
  await k.page.click('#inv-apply');
  assert.match(await k.flash(), /всё сошлось/);
  assert.equal(await k.state(() => data.inventories[0].lines.length), 0);
  assert.equal(await k.state(() => data.intakes.length), 0);
});

kassa('ничего не посчитано: итог и запись не открываются', { role: 'owner' }, async (k) => {
  await startInventory(k);
  await k.page.click('#inv-review');
  assert.match(await k.flash(), /ничего не посчитано/i);
  assert.equal(await k.state(() => sheet), null);
  await k.state(() => { sheet = { k: 'invreview' }; render(); });
  await k.page.click('#inv-apply');
  assert.match(await k.flash(), /ничего не посчитано/i);
  assert.equal(await k.state(() => data.inventories.length), 0);
});

kassa('отмена: черновик убран, остатки на месте', { role: 'owner' }, async (k) => {
  await startInventory(k);
  await count(k, 'g6', 1);
  await k.page.click('#inv-cancel');
  assert.match(await k.flash(), /остатки не менялись/);
  assert.equal(await k.state(() => data.invDraft), null);
  assert.equal(await k.state(() => good('g6').stock), 40);
  assert.equal(await k.page.locator('#inv-start').innerText().then((t) => /Инвентаризация: пересчитать/.test(t)), true);
});

kassa('подсчёт переживает уход на другую вкладку и перезагрузку', { role: 'owner' }, async (k) => {
  await startInventory(k);
  await count(k, 'g6', 38);
  await k.page.click('[data-tab="report"]');
  await k.page.click('[data-tab="intake"]');
  assert.match(await k.page.locator('#inv-start').innerText(), /Продолжить инвентаризацию/);
  await k.page.reload();
  assert.deepEqual(await k.state(() => data.invDraft.counts.g6), { n: 38, base: 40 });
});

kassa('поиск в списке инвентаризации и сохранение введённого', { role: 'owner' }, async (k) => {
  await startInventory(k);
  await count(k, 'g6', 38);
  await k.page.fill('#inv-q', 'кабель');
  assert.equal(await k.page.locator('[data-inv]').count(), 1);
  await k.page.fill('#inv-q', 'нет такого');
  assert.match(await k.text(), /Ничего не нашлось/);
  await k.page.click('#inv-q-clear');
  assert.equal(await k.page.locator('[data-inv]').count(), 10);
  assert.equal(await k.page.inputValue('[data-inv="g6"]'), '38', 'введённое не потерялось');
});

kassa('кассир не может записать инвентаризацию в обход кнопки', async (k) => {
  await k.state(() => { data.invDraft = { at: Date.now(), by: 'x', counts: { g6: { n: 1, base: 40 } } }; });
  await k.page.click('[data-who="s1"]');
  await k.state(() => { sheet = { k: 'invreview' }; render(); });
  // Кнопки у кассира нет; нажимаем «в обход», как это сделал бы кто-то из консоли.
  await k.state(() => {
    document.body.insertAdjacentHTML('beforeend', '<button id="inv-apply">x</button>');
    document.querySelector('body > #inv-apply').click();
  });
  assert.equal(await k.state(() => good('g6').stock), 40);
  assert.equal(await k.state(() => data.inventories.length), 0);
});

kassa('«принято за смену» не считает инвентаризацию, выгрузка Excel собирается', { role: 'owner' }, async (k) => {
  await startInventory(k);
  await count(k, 'g6', 30);
  await k.page.click('#inv-review');
  await k.page.click('#inv-apply');
  assert.equal(await k.state(() => shiftSummary().received), 0);
  assert.ok(await k.state(() => buildWorkbook().length > 1000));
});

kassa('старые данные без инвентаризаций открываются', {
  seed: { role: 'cashier', goods: [], checks: [], accounts: { owner: '', cashier: '' }, notes: [] },
}, async (k) => {
  assert.deepEqual(await k.state(() => [data.inventories, data.invDraft]), [[], null]);
});

kassa('программа на компьютере: подсчёт и запись уходят в файл', { desk: { initial: null } }, async (k) => {
  await k.state(() => {
    data.role = 'owner';
    data.goods = [{ id: 'gx', codes: [], name: 'Кабель', model: 'Кабель', cost: 100, price: 200, stock: 5 }];
    tab = 'intake'; render();
  });
  await k.page.click('#inv-start');
  await count(k, 'gx', 4);
  await k.page.click('#inv-review');
  await k.page.click('#inv-apply');
  const saved = await k.state(() => window.__saved.at(-1));
  assert.equal(saved.goods[0].stock, 4);
  assert.equal(saved.inventories.length, 1);
  assert.equal(saved.invDraft, null);
});
