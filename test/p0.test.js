'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeName, uniqueName, canKill } = require('../server.js');

test('sanitizeName strips markup metacharacters, controls, and format characters', () => {
  assert.equal(sanitizeName('<svg onload=1>'), 'svg onload=1');
  const img = sanitizeName('  <img src=x onerror=1>  ');
  assert.ok(!/[<>&"']/.test(img), `markup metacharacter survived: ${img}`);
  assert.ok(Array.from(img).length <= 14);
  assert.equal(sanitizeName('a\u0007b'), 'a b');
  assert.equal(sanitizeName('a\u200bb'), 'ab');
  assert.equal(sanitizeName('   '), 'Wanderer');
  assert.equal(sanitizeName('<>&"\''), 'Wanderer');
});

test('sanitizeName caps names at 14 characters and keeps unicode names', () => {
  assert.equal(sanitizeName('abcdefghijklmnopqrstuvwxyz'), 'abcdefghijklmn');
  assert.ok(Array.from(sanitizeName('🕯️🕯️🕯️🕯️🕯️🕯️🕯️🕯️')).length <= 14);
  assert.equal(sanitizeName('Bjorn the Bold'), 'Bjorn the Bold');
});

test('uniqueName suffixes duplicates without exceeding the cap', () => {
  assert.equal(uniqueName('Bram', new Set()), 'Bram');
  assert.equal(uniqueName('Bram', new Set(['Bram'])), 'Bram-2');
  assert.equal(uniqueName('Bram', new Set(['Bram', 'Bram-2'])), 'Bram-3');
  const long = uniqueName('abcdefghijklmn', new Set(['abcdefghijklmn']));
  assert.equal(long, 'abcdefghijkl-2');
  assert.ok(Array.from(long).length <= 14);
});

test('canKill is the single dark-only predicate', () => {
  assert.equal(canKill({ alive: true, fuel: 0 }), true);
  assert.equal(canKill({ alive: true, fuel: 0.001 }), false);
  assert.equal(canKill({ alive: false, fuel: 0 }), false);
  assert.equal(canKill(null), false);
});
