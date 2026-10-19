// Keeps Ask Q running in the background and starts it at boot: a systemd user service on Linux and WSL, a launchd
// agent on macOS. Nothing here needs root, except enabling "linger" so it runs without you being logged in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { P, APP, HOME } from './config.js';

const LABEL = 'dev.askq.agent';
const UNIT = path.join(os.homedir(), '.config', 'systemd', 'user', 'askq.service');
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const isMac = process.platform === 'darwin';

const which = cmd => { try { return execFileSync('which', [cmd], { encoding: 'utf8' }).trim(); } catch { return null; } };
export const claudePath = () => process.env.ASKQ_CLAUDE || which('claude') || [path.join(os.homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(f => fs.existsSync(f)) || null;

function envPath() {
  const dirs = [path.dirname(process.execPath), claudePath() && path.dirname(claudePath()), path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  return [...new Set(dirs.filter(Boolean))].join(':');
}

const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });
export const systemdAvailable = () => !isMac && run('systemctl', ['--user', 'show-environment']).status === 0;

// launchctl bootout returns before the old job is gone, and an immediate bootstrap then fails ("Bootstrap failed: 5:
// Input/output error"), leaving Ask Q stopped. Wait for the old job to disappear and retry a few times.
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function bootstrap() {
  const target = `gui/${process.getuid()}/${LABEL}`;
  for (let i = 0; i < 20 && run('launchctl', ['print', target]).status === 0; i++) sleep(250);
  let r;
  for (let i = 0; i < 5; i++) {
    r = run('launchctl', ['bootstrap', `gui/${process.getuid()}`, PLIST]);
    if (r.status === 0 || run('launchctl', ['print', target]).status === 0) return { ...r, status: 0 };
    sleep(1000);
  }
  return r;
}

export function install() {
  const cmd = [process.execPath, path.join(APP, 'src', 'daemon.js')];
  if (isMac) {
    fs.mkdirSync(path.dirname(PLIST), { recursive: true });
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    fs.writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${cmd.map(c => `<string>${esc(c)}</string>`).join('')}</array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${esc(envPath())}</string>
    <key>ASKQ_HOME</key><string>${esc(HOME)}</string>
    ${claudePath() ? `<key>ASKQ_CLAUDE</key><string>${esc(claudePath())}</string>` : ''}
  </dict>
  <key>WorkingDirectory</key><string>${esc(P.workspace)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${esc(path.join(P.logs, 'stdout.log'))}</string>
  <key>StandardErrorPath</key><string>${esc(path.join(P.logs, 'stderr.log'))}</string>
</dict></plist>
`);
    run('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`]);
    const r = bootstrap();
    if (r.status !== 0) throw new Error(`launchctl: ${r.stderr.trim()}`);
    return { kind: 'launchd', file: PLIST };
  }
  if (!systemdAvailable()) throw new Error('systemd is not available. On WSL, enable it: add "[boot]\\nsystemd=true" to /etc/wsl.conf and run "wsl --shutdown" from Windows. Or run Ask Q in the foreground with: askq run');
  fs.mkdirSync(path.dirname(UNIT), { recursive: true });
  fs.writeFileSync(UNIT, `[Unit]
Description=Ask Q — your own assistant
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${cmd.map(c => `"${c}"`).join(' ')}
WorkingDirectory=${P.workspace}
Environment=PATH=${envPath()}
Environment=ASKQ_HOME=${HOME}
${claudePath() ? `Environment=ASKQ_CLAUDE=${claudePath()}\n` : ''}Restart=always
RestartSec=5
NoNewPrivileges=yes
UMask=0077

[Install]
WantedBy=default.target
`);
  run('systemctl', ['--user', 'daemon-reload']);
  const r = run('systemctl', ['--user', 'enable', '--now', 'askq.service']);
  if (r.status !== 0) throw new Error(`systemctl: ${r.stderr.trim()}`);
  // Keep running after logout / at boot without logging in.
  const linger = run('loginctl', ['enable-linger', os.userInfo().username]);
  return { kind: 'systemd', file: UNIT, linger: linger.status === 0 };
}

export function control(action) {
  if (isMac) {
    const target = `gui/${process.getuid()}/${LABEL}`;
    if (action === 'stop') return run('launchctl', ['bootout', target]);
    if (action === 'start') return bootstrap();
    if (action === 'restart') return run('launchctl', ['kickstart', '-k', target]);
    return run('launchctl', ['print', target]);
  }
  return run('systemctl', ['--user', action === 'status' ? 'is-active' : action, 'askq.service']);
}

export function installed() { return fs.existsSync(isMac ? PLIST : UNIT); }

export function uninstall() {
  if (isMac) { run('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`]); fs.rmSync(PLIST, { force: true }); }
  else { run('systemctl', ['--user', 'disable', '--now', 'askq.service']); fs.rmSync(UNIT, { force: true }); run('systemctl', ['--user', 'daemon-reload']); }
}
