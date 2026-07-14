import { describe, expect, it } from 'vitest';
import type { SearchResponse } from '../api';
import { currentSearchResponse } from './Search';

const response: SearchResponse = {
  estimatedTotalHits: 6,
  hits: [],
  processingTimeMs: 12,
};

describe('currentSearchResponse', () => {
  it('keeps a response only while it belongs to the active URL query', () => {
    const loaded = { query: 'cloudflare', response };

    expect(currentSearchResponse('cloudflare', loaded)).toBe(response);
    expect(currentSearchResponse('rust', loaded)).toBeUndefined();
  });

  it('does not render a response before the active query has loaded', () => {
    expect(currentSearchResponse('cloudflare', undefined)).toBeUndefined();
  });
});
