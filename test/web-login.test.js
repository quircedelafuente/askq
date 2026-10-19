import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ASKQ_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'askq-login-'));
const { P } = await import('../src/config.js');
const { loginSpec } = await import('../src/web-login.js');

const tool = (name, login) => {
  fs.mkdirSync(path.join(P.tools, name), { recursive: true });
  fs.writeFileSync(path.join(P.tools, name, 'package.json'), JSON.stringify({ name, askq: login ? { login } : undefined }));
};

test('login spec: state path resolved inside the tool folder', () => {
  tool('site', { url: 'https://example.com/login', check: 'https://example.com/me' });
  assert.equal(loginSpec('site').state, path.join(P.tools, 'site', '.auth', 'state.json'));
});

test('login spec: no login declared, or a state path outside the folder, is refused', () => {
  tool('plain');
  assert.throws(() => loginSpec('plain'), /no login page/);
  tool('escape', { url: 'https://example.com', state: '../../env' });
  assert.throws(() => loginSpec('escape'), /inside the tool folder/);
});
