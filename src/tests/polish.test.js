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

const GLASS = '4870001234615';

/* ------------------------------------------- автовыход владельца */

/** Владелец «вошёл по коду» — как в настоящей программе, без ссылки ?role=owner. */
const ownerIn = (k) => k.state(() => { data.accounts.owner = '1234'; letIn('owner'); });

kassa('владелец молчит дольше срока — касса возвращается к кассиру', { role: 'none' }, async (k) => {
  await ownerIn(k);
  assert.equal(await k.state(() => owner()), true);
  await k.state(() => { OWNER_IDLE_MS = 50; lastTouch = Date.now() - 1000; sheet = { k: 'code' }; idleCheck(); });
  assert.equal(await k.state(() => owner()), false);
  assert.equal(await k.state(() => data.role), 'cashier');
  assert.equal(await k.state(() => sheet), null);
  assert.match(await k.flash(), /долго не было действий/);
  assert.equal(await k.page.locator('[data-tab="report"]').count(), 0, 'отчёта у кассира нет');
});

kassa('пока владелец что-то делает, он остаётся', { role: 'none' }, async (k) => {
  await ownerIn(k);
  await k.state(() => { OWNER_IDLE_MS = 5000; lastTouch = Date.now() - 1000; idleCheck(); });
  assert.equal(await k.state(() => owner()), true);
  // нажатие обновляет отсчёт
  await k.state(() => { OWNER_IDLE_MS = 1000; lastTouch = Date.now() - 900; });
  await k.page.mouse.click(5, 5);
  await k.state(() => idleCheck());
  assert.equal(await k.state(() => owner()), true);
});

kassa('ссылка ?role=owner (демонстрация) автоматически не выходит', { role: 'owner' }, async (k) => {
  await k.state(() => { OWNER_IDLE_MS = 50; lastTouch = 0; idleCheck(); });
  assert.equal(await k.state(() => owner()), true);
});

kassa('кассир автовыходом не затрагивается', async (k) => {
  await k.pickName();
  await k.state(() => { OWNER_IDLE_MS = 50; lastTouch = 0; idleCheck(); });
  assert.equal(await k.state(() => me()?.name), 'Нурбек');
});

kassa('владелец закрыл смену и прочёл итог — выходит к кассиру', { role: 'none' }, async (k) => {
  await ownerIn(k);
  await k.state(() => {
    data.checks = [{ id: 'z', at: Date.now() - 500, by: 'Владелец', byId: 'owner', total: 500, cost: 200, off: 0, lines: [] }];
    tab = 'report'; render();
  });
  await k.page.click('#shift-close');
  await k.page.click('#shift-confirm');
  assert.equal(await k.state(() => owner()), true, 'итог ещё читает владелец');
  assert.match(await k.page.locator('.sheet').innerText(), /прибыль/);
  await k.page.click('.sheet [data-shut="1"]');
  assert.equal(await k.state(() => owner()), false);
  assert.match(await k.flash(), /Смена закрыта/);
});

/* ---------------------------------------------------- «Ходовое» */

kassa('«Ходовое» — по продажам за три недели, закончившееся в конце', async (k) => {
  await k.state(() => {
    const mk = (id, name, qty, ago) => ({ id, at: Date.now() - ago, by: 'Н', total: 1, cost: 0, off: 0,
      lines: [{ name, price: 1, qty, off: 0 }] });
    data.checks = [
      mk('a', 'Кабель Type-C, 1 м', 9, 1000),
      mk('b', 'Стекло защитное', 5, 2000),
      mk('c', 'Повербанк 10000 мА·ч', 7, 1000),
      mk('d', 'Наушники проводные', 99, 40 * 86400e3),   // давно — не считается
    ];
    good('g9').stock = 0;                                  // повербанк закончился
  });
  const names = await k.state(() => popular().map((g) => g.name));
  assert.deepEqual(names.slice(0, 2), ['Кабель Type-C, 1 м', 'Стекло защитное']);
  assert.equal(names.length, 6);
  assert.ok(!names.includes('Повербанк 10000 мА·ч'), 'закончившееся не вылезает наверх');
});

kassa('«Ходовое» без продаж: сначала недавно принятое', async (k) => {
  await k.state(() => { data.checks = []; good('g8').at = Date.now(); });
  assert.equal(await k.state(() => popular()[0].name), 'Наушники проводные');
});

