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

const IPHONE = '4870001234561';   // g1: 67 000, закуп 58 000, штучный, остаток 3
const GLASS = '4870001234615';    // g6: 300, закуп 90, остаток 40

/** Кассир Нурбек открыл смену и продал: коды пикаются по очереди, потом «Продать». */
async function sell(k, codes, { start = true } = {}) {
  if (start) await k.pickName();
  for (const c of codes) await k.scan(c);
  await k.page.click('#sell >> nth=0');
  const id = await k.state(() => data.checks.at(-1).id);
  await k.state(() => { sheet = null; render(); });
  return id;
}

const openReturn = async (k, id) => {
  await k.state((x) => { sheet = { k: 'receipt', id: x }; render(); }, id);
  await k.page.click('#ret-open');
};

/* ------------------------------------------------------ штучный товар */

kassa('возврат телефона по IMEI: остаток растёт, коробка снова в продаже', async (k) => {
  const id = await sell(k, [IPHONE]);
  assert.equal(await k.state(() => good('g1').stock), 2);
  assert.ok(await k.state((c) => !!data.sold[c], IPHONE));

  await openReturn(k, id);
  await k.page.click(`[data-retcode="0"][data-code="${IPHONE}"]`);
  assert.match(await k.page.locator('.sheet').innerText(), /67\s?000/);
  await k.page.click('#ret-confirm');
  assert.match(await k.flash(), /верните покупателю 67\s?000/);

  assert.equal(await k.state(() => good('g1').stock), 3);
  assert.equal(await k.state((c) => !!data.sold[c], IPHONE), false);
  const r = await k.state(() => data.checks.at(-1));
  assert.equal(r.kind, 'return');
  assert.equal(r.total, -67000);
  assert.equal(r.cost, -58000);
  assert.equal(r.by, 'Нурбек');
  assert.equal(r.lines[0].qty, -1);
  assert.deepEqual(r.lines[0].codes, [IPHONE]);

  // можно продать снова
  await k.state(() => { sheet = null; render(); });
  await k.scan(IPHONE);
  assert.equal(await k.state(() => check[0].codes[0]), IPHONE);
});

kassa('одну коробку нельзя вернуть дважды', async (k) => {
  const id = await sell(k, [IPHONE]);
  await openReturn(k, id);
  await k.page.click(`[data-retcode="0"][data-code="${IPHONE}"]`);
  await k.page.click('#ret-confirm');
  await k.state((x) => { sheet = { k: 'receipt', id: x }; render(); }, id);
  assert.equal(await k.page.locator('#ret-open').count(), 0, 'кнопки возврата больше нет');
  assert.match(await k.page.locator('.sheet').innerText(), /возвращено 1 шт/);
  assert.equal(await k.state((x) => checkLeft(data.checks.find((c) => c.id === x)), id), 0);
});

kassa('несколько телефонов в чеке: возвращается только отмеченный', async (k) => {
  await k.state(() => { good('g1').codes.push('IMEI-2'); });
  const id = await sell(k, [IPHONE, 'IMEI-2']);
  await openReturn(k, id);
  await k.page.click('[data-retcode="0"][data-code="IMEI-2"]');
  await k.page.click('#ret-confirm');
  assert.equal(await k.state(() => good('g1').stock), 2);   // было 3, продано 2 → 1, вернули 1 → 2
  assert.ok(await k.state(() => !!data.sold['4870001234561']), 'вторая коробка осталась проданной');
  assert.equal(await k.state(() => !!data.sold['IMEI-2']), false);
  const orig = await k.state((x) => data.checks.find((c) => c.id === x), id);
  assert.equal(orig.lines[0].ret, 1);
  assert.deepEqual(orig.lines[0].retCodes, ['IMEI-2']);
  assert.equal(orig.refunded, 67000);
});

/* ------------------------------------------------------ обычный товар */

kassa('возврат части штук без кода: счётчик не выше проданного', async (k) => {
  const id = await sell(k, [GLASS, GLASS, GLASS]);
  assert.equal(await k.state(() => good('g6').stock), 37);
  await openReturn(k, id);
  for (let i = 0; i < 5; i += 1) await k.page.click('[data-retmore="0"]');
  assert.equal(await k.state(() => retPick[0].n), 3, 'выше трёх не поднимается');
  await k.page.click('[data-retless="0"]');
  assert.equal(await k.state(() => retPick[0].n), 2);
  await k.page.click('#ret-confirm');
  assert.equal(await k.state(() => good('g6').stock), 39);
  assert.equal(await k.state(() => data.checks.at(-1).total), -600);
  await k.state((x) => { sheet = { k: 'receipt', id: x }; render(); }, id);
  assert.equal(await k.page.locator('#ret-open').count(), 1, 'одна штука ещё не возвращена');
});

