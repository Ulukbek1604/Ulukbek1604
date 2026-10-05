'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { open, stop } = require('./helpers.js');

test.after(stop);

const kassa = (name, opts, fn) => {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  test(name, async () => {
    const k = await open({ role: 'none', ...opts });
    try { await fn(k); assert.deepEqual(k.errors, [], 'ошибки на странице'); }
    finally { await k.close(); }
  });
};

const press = async (k, digits) => { for (const d of digits) await k.page.click(`[data-digit="${d}"]`); };
const openPin = async (k) => {
  await k.page.click('[data-tab="more"]');
  await k.page.click('#owner-in');
};
/** Задать код владельца через интерфейс: два раза по четыре цифры. */
const setPin = async (k, code) => { await openPin(k); await press(k, code); await press(k, code); };
const stored = (k) => k.state(() => localStorage.getItem('demo-phones-v3'));

/* ------------------------------------------------------ хеш */

test('SHA-256 на странице совпадает с эталоном Node', async () => {
  const k = await open({ role: 'none' });
  try {
    for (const v of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'Телефоны и чехлы']) {
      const got = await k.state((x) => toHex(sha256(new TextEncoder().encode(x))), v);
      assert.equal(got, crypto.createHash('sha256').update(v).digest('hex'), JSON.stringify(v.slice(0, 20)));
    }
  } finally { await k.close(); }
});

