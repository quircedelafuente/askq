import test from 'node:test';
import assert from 'node:assert/strict';
import { findToken } from '../src/claude-token.js';

const tok = 'sk-ant-oat01-' + 'Ab3_x-'.repeat(15) + 'Zz9';

test('finds a token on one line', () => {
  assert.equal(findToken(`Your token:\r\n\x1b[1m${tok}\x1b[0m\r\n\r\nStore this token securely.`), tok);
});

test('joins a token wrapped by the terminal', () => {
  const wrapped = tok.match(/.{1,40}/g).join('\r\r\n');
  assert.equal(findToken(`✓ Long-lived token created\n\n${wrapped}\n\nStore this token securely. You won't see it again.`), tok);
});

test('returns nothing without a token', () => {
  assert.equal(findToken('Login cancelled'), '');
  assert.equal(findToken('see sk-ant- docs'), '');
});
