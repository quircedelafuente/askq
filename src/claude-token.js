// Picks the token out of what `claude setup-token` printed (used by askq setup).
// The token may be wrapped over several lines by the terminal; join the lines that are only token characters.
export function findToken(text) {
  const clean = text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r+\n?/g, '\n');
  const at = clean.lastIndexOf('sk-ant-');
  if (at < 0) return '';
  const [first, ...rest] = clean.slice(at).split('\n');
  let token = (first.match(/^[A-Za-z0-9_-]+/) || [''])[0];
  if (token.length === first.trimEnd().length) for (const l of rest) {
    const t = l.trim();
    if (!t) break;
    if (!/^[A-Za-z0-9_-]+$/.test(t)) break;
    token += t;
  }
  return token.length > 40 ? token : '';
}
