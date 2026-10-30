import { describe, it, expect } from 'vitest';
import { clockLabel, clockRegions, clockStamp, offsetLabel, regionChanges } from '$lib/clock-regions';

const byId = Object.fromEntries(clockRegions.map((region) => [region.id, region]));

describe('regional clock offsets', () => {
  it('turns 17:00 UTC into the local hour used on the map', () => {
    expect(clockLabel(-7)).toBe('10:00 AM');
    expect(clockLabel(-6)).toBe('11:00 AM');
    expect(clockLabel(-8)).toBe('9:00 AM');
    expect(clockLabel(-9)).toBe('8:00 AM');
    expect(offsetLabel(-7)).toBe('UTC−7');
    expect(clockStamp(-9)).toBe('8:00 AM UTC−9');
  });

  it('keeps B.C. and the listed neighbours on the verified offsets', () => {
    const staysAt = (id: string, offset: number) => {
      expect(byId[id].oct31).toBe(offset);
      expect(byId[id].nov1).toBe(offset);
      expect(regionChanges(byId[id])).toBe(false);
    };
    const falls = (id: string, before: number, after: number) => {
      expect(byId[id].oct31).toBe(before);
      expect(byId[id].nov1).toBe(after);
      expect(regionChanges(byId[id])).toBe(true);
    };

    staysAt('bc', -7);
    staysAt('neBc', -7);
    staysAt('creston', -7);
    staysAt('yukon', -7);
    staysAt('seBc', -6);
    staysAt('alberta', -6);
    staysAt('nwt', -6);
    staysAt('saskatchewan', -6);

    falls('washington', -7, -8);
    falls('oregon', -7, -8);
    falls('northIdaho', -7, -8);
    falls('california', -7, -8);
    falls('malheur', -6, -7);
    falls('southIdaho', -6, -7);
    falls('montana', -6, -7);
    falls('alaska', -8, -9);
  });

  it('names the communities the map is generalizing', () => {
    expect(byId.neBc.detail).toMatch(/Dawson Creek/);
    expect(byId.neBc.detail).toMatch(/Fort Nelson/);
    expect(byId.neBc.detail).toMatch(/Tumbler Ridge/);
    expect(byId.neBc.detail).toMatch(/Fort Ware/);
    expect(byId.seBc.detail).toMatch(/Cranbrook/);
    expect(byId.seBc.detail).toMatch(/Golden/);
    expect(byId.creston.detail).toMatch(/mountain standard time/i);
    expect(byId.malheur.detail).toMatch(/southern strip/);
    expect(byId.alaska.detail).toMatch(/Aleutian/);
  });
});