kassa('запись кода: версия, соль, хеш; код открытым текстом не лежит; соль у каждой записи своя', async (k) => {
  const [a, b] = await k.state(() => [pinPack('1234'), pinPack('1234')]);
  assert.match(a, /^v1:[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.ok(!a.includes('1234'));
  assert.notEqual(a, b, 'одинаковые коды дают разные записи');
  assert.ok(await k.state((p) => pinMatches('1234', p), a));
  assert.equal(await k.state((p) => pinMatches('1235', p), a), false);
  assert.equal(await k.state(() => pinMatches('1234', '')), false);
  assert.equal(await k.state(() => pinMatches('1234', '1234')), false, 'открытый текст за запись не считается');
  assert.equal(await k.state(() => pinMatches('1234', 'v1:ab')), false);
});

kassa('код владельца, заданный в интерфейсе, в файле данных хешем', async (k) => {
  await setPin(k, '4821');
  assert.match(await k.state(() => data.accounts.owner), /^v1:/);
  assert.equal(await k.state(() => owner()), true, 'после придумывания владелец внутри');
  const raw = await stored(k);
  assert.ok(!raw.includes('4821'), 'цифр кода в файле нет');
  assert.ok(raw.includes('"v1:'));
});

/* --------------------------------------------------- вход */

kassa('верный код пускает, неверный — нет и говорит, сколько попыток осталось', async (k) => {
  await setPin(k, '4821');
  await k.page.click('#owner-out');
  await openPin(k);
  await press(k, '1111');
  assert.match(await k.flash(), /Код не подошёл\. Осталось попыток: 4/);
  assert.equal(await k.state(() => owner()), false);
  await press(k, '2222');
  assert.match(await k.flash(), /Осталось попыток: 3/);
  await press(k, '4821');
  assert.equal(await k.state(() => owner()), true);
  assert.equal(await k.state(() => data.pinLock), null, 'успех сбрасывает счётчик промахов');
});

kassa('запасного кода 1604 больше нет', async (k) => {
  await setPin(k, '4821');
  await k.page.click('#owner-out');
  await openPin(k);
  await press(k, '1604');
  assert.equal(await k.state(() => owner()), false);
  assert.equal(await k.state(() => typeof SPARE), 'undefined');
  const source = fs.readFileSync(path.join(__dirname, '..', 'kassa.html'), 'utf8');
  assert.ok(!source.includes('1604'), 'в исходнике страницы кода нет');
});

kassa('пока кода нет, 1604 тоже не пускает: сначала придумывание', async (k) => {
  await openPin(k);
  assert.match(await k.page.locator('.sheet').innerText(), /Кода ещё нет/);
  await press(k, '1604');
  assert.match(await k.page.locator('.sheet').innerText(), /Повторите код|Наберите тот же код/);
  assert.equal(await k.state(() => owner()), false);
});

kassa('смена кода владельцем: новая запись, старый код не работает', async (k) => {
  await setPin(k, '4821');
  const before = await k.state(() => data.accounts.owner);
  await k.page.click('[data-tab="more"]');
  await k.page.click('#pin-change');
  await press(k, '9090'); await press(k, '9090');
  const after = await k.state(() => data.accounts.owner);
  assert.notEqual(before, after);
  assert.ok(await k.state(() => pinMatches('9090', data.accounts.owner)));
  assert.equal(await k.state(() => pinMatches('4821', data.accounts.owner)), false);
});

/* ------------------------------------------- блокировка */

kassa('пять промахов подряд — ожидание, вход заблокирован даже верным кодом', async (k) => {
  await setPin(k, '4821');
  await k.page.click('#owner-out');
  await openPin(k);
  for (let i = 0; i < 5; i += 1) await press(k, '1111');
  assert.match(await k.flash(), /Следующая попытка через 60 с/);
  assert.ok(await k.state(() => pinWait() > 55));
  await press(k, '4821');
  assert.match(await k.flash(), /Слишком много попыток\. Подождите \d+ с/);
  assert.equal(await k.state(() => owner()), false, 'верный код во время блокировки не пускает');
  assert.equal(await k.state(() => data.pinLock.fails), 5, 'и попыткой не считается');
});

kassa('ожидание растёт вдвое каждые пять промахов, но не дольше 15 минут', async (k) => {
  const waits = await k.state(() => {
    data.pinLock = null;
    const out = [];
    for (let i = 1; i <= 45; i += 1) out.push(pinFailed());
    return out.filter((w) => w > 0).map((w) => w / 1000);
  });
  assert.deepEqual(waits, [60, 120, 240, 480, 900, 900, 900, 900, 900]);
});

kassa('блокировка переживает перезагрузку', async (k) => {
  await k.state(() => { data.accounts.owner = pinPack('4821'); for (let i = 0; i < 5; i += 1) pinFailed(); });
  await k.page.reload();
  assert.ok(await k.state(() => pinWait() > 50), 'ждать осталось, как и до перезапуска');
  assert.equal(await k.state(() => data.pinLock.fails), 5);
});

kassa('время вышло — вход снова работает, а счётчик промахов не обнуляется до успеха', async (k) => {
  await setPin(k, '4821');
  await k.page.click('#owner-out');
  await k.state(() => { for (let i = 0; i < 5; i += 1) pinFailed(); data.pinLock.until = Date.now() - 1; });
  assert.equal(await k.state(() => pinWait()), 0);
  await openPin(k);
  await press(k, '4821');
  assert.equal(await k.state(() => owner()), true);
  assert.equal(await k.state(() => data.pinLock), null);
});

kassa('кассира блокировка не касается', async (k) => {
  await k.state(() => { data.accounts.owner = pinPack('4821'); for (let i = 0; i < 5; i += 1) pinFailed(); });
  await k.page.click('[data-who="s1"]');
  await k.page.click('#shift-open');
  await k.scan('4870001234615');
  assert.equal(await k.state(() => check.length), 1);
});

/* ----------------------------------------------- перенос старых данных */

kassa('прежний открытый код в файле заменяется хешем при открытии', {
  seed: { role: 'cashier', goods: [], checks: [], notes: [], accounts: { owner: '4321', cashier: '' } },
}, async (k) => {
  assert.match(await k.state(() => data.accounts.owner), /^v1:/);
  const raw = await stored(k);
  assert.ok(!raw.includes('4321'), 'открытого кода в сохранённом файле уже нет');
  assert.ok(raw.includes('"v1:'));
  await openPin(k);
  await press(k, '4321');
  assert.equal(await k.state(() => owner()), true, 'старый код продолжает работать');
});

kassa('повреждённые учётные записи и блокировка в файле не ломают запуск', {
  seed: { role: 'cashier', goods: [], checks: [], notes: [], accounts: null, pinLock: 'мусор' },
}, async (k) => {
  assert.deepEqual(await k.state(() => [data.accounts.owner, data.pinLock]), ['', null]);
});

kassa('старые данные без блокировки: поле пустое', {
  seed: { role: 'cashier', goods: [], checks: [], notes: [], accounts: { owner: '', cashier: '' } },
}, async (k) => {
  assert.equal(await k.state(() => data.pinLock), null);
});

/* ------------------------------------------------- «Забыли код?» */

const desk = { desk: { initial: null } };

kassa('«Забыли код?» есть только в программе и только когда код уже задан', desk, async (k) => {
  await k.state(() => { data.role = 'cashier'; tab = 'more'; render(); });
  await k.page.click('#owner-in');
  assert.equal(await k.page.locator('#pin-forgot').count(), 0, 'кода ещё нет — спрашивать нечего');
  await k.page.click('.sheet [data-shut="1"]');
  await k.state(() => { data.accounts.owner = pinPack('4821'); render(); });
  await k.page.click('#owner-in');
  assert.equal(await k.page.locator('#pin-forgot').count(), 1);

  const browser = await open({ role: 'none' });
  try {
    await browser.state(() => { data.accounts.owner = pinPack('4821'); });
    await browser.page.click('[data-tab="more"]');
    await browser.page.click('#owner-in');
    assert.equal(await browser.page.locator('#pin-forgot').count(), 0, 'в демо сброса нет');
  } finally { await browser.close(); }
});

kassa('сброс: верный код возвращает к придумыванию нового, блокировка снимается', desk, async (k) => {
  await k.state(() => { data.accounts.owner = pinPack('4821'); for (let i = 0; i < 5; i += 1) pinFailed(); tab = 'more'; render(); });
  await k.page.click('#owner-in');
  await k.page.click('#pin-forgot');
  assert.match(await k.page.locator('.sheet').innerText(), /Код этого компьютера/);
  await k.page.fill('#rc-code', 'GOOD-CODE-0000');
  await k.page.click('#rc-go');
  assert.match(await k.flash(), /Код сброшен/);
  assert.equal(await k.state(() => data.accounts.owner), '');
  assert.equal(await k.state(() => data.pinLock), null);
  assert.match(await k.page.locator('.sheet').innerText(), /Кода ещё нет/);

  await press(k, '7070'); await press(k, '7070');
  assert.ok(await k.state(() => pinMatches('7070', data.accounts.owner)));
  assert.equal(await k.state(() => owner()), true);
  const saved = await k.state(() => window.__saved.at(-1));
  assert.match(saved.accounts.owner, /^v1:/);
});

kassa('сброс: неверный код ничего не меняет', desk, async (k) => {
  await k.state(() => { data.accounts.owner = pinPack('4821'); tab = 'more'; render(); });
  const before = await k.state(() => data.accounts.owner);
  await k.page.click('#owner-in');
  await k.page.click('#pin-forgot');
  await k.page.fill('#rc-code', 'NOT-THE-CODE');
  await k.page.click('#rc-go');
  assert.match(await k.flash(), /Код сброса не подошёл/);
  assert.equal(await k.state(() => data.accounts.owner), before);
  await k.page.fill('#rc-code', '');
  await k.page.click('#rc-go');
  assert.match(await k.flash(), /Код сброса не подошёл/);
});
