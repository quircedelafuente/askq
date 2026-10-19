import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

process.env.ASKQ_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'askq-secret-'));
const { P, readJSON } = await import('../src/config.js');
const secretPage = await import('../src/secret-page.js');

fs.mkdirSync(path.join(P.tools, 'gym'), { recursive: true });
const readBody = async req => { let b = ''; for await (const c of req) b += c; return b; };
const server = http.createServer(async (req, res) => { if (!await secretPage.handle(req, res, new URL(req.url, 'http://x'), readBody)) { res.writeHead(404); res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.closeAllConnections(); server.close(); });

test('secret form: saves straight to the tool secrets, once', async () => {
  let ended;
  const { id } = secretPage.startSecret('gym', ['PASSWORD'], { note: 'your gym login', onEnd: (st, keys) => { ended = [st, keys]; } });
  const page = await (await fetch(`${base}/secret/${id}`)).text();
  assert.match(page, /name="PASSWORD"/);
  assert.match(page, /your gym login/);
  const r = await fetch(`${base}/secret/${id}`, { method: 'POST', body: JSON.stringify({ values: { PASSWORD: 's3cret' } }) });
  assert.equal(r.status, 204);
  assert.equal(readJSON(path.join(P.secrets, 'gym.json'), {}).PASSWORD, 's3cret');
  assert.deepEqual(ended, ['saved', ['PASSWORD']]);
  assert.equal((await fetch(`${base}/secret/${id}`)).status, 404);   // one use only
});

test('secret form: refuses unknown tools, bad key names and empty values', async () => {
  assert.throws(() => secretPage.startSecret('nope', ['PASSWORD']), /No tool/);
  assert.throws(() => secretPage.startSecret('gym', ['password']), /CAPITALS/);
  const { id } = secretPage.startSecret('gym', ['API_KEY']);
  assert.equal((await fetch(`${base}/secret/${id}`, { method: 'POST', body: JSON.stringify({ values: {} }) })).status, 400);
  assert.equal((await fetch(`${base}/secret/${'0'.repeat(48)}`)).status, 404);
});