kassa('«Ходовое» на экране продажи берёт список из продаж', async (k) => {
  await k.state(() => {
    data.checks = [{ id: 'a', at: Date.now() - 1000, by: 'Н', total: 1, cost: 0, off: 0,
      lines: [{ name: 'Зарядка 20 Вт', price: 1, qty: 20, off: 0 }] }];
  });
  await k.pickName();
  const first = await k.page.locator('.goods .good').first().innerText();
  assert.match(first, /Зарядка 20 Вт/);
});

/* ------------------------------------------- поиск в списке */

kassa('«Выбрать из списка»: поиск по названию и коду, пустой результат', async (k) => {
  await k.pickName();
  await k.page.click('#pick-list');
  assert.equal(await k.page.locator('.sheet [data-add]').count(), 10);
  await k.page.fill('#pl-q', 'кабель');
  assert.equal(await k.page.locator('.sheet [data-add]').count(), 1);
  await k.page.fill('#pl-q', '4870001234615');
  assert.match(await k.page.locator('.sheet').innerText(), /Стекло защитное/);
  await k.page.fill('#pl-q', 'нет такого');
  assert.match(await k.page.locator('.sheet').innerText(), /Ничего не нашлось/);
  await k.page.click('#pl-clear');
  assert.equal(await k.page.locator('.sheet [data-add]').count(), 10);
});

kassa('поиск в списке добавляет найденный товар и сбрасывается при следующем открытии', async (k) => {
  await k.pickName();
  await k.page.click('#pick-list');
  await k.page.fill('#pl-q', 'стекло');
  await k.page.click('.sheet [data-add="g6"]');
  assert.equal(await k.state(() => check[0].id), 'g6');
  await k.page.click('#pick-list');
  assert.equal(await k.page.inputValue('#pl-q'), '');
});

/* ------------------------------------------- журнал приёмки */

kassa('приём без выбранного имени кассира не идёт', async (k) => {
  await k.page.click('[data-tab="intake"]');
  await k.scan('NO-NAME-1');
  assert.match(await k.flash(), /на своё имя/i);
  assert.equal(await k.state(() => sheet), null);
  assert.equal(await k.state(() => data.intakes.length), 0);
});

kassa('журнал: коробка, партия, новый товар и правка остатка — с именем и временем', async (k) => {
  await k.pickName();
  await k.page.click('[data-tab="intake"]');

  await k.scan('LOG-BOX-1');
  await k.page.click('[data-attach="g1"]');                 // коробка +1

  await k.scan(GLASS);
  await k.page.fill('#tk-qty', '10');
  await k.page.click('[data-tksave="g6"]');                 // партия +10

  await k.scan('LOG-NEW-1');
  await k.page.click('#ng-open');                           // новый товар с пикнутой коробки
  await k.page.fill('#ng-model', 'Redmi 14');
  await k.page.click('[data-ngset="mem"][data-ngval="128 ГБ"]');
  await k.page.fill('#ng-cost', '9000');
  await k.page.fill('#ng-price', '11500');
  await k.page.click('#ng-save');

  const log = await k.state(() => data.intakes.map((i) => [i.by, i.name, i.qty, i.kind, i.code]));
  assert.deepEqual(log, [
    ['Нурбек', 'iPhone 13 128 ГБ', 1, 'box', 'LOG-BOX-1'],
    ['Нурбек', 'Стекло защитное', 10, 'qty', null],
    ['Нурбек', 'Redmi 14 128 ГБ', 1, 'new-box', 'LOG-NEW-1'],
  ]);
  assert.ok(await k.state(() => data.intakes.every((i) => i.at > Date.now() - 60000)));
});

kassa('журнал: товар руками и правка остатка владельцем', { role: 'owner' }, async (k) => {
  await k.page.click('[data-tab="intake"]');
  await k.page.click('#good-new');
  await k.page.fill('#ng-model', 'Чехол прозрачный');
  await k.page.fill('#ng-cost', '100');
  await k.page.fill('#ng-price', '300');
  await k.page.fill('#ng-qty', '12');
  await k.page.click('#ng-save');
  await k.page.click('[data-edit="g6"]');
  await k.page.fill('#ed-stock', '35');                     // было 40
  await k.page.click('[data-edsave="g6"]');
  const log = await k.state(() => data.intakes.map((i) => [i.by, i.name, i.qty, i.kind]));
  assert.deepEqual(log, [['Владелец', 'Чехол прозрачный', 12, 'new'], ['Владелец', 'Стекло защитное', -5, 'fix']]);
});

