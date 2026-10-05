'use strict';

/**
 * Ключ программы.
 *
 * Касса привязывается к компьютеру: по отпечатку машины считается ключ,
 * и только он эту кассу открывает. Скопировали папку на другой
 * компьютер — отпечаток другой, ключ не подходит.
 *
 * Чего это НЕ делает: не спасает от того, кто разберёт программу и
 * вытащит отсюда тайную строку. Такой человек наделает ключей сам.
 * От этого помогает только проверка на сервере, а её у кассы нет —
 * она работает без интернета. Задача здесь скромнее и честнее:
 * не дать переставить программу в соседний магазин одной флешкой.
 *
 * Этот файл нужен и программе (проверить ключ), и мне (выдать ключ).
 * Поэтому он один на двоих: разъедутся — выданные ключи перестанут
 * подходить.
 */

const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

/** Строка известна только мне. Менять нельзя: все выданные ключи умрут. */
const SECRET = 'pNb4Shs4r4FzQq0fwQDDiAI1+RcEl9Nkc2DDovPFb/A=';

/**
 * Алфавит без похожих знаков.
 *
 * Ключ диктуют по телефону, поэтому ни нуля с буквой O, ни единицы
 * с I и L в нём нет: иначе половина звонков уйдёт на «это О или ноль».
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Сравнивать без оглядки на чёрточки, пробелы и регистр. */
const tidy = (s) => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * Чем этот компьютер отличается от других.
 *
 * MachineGuid Windows заводит при установке и больше не трогает: он
 * переживает смену имени компьютера, замену диска и обновления. Если
 * до него не достучаться — собираем отпечаток из того, что есть.
 */
function machineId() {
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'latin1', windowsHide: true, timeout: 5000 },
    );
    const found = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
    if (found) return found[1];
  } catch (error) { /* ниже запасной путь */ }

  return [os.hostname(), os.cpus()[0]?.model ?? '', os.totalmem()].join('|');
}

/** Отпечаток, который человек диктует мне: 12 знаков тремя группами. */
function fingerprint() {
  const hash = crypto.createHash('sha256').update(machineId()).digest('hex').toUpperCase();
  return hash.slice(0, 12).replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
}

/** Ключ под этот отпечаток: 20 знаков четырьмя группами. */
function keyFor(print) {
  const mac = crypto.createHmac('sha256', SECRET).update(tidy(print)).digest();
  let out = '';
  // 256 делится на 32 без остатка, поэтому знаки выпадают поровну.
  for (let i = 0; i < 20; i += 1) out += ALPHABET[mac[i] % ALPHABET.length];
  return out.replace(/(.{5})(.{5})(.{5})(.{5})/, '$1-$2-$3-$4');
}

/**
 * Мой код. Открывает любой компьютер.
 *
 * Нужен, когда программу ставлю я сам и звонить самому себе за ключом
 * глупо. Плата за удобство: код один на все машины, и тот, кто увидит,
 * как я его набираю, поставит кассу где захочет. Поэтому набирать его
 * лучше не на глазах, а для чужих рук остаётся ключ под отпечаток.
 *
 * В файл этот код не записывается: после него сохраняется обычный ключ
 * этой машины, чтобы код не валялся на чужом компьютере.
 */
const MASTER = '31322005';

/** Подходит ли ключ этому компьютеру. */
function keyFits(key, print = fingerprint()) {
  const given = tidy(key);
  if (given === '') return false;
  return given === tidy(MASTER) || given === tidy(keyFor(print));
}

module.exports = { fingerprint, keyFor, keyFits, tidy };
