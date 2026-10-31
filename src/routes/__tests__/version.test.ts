import { describe, expect, it } from 'vitest';
import { getBuildInfo } from '$lib/build-info';
import { GET } from '../version/+server';

describe('GET /version', () => {
	it('returns only the commit sha and build time', async () => {
		const response = GET();
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(response.headers.get('cache-control')).toBe('no-store');

		const body = await response.json();
		expect(body).toEqual(getBuildInfo());
		expect(Object.keys(body).sort()).toEqual(['builtAt', 'sha']);
		expect(JSON.stringify(body)).not.toContain('<');
		expect(JSON.stringify(body)).not.toContain('No More Clock Changes');
	});
});
