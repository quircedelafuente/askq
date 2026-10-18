// Confirmation: an action with real effects (paying, booking, sending to someone else…) only goes through if the
// assistant's last reply asked a question and what you say next is a short "yes". Ask Q decides this from what YOU
// said, not from what the model says, so an email or web page with hidden instructions cannot fake your "yes".
// "Yes" = a short phrase that starts with an affirmation ("yes", "ok, send it", "sí", "vale"…) or a lone verb
// ("send it", "book it"). "Send an email to Ana" is NOT a yes: it is a new request.
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|correct|right|exactly|absolutely|definitely|go|s[ií]|vale|dale|adelante|claro|confirmo|confirmado|correcto|perfecto|venga|exacto|oui|ja|sim|certo)$/iu;
const YES_VERB = /^(send|book|pay|buy|do|cancel|delete|move|proceed|hazlo|env[ií]alo|m[aá]ndalo|res[eé]rvalo|p[aá]galo|c[oó]mpralo|c[aá]ncelalo|b[oó]rralo|mu[eé]velo)$/iu;
const NO = /^(no|not|nope|don'?t|wait|stop|change|but|espera|cambia|pero|non|nein|n[aã]o)$/iu;
const ASKS_YES = /\?|\b(say|di|dime|decir|contesta|answer)\s+[«"']?(yes|s[ií])\b/iu;

export function isYes(text) {
  const w = String(text).toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length || w.length > 5 || w.some(x => NO.test(x))) return false;
  return YES.test(w[0]) || (YES_VERB.test(w[0]) && w.length <= 2);
}

// Does a reply ask for a yes? Looks at its last 300 characters.
export const asksForYes = reply => ASKS_YES.test(String(reply).trim().slice(-300));

export const isNewConversation = text => /^(new conversation|start over|forget (it|everything)|reset|\/new|nueva conversaci[oó]n|empieza de nuevo|olvida(lo)? todo)\.?$/iu.test(String(text).trim());
