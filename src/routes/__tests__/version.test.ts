import { describe, expect, it } from 'vitest';
import { deployedCommit } from '$lib/deployed-commit';
import { GET } from '../version/+server';

describe('GET /version', () => {
  it('returns the canonical commit-only contract without caching', async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ commit: deployedCommit() });
  });
});
