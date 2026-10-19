// The Ask Q header: the logo in neon, switched on like a neon tube (off → flicker → on) in a terminal.
const ON = { G: '\x1b[38;2;236;255;143m', N: '\x1b[38;2;198;247;0m', S: '\x1b[38;2;127;163;0m', Y: '\x1b[38;2;138;138;134m' };
const DARK = '\x1b[38;2;58;58;54m', OFF = { G: DARK, N: DARK, S: DARK, Y: DARK };
const _B = '\x1b[1m', _R = '\x1b[0m';

const lines = ({ G: _G, N: _N, S: _S, Y: _Y }) => [
  `  ${_B}${_G}     ▄▄▄██████▄▄        ${_R}`,
  `  ${_B}${_G}   ▄██████████████▄     ${_R}`,
  `  ${_B}${_G} ▄████████▀▀███████▄    ${_R}`,
  `  ${_B}${_N} █████▀       ▀██████   ${_R}    ${_B}${_S} ${_R}${_B}${_N}█████${_R}${_B}${_S}╗ ${_R}${_B}${_N}███████${_R}${_B}${_S}╗${_R}${_B}${_N}██${_R}${_B}${_S}╗  ${_R}${_B}${_N}██${_R}${_B}${_S}╗    ${_R}${_B}${_N}██████${_R}${_B}${_S}╗ ${_R}`,
  `  ${_B}${_N}██████          █████   ${_R}    ${_B}${_N}██${_R}${_B}${_S}╔══${_R}${_B}${_N}██${_R}${_B}${_S}╗${_R}${_B}${_N}██${_R}${_B}${_S}╔════╝${_R}${_B}${_N}██${_R}${_B}${_S}║ ${_R}${_B}${_N}██${_R}${_B}${_S}╔╝   ${_R}${_B}${_N}██${_R}${_B}${_S}╔═══${_R}${_B}${_N}██${_R}${_B}${_S}╗${_R}`,
  `  ${_B}${_N}█████    ▄▄▄▄▄▄▄█████   ${_R}    ${_B}${_N}███████${_R}${_B}${_S}║${_R}${_B}${_N}███████${_R}${_B}${_S}╗${_R}${_B}${_N}█████${_R}${_B}${_S}╔╝    ${_R}${_B}${_N}██${_R}${_B}${_S}║   ${_R}${_B}${_N}██${_R}${_B}${_S}║${_R}`,
  `  ${_B}${_N}██████    ▀██████████   ${_R}    ${_B}${_N}██${_R}${_B}${_S}╔══${_R}${_B}${_N}██${_R}${_B}${_S}║╚════${_R}${_B}${_N}██${_R}${_B}${_S}║${_R}${_B}${_N}██${_R}${_B}${_S}╔═${_R}${_B}${_N}██${_R}${_B}${_S}╗    ${_R}${_B}${_N}██${_R}${_B}${_S}║${_R}${_B}${_N}▄▄ ██${_R}${_B}${_S}║${_R}`,
  `  ${_B}${_N} ██████▄   ▀████████▀   ${_R}    ${_B}${_N}██${_R}${_B}${_S}║  ${_R}${_B}${_N}██${_R}${_B}${_S}║${_R}${_B}${_N}███████${_R}${_B}${_S}║${_R}${_B}${_N}██${_R}${_B}${_S}║  ${_R}${_B}${_N}██${_R}${_B}${_S}╗   ╚${_R}${_B}${_N}██████${_R}${_B}${_S}╔╝${_R}`,
  `  ${_B}${_N}  ▀█████████ ███████    ${_R}    ${_B}${_S}╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝    ╚══${_R}${_B}${_N}▀▀${_R}${_B}${_S}═╝ ${_R}`,
  `  ${_B}${_N}    ▀███████▄ ▀█████▄   ${_R}`,
  `  ${_B}${_S}       ▀▀▀▀▀▀  ▀██████  ${_R}`,
  `  ${_B}${_S}                 ██████▄${_R}`,
  '',
  `${_Y}                              Siri · WhatsApp · Telegram  →  your AI  →  your tools${_R}`,
].join('\n') + '\n';

const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function banner() {
  const out = process.stdout;
  out.write('\n');
  if (!out.isTTY) return out.write(lines(ON) + '\n');
  const up = `\x1b[${lines(ON).split('\n').length - 1}A`;
  out.write('\x1b[?25l' + lines(OFF)); await sleep(120);
  for (const t of [60, 50, 90]) { out.write(up + lines(ON)); await sleep(t); out.write(up + lines(OFF)); await sleep(40); }
  out.write(up + lines(ON) + '\x1b[?25h\n');
}
