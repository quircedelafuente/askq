// Where the one-time pages (website sign-in, secret forms) are reachable from your phone.
//  · With Tailscale: the Ask Q address on your tailnet (only your devices).
//  · Without it: a temporary Cloudflare quick tunnel (https://<random>.trycloudflare.com, no account needed) to a
//    separate local server that serves ONLY those pages — never /ask or /internal. It closes 15 minutes after the
//    last link. The pages are protected by their unguessable, expiring id.
//  · If the tunnel can't start: http://127.0.0.1:<port>, which only works on this machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { P, loadConfig, logger } from './config.js';

const log = logger('links');
const IDLE_MS = 16 * 60_000;
let pages = null, tunnel = null, idle = null;
process.on('exit', () => tunnel?.proc.kill());   // never leave a tunnel behind

const which = c => { try { return execFileSync('which', [c], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const BIN = path.join(P.state, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

// cloudflared from PATH, or downloaded once from Cloudflare's GitHub releases into ~/.askq/state/bin.
function cloudflared() {
  const found = which('cloudflared') || (fs.existsSync(BIN) ? BIN : null);
  if (found) return found;
  const arch = { arm64: 'arm64', x64: 'amd64' }[process.arch];
  if (!arch || !['linux', 'darwin'].includes(process.platform)) return null;
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
  fs.mkdirSync(path.dirname(BIN), { recursive: true, mode: 0o700 });
  log('DOWNLOAD', 'cloudflared');
  if (process.platform === 'linux') {
    const r = spawnSync('curl', ['-fsSL', '-o', BIN, `${base}cloudflared-linux-${arch}`], { timeout: 120_000 });
    if (r.status !== 0) return null;
  } else {
    const tgz = path.join(os.tmpdir(), `cloudflared-${process.pid}.tgz`);
    const r = spawnSync('curl', ['-fsSL', '-o', tgz, `${base}cloudflared-darwin-${arch}.tgz`], { timeout: 120_000 });
    if (r.status !== 0 || spawnSync('tar', ['-xzf', tgz, '-C', path.dirname(BIN)]).status !== 0) return null;
    fs.rmSync(tgz, { force: true });
  }
  fs.chmodSync(BIN, 0o755);
  return BIN;
}

function startPages(handle) {
  return new Promise((resolve, reject) => {
    const s = http.createServer(async (req, res) => {
      try { if (!await handle(req, res, new URL(req.url, 'http://x'))) { res.writeHead(404); res.end('not found'); } }
      catch (e) { log('PAGE-ERROR', e.message); res.writeHead(500); res.end('error'); }
    });
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

function startTunnel(bin, port) {
  return new Promise(resolve => {
    const p = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const done = url => { clearTimeout(timer); resolve(url ? { proc: p, origin: url } : null); };
    const timer = setTimeout(() => { p.kill(); done(null); }, 45_000);
    // Ready when it has its address and a live connection to Cloudflare.
    const onData = d => { out += d; const m = out.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m && /Registered tunnel connection/.test(out)) done(m[0]); };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('exit', () => { if (tunnel?.proc === p) tunnel = null; done(null); });
    p.on('error', () => done(null));
  });
}

// A brand-new trycloudflare name takes a few seconds to exist in DNS, and a phone that looks it up too early caches
// "not found" for a while. Wait until Cloudflare's public DNS knows it (asked over HTTPS, so this machine's own
// resolver doesn't cache the miss either).
async function dnsReady(origin) {
  const host = new URL(origin).hostname;
  for (const end = Date.now() + 40_000; Date.now() < end; await new Promise(r => setTimeout(r, 2000))) {
    const j = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) })
      .then(r => r.json()).catch(() => null);
    if (j?.Answer?.length) return true;
  }
  return false;
}

function stop() {
  tunnel?.proc.kill(); tunnel = null;
  pages?.close(); pages = null;
  log('TUNNEL', 'closed');
}

// The base URL for a one-time page. `handle(req, res, url)` serves the pages (used by the tunnel's own server).
export async function origin(handle) {
  const c = loadConfig();
  if (c.url) return { origin: new URL(c.url).origin, via: 'tailscale' };
  clearTimeout(idle);
  idle = setTimeout(stop, IDLE_MS);
  idle.unref?.();
  if (tunnel) return { origin: tunnel.origin, via: 'tunnel' };
  const bin = cloudflared();
  if (bin) {
    pages ||= await startPages(handle);
    tunnel = await startTunnel(bin, pages.address().port);
    if (tunnel) {
      await dnsReady(tunnel.origin);
      await new Promise(r => setTimeout(r, 3000));   // and a moment for other resolvers to catch up
      log('TUNNEL', tunnel.origin);
      return { origin: tunnel.origin, via: 'tunnel' };
    }
  }
  log('TUNNEL-FAIL', bin ? 'no URL from cloudflared' : 'cloudflared not available');
  return { origin: `http://127.0.0.1:${c.port}`, via: 'local' };
}