kassa('нельзя оформить пустой возврат', async (k) => {
  const id = await sell(k, [GLASS]);
  await openReturn(k, id);
  await k.page.click('#ret-confirm');
  assert.match(await k.flash(), /Отметьте, что возвращают/);
  assert.equal(await k.state(() => data.checks.filter((c) => c.kind === 'return').length), 0);
});

/* ---------------------------------------------------------- деньги */

kassa('скидка на позицию и на весь чек возвращаются пропорционально', async (k) => {
  await k.pickName();
  await k.scan(GLASS); await k.scan(GLASS);   // 2 × 300 = 600
  await k.scan('4870001234622');              // кабель 400
  await k.state(() => { check.find((l) => l.id === 'g6').off = 100; checkOff = 100; render(); });
  // сумма 1000, скидки: 100 по строке + 100 на чек → к оплате 800
  await k.page.click('#sell >> nth=0');
  const id = await k.state(() => data.checks.at(-1).id);
  assert.equal(await k.state(() => data.checks.at(-1).total), 800);
  await k.state(() => { sheet = null; render(); });

  await openReturn(k, id);
  await k.page.click('[data-retmore="1"]');   // кабель: 400, на него приходится 400/900 от скидки 100
  const refund = await k.state((x) => returnQuote(data.checks.find((c) => c.id === x)).refund, id);
  assert.equal(refund, 400 - Math.round(100 * 400 / 900));  // 356
  await k.page.click('#ret-confirm');
  assert.equal(await k.state(() => data.checks.at(-1).total), -356);
});

kassa('вернули всё по частям: сумма возвратов ровно равна чеку, без копеечной разницы', async (k) => {
  await k.pickName();
  await k.scan(GLASS); await k.scan(GLASS); await k.scan(GLASS);
  await k.state(() => { checkOff = 100; render(); });   // 900 − 100 = 800, на штуку 266,67
  await k.page.click('#sell >> nth=0');
  const id = await k.state(() => data.checks.at(-1).id);
  await k.state(() => { sheet = null; render(); });
  for (let i = 0; i < 3; i += 1) {
    await openReturn(k, id);
    await k.page.click('[data-retmore="0"]');
    await k.page.click('#ret-confirm');
    await k.state(() => { sheet = null; render(); });
  }
  const refunds = await k.state(() => data.checks.filter((c) => c.kind === 'return').map((c) => -c.total));
  assert.equal(refunds.reduce((a, b) => a + b, 0), 800);
  assert.equal(await k.state((x) => data.checks.find((c) => c.id === x).refunded, id), 800);
  assert.equal(await k.state(() => good('g6').stock), 40);
});

/* -------------------------------------------------------- отчёты */

kassa('выручка, прибыль и чеки смены учитывают возврат', async (k) => {
  const id = await sell(k, [IPHONE, GLASS]);       // 67 300, закуп 58 090
  await openReturn(k, id);
  await k.page.click(`[data-retcode="0"][data-code="${IPHONE}"]`);
  await k.page.click('#ret-confirm');
  const r = await k.state(() => shiftSummary());
  assert.equal(r.revenue, 300);
  assert.equal(r.cost, 90);
  assert.equal(r.profit, 210);
  assert.equal(r.checks, 1, 'возврат не считается чеком продажи');
  assert.equal(r.returns, 1);
  assert.equal(r.refunds, 67000);
  assert.equal(r.units, 1);
  assert.deepEqual(r.items.map((i) => i.name), ['Стекло защитное']);
  assert.equal(r.avg, 67300);
});

kassa('итог закрытия называет возвраты', async (k) => {
  const id = await sell(k, [GLASS, GLASS]);
  await openReturn(k, id);
  await k.page.click('[data-retmore="0"]');
  await k.page.click('#ret-confirm');
  await k.state(() => { sheet = null; tab = 'checks'; render(); });
  await k.page.click('#shift-close');
  const t = await k.page.locator('.sheet').innerText();
  assert.match(t, /Возвраты: 1 на 300/);
  await k.page.click('#shift-confirm');
  const rec = await k.state(() => data.shifts[0]);
  assert.equal(rec.revenue, 300);
  assert.equal(rec.returns, 1);
  assert.match(await k.state((r) => shiftText({ ...r }), rec), /Возвраты: 1 на 300/);
});

kassa('«Кто сколько продал» и «Мои чеки» показывают возврат', async (k) => {
  const id = await sell(k, [GLASS, GLASS]);
  await openReturn(k, id);
  await k.page.click('[data-retmore="0"]');
  await k.page.click('#ret-confirm');
  await k.state(() => { sheet = null; tab = 'checks'; render(); });
  const t = await k.text();
  assert.match(t, /возврат/i);
  assert.match(t, /на руках/);
  assert.equal(await k.state(() => salesOnly(mine()).length), 1);
  await k.state(() => { data.role = 'owner'; tab = 'report'; render(); });
  assert.match(await k.text(), /Нурбек\s+1 чек, 1 шт, возвратов: 1/);
});

