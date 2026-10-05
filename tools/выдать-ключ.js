'use strict';

/**
 * Выдать ключ для кассы.
 *
 * Заказчик запускает программу, видит отпечаток своего компьютера
 * и диктует его. Вы вводите здесь — получаете ключ и называете в ответ.
 *
 *   node выдать-ключ.js A1B2-C3D4-E5F6
 *
 * Без отпечатка выдаст ключ для этого компьютера — удобно для своих
 * проверок.
 *
 * Этот файл в программу не попадает: он нужен только вам.
 */

const { fingerprint, keyFor, tidy } = require('./ключи.js');

const asked = process.argv.slice(2).join('');
const print = tidy(asked) || tidy(fingerprint());

if (print.length !== 12) {
  console.log('Отпечаток — ровно 12 знаков, вроде A1B2-C3D4-E5F6.');
  console.log(`Пришло: «${asked}» — это ${print.length} знаков.`);
  process.exit(2);
}

const вид = print.replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
console.log(`Отпечаток: ${вид}${asked ? '' : '  (этот компьютер)'}`);
console.log(`Ключ:      ${keyFor(print)}`);
