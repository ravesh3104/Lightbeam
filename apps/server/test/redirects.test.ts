/**
 * redirects.test.ts - verifies short-URL aliases preserve query parameters.
 */

import { describe, expect, it } from 'vitest';
import { aliasTarget } from '../src/routes/redirects.js';

describe('short-URL redirects', () => {
  it('redirects /s and /r to canonical SPA routes', () => {
    expect(aliasTarget('/s')).toBe('/send');
    expect(aliasTarget('/r')).toBe('/receive');
    expect(aliasTarget('/send.html')).toBe('/send');
    expect(aliasTarget('/receive.html')).toBe('/receive');
  });

  it('preserves query strings across redirects so session codes survive', () => {
    expect(aliasTarget('/r', '?code=ABCD234')).toBe('/receive?code=ABCD234');
    expect(aliasTarget('/s', '?profile=dense')).toBe('/send?profile=dense');
  });

  it('returns null for canonical and unknown paths', () => {
    expect(aliasTarget('/')).toBeNull();
    expect(aliasTarget('/send')).toBeNull();
    expect(aliasTarget('/receive')).toBeNull();
    expect(aliasTarget('/files')).toBeNull();
  });
});
