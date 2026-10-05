'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, keyFor, keyFits, recoveryFor, recoveryFits, tidy } = require('../ключи.js');

const PRINT = 'A1B2-C3D4-E5F6';

test('tidy убирает чёрточки, пробелы и регистр', () => {
  assert.equal(tidy(' a1b2-c3d4 e5f6 '), 'A1B2C3D4E5F6');
  assert.equal(tidy(null), '');
  assert.equal(tidy(undefined), '');
});

test('fingerprint: 12 знаков тремя группами и не меняется между вызовами', () => {
  assert.match(fingerprint(), /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(fingerprint(), fingerprint());
});

test('keyFor: 20 знаков четырьмя группами из безопасного алфавита', () => {
  const key = keyFor(PRINT);
  assert.match(key, /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
  assert.ok(!/[ILOU]/.test(key), 'нет похожих знаков');
});

test('keyFor: детерминирован, не зависит от оформления отпечатка, различает машины', () => {
  assert.equal(keyFor(PRINT), keyFor(PRINT));
  assert.equal(keyFor(PRINT), keyFor('a1b2c3d4e5f6'));
  assert.notEqual(keyFor(PRINT), keyFor('A1B2-C3D4-E5F7'));
});

test('keyFits: свой ключ подходит в любом оформлении', () => {
  const key = keyFor(PRINT);
  assert.ok(keyFits(key, PRINT));
  assert.ok(keyFits(key.toLowerCase(), PRINT));
  assert.ok(keyFits(key.replace(/-/g, ' '), PRINT));
  assert.ok(keyFits(key.replace(/-/g, ''), PRINT));
});

test('keyFits: чужой, пустой и обрезанный ключ не подходят', () => {
  const other = keyFor('FFFF-FFFF-FFFF');
  assert.ok(!keyFits(other, PRINT));
  assert.ok(!keyFits('', PRINT));
  assert.ok(!keyFits(null, PRINT));
  assert.ok(!keyFits(undefined, PRINT));
  assert.ok(!keyFits('---', PRINT));
  assert.ok(!keyFits(keyFor(PRINT).slice(0, 12), PRINT));
});

test('keyFits по умолчанию сверяет с отпечатком этой машины', () => {
  assert.ok(keyFits(keyFor(fingerprint())));
  assert.ok(!keyFits(keyFor('0000-0000-0000')));
});

test('код сброса PIN: формат, детерминирован, привязан к машине', () => {
  const code = recoveryFor(PRINT);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
  assert.equal(code, recoveryFor(PRINT));
  assert.equal(code, recoveryFor('a1b2c3d4e5f6'));
  assert.notEqual(code, recoveryFor('A1B2-C3D4-E5F7'));
});

test('код сброса не равен ключу программы, и они не подменяют друг друга', () => {
  assert.notEqual(recoveryFor(PRINT), keyFor(PRINT));
  assert.ok(!keyFits(recoveryFor(PRINT), PRINT), 'сброс не открывает программу');
  assert.ok(!recoveryFits(keyFor(PRINT), PRINT), 'ключ программы не сбрасывает PIN');
});

test('recoveryFits: свой код подходит в любом оформлении, чужой, пустой и обрезанный — нет', () => {
  const code = recoveryFor(PRINT);
  assert.ok(recoveryFits(code, PRINT));
  assert.ok(recoveryFits(code.toLowerCase().replace(/-/g, ' '), PRINT));
  assert.ok(!recoveryFits(recoveryFor('FFFF-FFFF-FFFF'), PRINT));
  assert.ok(!recoveryFits('', PRINT));
  assert.ok(!recoveryFits(null, PRINT));
  assert.ok(!recoveryFits(code.slice(0, 12), PRINT));
  assert.ok(recoveryFits(recoveryFor(fingerprint())), 'по умолчанию — этот компьютер');
});
