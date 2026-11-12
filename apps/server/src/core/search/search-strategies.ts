import pgTsquery = require('pg-tsquery');

const tsquery = pgTsquery();

export const SEARCH_MODES = ['exact', 'exactPrefix', 'scattered', 'scatteredPrefix', 'advanced'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

// one description per mode; the MCP tool reads these so new modes show up there automatically
export const SEARCH_MODE_HELP: Record<SearchMode, string> = {
  exact: 'whole words, next to each other, in order',
  exactPrefix: 'words next to each other, in order, each may be the start of a longer word',
  scattered: 'all whole words present, any order, anywhere on the page',
  scatteredPrefix: 'all words present, any order, anywhere on the page, each may be the start of a longer word',
  advanced: 'raw syntax: "phrase", or, -word, word*',
};

// a query is plain words, a modifier appended to each word, and the joiner between words
type Query = { words: string[]; modifier: string; joiner: string };
type Strategy = (q: string) => Query;

// split on anything that is not a letter/digit so tsquery operators typed by
// the user (- | ! : & <->) are plain text, not syntax
// shortcut: c++ and c# both become "c", add a literal mode if that matters
const words = (q: string) =>
  q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// decorator: makes every word of any strategy a prefix match (word -> word:*)
const withPrefix =
  (strategy: Strategy): Strategy =>
  (q) => ({ ...strategy(q), modifier: ':*' });

const build =
  (strategy: Strategy) =>
  (q: string): string => {
    const { words, modifier, joiner } = strategy(q);
    return words.map((w) => w + modifier).join(joiner);
  };

// whole words, in order, adjacent: "opti locking" does not match "optimistic locking"
const exact: Strategy = (q) => ({ words: words(q), modifier: '', joiner: '<->' });
// whole words, any order, any distance: every word is somewhere on the page
const scattered: Strategy = (q) => ({ words: words(q), modifier: '', joiner: '&' });

export const searchStrategies: Record<SearchMode, (q: string) => string> = {
  exact: build(exact),
  // adjacent and in order, each word a prefix: "opti lock" matches "optimistic locking" but not "locking optimistic"
  exactPrefix: build(withPrefix(exact)),
  // every word somewhere on the page, any order or distance: "locking optimistic" matches "optimistic ... locking"
  scattered: build(scattered),
  // scattered, each word a prefix: "opti lock" matches "locking is optimistic"
  scatteredPrefix: build(withPrefix(scattered)),
  // raw pg-tsquery syntax (quotes, or, -word); adds nothing, so prefix only if the user types `*`
  // not a word list, so withPrefix doesn't apply
  advanced: (q) => tsquery(q),
};