kassa('выгрузка Excel с возвратом собирается', async (k) => {
  const id = await sell(k, [GLASS]);
  await openReturn(k, id);
  await k.page.click('[data-retmore="0"]');
  await k.page.click('#ret-confirm');
  assert.ok(await k.state(() => buildWorkbook().length > 1000));
});

/* ---------------------------------------------- правила и поиск */

kassa('возврат нужно оформлять в открытой смене и под своим именем', async (k) => {
  const id = await sell(k, [GLASS]);
  await k.state(() => { data.shiftOpen = null; });
  await k.state((x) => { sheet = { k: 'receipt', id: x }; render(); }, id);
  await k.page.click('#ret-open');
  assert.match(await k.flash(), /откройте смену/i);
  await k.state(() => { data.shiftOpen = { at: Date.now(), by: 'Нурбек', byId: 's1' }; sellerId = null; });
  await k.state((x) => { sheet = { k: 'receipt', id: x }; render(); }, id);
  await k.page.click('#ret-open');
  assert.match(await k.flash(), /на своё имя/i);
});

kassa('старше 14 дней: кассиру нельзя, владельцу можно', async (k) => {
  const id = await sell(k, [GLASS]);
  await k.state((x) => { data.checks.find((c) => c.id === x).at = Date.now() - 15 * 86400e3; }, id);
  await k.state((x) => { sheet = { k: 'receipt', id: x }; render(); }, id);
  await k.page.click('#ret-open');
  assert.match(await k.flash(), /больше 14 дней/);
  assert.equal(await k.state(() => sheet.k), 'receipt');

  await k.state(() => { data.role = 'owner'; render(); });
  await k.page.click('#ret-open');
  assert.equal(await k.state(() => sheet.k), 'return');
});

kassa('поиск чека по IMEI, названию и «ничего не нашлось»', async (k) => {
  await sell(k, [IPHONE]);
  await k.state(() => { sheet = null; tab = 'checks'; render(); });
  await k.page.fill('#chk-q', IPHONE.slice(-6));
  assert.match(await k.text(), /iPhone 13/);
  await k.page.fill('#chk-q', 'iphone');
  assert.match(await k.text(), /iPhone 13/);
  await k.page.fill('#chk-q', 'нет такого');
  assert.match(await k.text(), /Ничего не нашлось/);
  await k.page.fill('#chk-q', '');
  await k.page.click('[data-receipt]');
  assert.equal(await k.page.locator('#ret-open').count(), 1);
});

kassa('поиск находит старые чеки, чек возврата сам возвращать нельзя', async (k) => {
  const id = await sell(k, [GLASS]);
  await openReturn(k, id);
  await k.page.click('[data-retmore="0"]');
  await k.page.click('#ret-confirm');
  // открыт чек возврата: кнопки возврата нет, подпись «Возврат»
  const t = await k.page.locator('.sheet').innerText();
  assert.match(t, /Возврат № /);
  assert.match(t, /по чеку №/);
  assert.match(t, /Вернули покупателю/);
  assert.equal(await k.page.locator('#ret-open').count(), 0);
  await k.state(() => { sheet = null; tab = 'checks'; render(); });
  assert.match(await k.text(), /всё возвращено/);
});

kassa('старый чек без id и закупки в строках: товар находится по названию', async (k) => {
  await k.state(() => {
    data.staff = [{ id: 's1', name: 'Нурбек' }];
    data.checks.push({ id: 'c5', at: Date.now() - 3600e3, by: 'Нурбек', total: 300, cost: 90, off: 0,
      lines: [{ name: 'Стекло защитное', price: 300, qty: 1, off: 0, codes: [] }] });
  });
  await k.pickName();
  await openReturn(k, 'c5');
  await k.page.click('[data-retmore="0"]');
  await k.page.click('#ret-confirm');
  assert.equal(await k.state(() => good('g6').stock), 41);
  assert.equal(await k.state(() => data.checks.at(-1).cost), -90);
});

kassa('возврат переживает перезагрузку', async (k) => {
  const id = await sell(k, [IPHONE]);
  await openReturn(k, id);
  await k.page.click(`[data-retcode="0"][data-code="${IPHONE}"]`);
  await k.page.click('#ret-confirm');
  await k.page.reload();
  assert.equal(await k.state(() => data.checks.filter((c) => c.kind === 'return').length), 1);
  assert.equal(await k.state(() => good('g1').stock), 3);
  assert.equal(await k.state((c) => !!data.sold[c], IPHONE), false);
});
