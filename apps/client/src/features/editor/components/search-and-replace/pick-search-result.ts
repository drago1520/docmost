// Whitespace differs between the server's indexed text and the editor's
// textBetween, so compare without it.
const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

const commonSuffix = (a: string, b: string) => {
  let i = 0;
  while (
    i < a.length &&
    i < b.length &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  )
    i++;
  return i;
};

/**
 * Picks the editor match that a search snippet points at.
 * `snippet` is one ts_headline fragment, e.g. "foo <b>term</b> bar".
 * `contexts` holds the text before/after each editor match, in result order.
 * Returns 0 when nothing fits better, so callers fall back to the first match.
 */
export function pickSearchResult(
  snippet: string,
  contexts: { before: string; after: string }[],
): number {
  const m = /^([\s\S]*?)<b>[\s\S]*?<\/b>([\s\S]*)$/i.exec(snippet);
  if (!m) return 0;
  const before = squash(m[1]);
  const after = squash(m[2].replace(/<\/?b>/gi, ""));

  let best = 0;
  let bestScore = 0;
  contexts.forEach((c, i) => {
    const score =
      commonSuffix(squash(c.before), before) +
      commonPrefix(squash(c.after), after);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}
