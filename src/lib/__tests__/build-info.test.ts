import { describe, expect, it } from 'vitest';
import { chooseBuildField, DEV_SHA, getBuildInfo, UNKNOWN_BUILD_TIME } from '../build-info';

describe('chooseBuildField', () => {
	it('keeps a real build-time value ahead of the environment', () => {
		expect(chooseBuildField('abc123', 'other', DEV_SHA)).toBe('abc123');
	});

	it('uses the environment when the baked value is the local placeholder', () => {
		expect(chooseBuildField(DEV_SHA, 'abc123', DEV_SHA)).toBe('abc123');
		expect(chooseBuildField(UNKNOWN_BUILD_TIME, '2026-10-31T00:00:00Z', UNKNOWN_BUILD_TIME)).toBe(
			'2026-10-31T00:00:00Z'
		);
	});

	it('falls back to the placeholder when nothing was set', () => {
		expect(chooseBuildField(undefined, undefined, DEV_SHA)).toBe(DEV_SHA);
		expect(chooseBuildField('', '', UNKNOWN_BUILD_TIME)).toBe(UNKNOWN_BUILD_TIME);
	});
});

describe('getBuildInfo', () => {
	it('returns only sha and builtAt', () => {
		const info = getBuildInfo();
		expect(Object.keys(info).sort()).toEqual(['builtAt', 'sha']);
		expect(info.sha.length).toBeGreaterThan(0);
		expect(info.builtAt.length).toBeGreaterThan(0);
	});
});