kassa('журнал виден владельцу в отчёте, итог смены считает принятое', { role: 'owner' }, async (k) => {
  await k.state(() => {
    data.checks = [{ id: 'z', at: Date.now() - 500, by: 'Владелец', total: 100, cost: 40, off: 0, lines: [] }];
    data.intakes = [
      { id: 'i1', at: Date.now() - 800, by: 'Айгерим', name: 'Кабель Type-C, 1 м', qty: 10, kind: 'qty', code: null },
      { id: 'i2', at: Date.now() - 700, by: 'Нурбек', name: 'iPhone 13 128 ГБ', qty: 1, kind: 'box', code: 'X-1' },
      { id: 'i3', at: Date.now() - 600, by: 'Владелец', name: 'Стекло защитное', qty: -2, kind: 'fix', code: null },
    ];
  });
  await k.page.click('[data-tab="report"]');
  const t = await k.text();
  assert.match(t, /Приёмка/);
  assert.match(t, /Кабель Type-C, 1 м[\s\S]*Айгерим[\s\S]*партия[\s\S]*\+10 шт/);
  assert.match(t, /X-1/);
  assert.match(t, /−?-2 шт|-2 шт/);
  assert.equal(await k.state(() => shiftSummary().received), 11, 'правка остатка в «принято» не входит');
  assert.ok(await k.state(() => buildWorkbook().length > 1000));
});

kassa('журнал ограничен двумя тысячами записей', async (k) => {
  await k.pickName();
  await k.state(() => {
    data.intakes = Array.from({ length: 2000 }, (_, i) => ({ id: 'o' + i, at: 1, by: 'x', name: 'x', qty: 1, kind: 'box', code: null }));
    logIntake(good('g1'), 1, 'box', 'LAST');
  });
  assert.equal(await k.state(() => data.intakes.length), 2000);
  assert.equal(await k.state(() => data.intakes.at(-1).code), 'LAST');
});

kassa('старые данные без журнала открываются', {
  seed: { role: 'cashier', goods: [], checks: [], accounts: { owner: '', cashier: '' }, notes: [] },
}, async (k) => {
  assert.deepEqual(await k.state(() => data.intakes), []);
});

/* ------------------------------------------------------- мелочи */

kassa('программа на компьютере: копия при закрытии смены', { desk: { initial: null } }, async (k) => {
  await k.state(() => {
    data.staff = [{ id: 's1', name: 'Бакыт' }];
    data.checks.push({ id: 'x', at: Date.now() - 100, by: 'Бакыт', byId: 's1', total: 900, cost: 400, off: 0, lines: [] });
    sellerId = 's1'; tab = 'checks'; render();
  });
  assert.equal(await k.state(() => window.__backups), 0);
  await k.page.click('#shift-close');
  await k.page.click('#shift-confirm');
  assert.equal(await k.state(() => window.__backups), 1);
});

kassa('забытая смена: предупреждение после 16 часов, раньше его нет', async (k) => {
  await k.pickName();
  assert.doesNotMatch(await k.text(), /больше 16 часов/);
  await k.state(() => { data.shiftOpen.at = Date.now() - 17 * 3600e3; render(); });
  assert.match(await k.text(), /больше 16 часов/);
  await k.page.click('[data-tab="checks"]');
  assert.match(await k.text(), /больше 16 часов/);
});

kassa('программа на компьютере: индикатора интернета и офлайн-блока нет', { desk: { initial: null } }, async (k) => {
  assert.equal(await k.page.locator('#link').isVisible(), false);
  await k.state(() => { data.role = 'owner'; tab = 'more'; render(); });
  const t = await k.text();
  assert.doesNotMatch(t, /Интернет есть|Интернета нет|Офлайн/);
  assert.match(t, /Файл с данными/);
  await k.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  assert.equal(await k.page.locator('#flash').innerText(), '');
});

kassa('в браузере индикатор интернета остался', async (k) => {
  assert.equal(await k.page.locator('#link').isVisible(), true);
});
