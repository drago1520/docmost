import { searchStrategies as s } from './search-strategies';

describe('searchStrategies', () => {
  it('exact joins whole words with the followed-by operator', () => {
    expect(s.exact('opti locking')).toBe('opti<->locking');
  });

  it('exact treats operator characters as plain text', () => {
    expect(s.exact('foo-bar | !baz')).toBe('foo<->bar<->baz');
  });

  it('exact keeps non-latin letters', () => {
    expect(s.exact('оптимистично заключване')).toBe(
      'оптимистично<->заключване',
    );
  });

  it('scattered ANDs whole words, in any order', () => {
    expect(s.scattered('locking optimistic')).toBe('locking&optimistic');
  });

  it('scatteredPrefix makes every word a prefix and ANDs them', () => {
    expect(s.scatteredPrefix('opti lock')).toBe('opti:*&lock:*');
  });

  it('advanced keeps pg-tsquery syntax and adds no prefix', () => {
    expect(s.advanced('foo or bar')).toBe('foo|bar');
  });

  it('advanced only prefix-matches words the user starred', () => {
    expect(s.advanced('foo* bar')).toBe('foo:*&bar');
  });

  it('returns an empty query for whitespace-only input', () => {
    expect(s.exact('   ')).toBe('');
    expect(s.scatteredPrefix('   ')).toBe('');
  });

  it('returns an empty query for emoji and symbols only', () => {
    expect(s.exact('😀 ***')).toBe('');
  });

  it('splits version numbers on the dot', () => {
    expect(s.exact('v2.0 release')).toBe('v2<->0<->release');
  });

  it('splits on apostrophes and underscores', () => {
    expect(s.exact("don't foo_bar")).toBe('don<->t<->foo<->bar');
  });

  it('strips tsquery operators, colons and parentheses typed by the user', () => {
    expect(s.exact('foo:* & (bar)! <-> baz')).toBe('foo<->bar<->baz');
    expect(s.scatteredPrefix('foo:* & (bar)! <-> baz')).toBe('foo:*&bar:*&baz:*');
  });

  it('keeps accented, Cyrillic and digit tokens in mixed input', () => {
    expect(s.exact('café Москва-2024')).toBe('café<->Москва<->2024');
  });

  it('exactPrefix makes every word a prefix but keeps order and adjacency', () => {
    expect(s.exactPrefix('opti locking')).toBe('opti:*<->locking:*');
  });

  it('exactPrefix returns an empty query for an empty query', () => {
    expect(s.exactPrefix('')).toBe('');
  });

  it('returns an empty query when nothing searchable is left', () => {
    expect(s.exact('*** --')).toBe('');
  });
});
