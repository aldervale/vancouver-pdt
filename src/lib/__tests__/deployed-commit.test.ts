import { describe, expect, it } from 'vitest';
import { deployedCommit, versionPayload, versionResponse } from '../deployed-commit';

const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('version payload', () => {
  it('returns only the commit', async () => {
    expect(versionPayload(sha)).toEqual({ commit: sha });
    expect(Object.keys(versionPayload('dev'))).toEqual(['commit']);

    const response = versionResponse(sha);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ commit: sha });
  });

  it('rejects site content and anything other than the sha', () => {
    expect(() => versionPayload('<html>Vancouver Pacific Time</html>')).toThrow(/git sha/);
    expect(() => versionPayload('daylight')).toThrow(/git sha/);
    expect(() => versionPayload(`${sha} extra`)).toThrow(/git sha/);
  });

  it('reads the baked commit or the dev placeholder', () => {
    const commit = deployedCommit();
    expect(commit === 'dev' || /^[0-9a-f]{40}$/.test(commit)).toBe(true);
    const previous = process.env.COMMIT_SHA;
    process.env.COMMIT_SHA = sha;
    try {
      const selected = deployedCommit();
      expect(selected === sha || /^[0-9a-f]{40}$/.test(selected)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.COMMIT_SHA;
      else process.env.COMMIT_SHA = previous;
    }
  });
});
