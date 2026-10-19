// Updates: Ask Q is a git clone of github.com/quircedelafuente/askq (~/.askq/app). check() looks for new commits on
// its branch; apply() fast-forwards to them and installs packages. The service checks every 12 hours and, unless
// "autoUpdate": false in config.json, applies them when it's not busy and restarts itself (systemd/launchd start it again).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { APP } from './config.js';

const git = (...a) => spawnSync('git', ['-C', APP, ...a], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

export function check() {
  if (!fs.existsSync(path.join(APP, '.git'))) return { ok: false, why: `${APP} is not a git clone; reinstall with the installer to get updates.` };
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim() || 'main';
  const f = git('fetch', '--quiet', 'origin', branch);
  if (f.status !== 0) return { ok: false, why: `Could not reach GitHub: ${(f.stderr || '').trim().slice(-200)}` };
  const current = git('rev-parse', '--short', 'HEAD').stdout.trim();
  const log = git('log', '--format=%s', `HEAD..origin/${branch}`).stdout.trim();
  const changes = log ? log.split('\n') : [];
  return { ok: true, branch, current, behind: changes.length, changes };
}

export function apply() {
  const c = check();
  if (!c.ok || !c.behind) return { ...c, updated: false };
  git('checkout', '--quiet', '--', 'package-lock.json');   // npm may have rewritten it; it's not a user change
  if (git('status', '--porcelain', '--untracked-files=no').stdout.trim()) return { ...c, ok: false, updated: false, why: `There are local changes in ${APP}; not touching them. Update by hand: git -C ${APP} pull` };
  const p = git('pull', '--ff-only', '--quiet', 'origin', c.branch);
  if (p.status !== 0) return { ...c, ok: false, updated: false, why: `git pull failed: ${(p.stderr || '').trim().slice(-300)}` };
  const n = spawnSync('npm', ['install', '--omit=dev', '--no-fund', '--no-audit', '--quiet'], { cwd: APP, encoding: 'utf8', timeout: 10 * 60_000 });
  if (n.status !== 0) return { ...c, ok: false, updated: true, why: `Updated the code, but npm install failed: ${(n.stderr || '').trim().slice(-300)}` };
  // New built-in functions must be classified (read-only or "needs yes") before the guard sees them.
  spawnSync(process.execPath, [path.join(APP, 'bin', 'askq.js'), 'tools', 'sync'], { stdio: 'ignore', timeout: 5 * 60_000 });
  return { ...c, updated: true, now: git('rev-parse', '--short', 'HEAD').stdout.trim() };
}

// What the user reads: the commit subjects, trimmed.
export const describe = changes => changes.slice(0, 8).map(s => `• ${s.length > 120 ? s.slice(0, 117) + '…' : s}`).join('\n') + (changes.length > 8 ? `\n• …and ${changes.length - 8} more` : '');
