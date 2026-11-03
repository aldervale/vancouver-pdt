/** Shared instant: 10:00 AM in Vancouver is 17:00 UTC. */
export const VANCOUVER_UTC_HOUR = 17;

export type ClockRegion = {
  id: string;
  name: string;
  short: string;
  detail: string;
  /** UTC offset on October 31, 2026, before the U.S. 2 AM fall-back. */
  oct31: number;
  /** UTC offset on November 1, 2026, after the 2 AM local switch. */
  nov1: number;
  /** Drawn as its own polygon. Creston is a marker inside the rest of B.C. */
  mapped: boolean;
};

export const clockRegions: ClockRegion[] = [
  {
    id: 'bc',
    name: 'Most of British Columbia',
    short: 'B.C.',
    detail: 'Pacific Time (PCT). Clocks stay on the daylight offset.',
    oct31: -7,
    nov1: -7,
    mapped: true,
  },
  {
    id: 'neBc',
    name: 'Northeastern B.C.',
    short: 'NE B.C.',
    detail: 'Mountain standard time year-round, so the clock already matches PCT. Includes Dawson Creek, Fort St. John, Fort Nelson and the Northern Rockies, Chetwynd, Hudson’s Hope, Taylor and Tumbler Ridge. Fort Ware (Kwadacha Nation), just west of this area, uses Pacific Time.',
    oct31: -7,
    nov1: -7,
    mapped: true,
  },
  {
    id: 'creston',
    name: 'Creston',
    short: 'Creston',
    detail: 'Not on the province’s southeastern list. The Creston Valley stays on mountain standard time year-round, which matches Vancouver on both mornings.',
    oct31: -7,
    nov1: -7,
    mapped: false,
  },
  {
    id: 'yukon',
    name: 'Yukon',
    short: 'Yukon',
    detail: 'Yukon Standard Time, permanently UTC−7.',
    oct31: -7,
    nov1: -7,
    mapped: true,
  },
  {
    id: 'seBc',
    name: 'Southeastern B.C.',
    short: 'SE B.C.',
    detail: 'Stays aligned with Alberta at UTC−6. Includes Cranbrook, Fernie, Sparwood, Invermere, Kimberley, Radium Hot Springs, Elkford and Golden.',
    oct31: -6,
    nov1: -6,
    mapped: true,
  },
  {
    id: 'alberta',
    name: 'Alberta',
    short: 'Alberta',
    detail: 'Already on the daylight offset. On November 1 the clocks stay put and the permanent name is Alberta Time (ABT).',
    oct31: -6,
    nov1: -6,
    mapped: true,
  },
  {
    id: 'nwt',
    name: 'Northwest Territories',
    short: 'NWT',
    detail: 'Northwest Territories Time, UTC−6. Clocks do not turn back on November 1. High Arctic islands are cropped on the map.',
    oct31: -6,
    nov1: -6,
    mapped: true,
  },
  {
    id: 'saskatchewan',
    name: 'Saskatchewan',
    short: 'Sask.',
    detail: 'Central Standard Time year-round. Lloydminster now matches the rest of the province because Alberta no longer falls back.',
    oct31: -6,
    nov1: -6,
    mapped: true,
  },
  {
    id: 'washington',
    name: 'Washington',
    short: 'Washington',
    detail: 'Pacific time. Seattle matches Vancouver on October 31 and is an hour behind on November 1.',
    oct31: -7,
    nov1: -8,
    mapped: true,
  },
  {
    id: 'oregon',
    name: 'Oregon, except most of Malheur County',
    short: 'Oregon',
    detail: 'Pacific time, including the southern strip of Malheur County that stays on Pacific time.',
    oct31: -7,
    nov1: -8,
    mapped: true,
  },
  {
    id: 'northIdaho',
    name: 'Northern Idaho',
    short: 'N. Idaho',
    detail: 'Pacific time north of the Salmon River, following the mountain/Pacific line in 49 CFR 71.9.',
    oct31: -7,
    nov1: -8,
    mapped: true,
  },
  {
    id: 'california',
    name: 'California',
    short: 'California',
    detail: 'Pacific time, same fall-back as Washington.',
    oct31: -7,
    nov1: -8,
    mapped: true,
  },
  {
    id: 'malheur',
    name: 'Malheur County, Oregon (most)',
    short: 'Malheur',
    detail: 'Mountain time for most of the county, north of the line in 49 CFR 71.9. A southern strip near the Nevada line stays with the rest of Oregon.',
    oct31: -6,
    nov1: -7,
    mapped: true,
  },
  {
    id: 'southIdaho',
    name: 'Southern Idaho',
    short: 'S. Idaho',
    detail: 'Mountain time south of the Salmon River.',
    oct31: -6,
    nov1: -7,
    mapped: true,
  },
  {
    id: 'montana',
    name: 'Montana',
    short: 'Montana',
    detail: 'Mountain time. On November 1 it lands on the same hour as Vancouver.',
    oct31: -6,
    nov1: -7,
    mapped: true,
  },
  {
    id: 'alaska',
    name: 'Alaska (most of the state)',
    short: 'Alaska',
    detail: 'Alaska time. The Aleutian Islands west of 169°30′ W use Hawaii-Aleutian time and are not shown.',
    oct31: -8,
    nov1: -9,
    mapped: true,
  },
];

export function regionChanges(region: ClockRegion): boolean {
  return region.oct31 !== region.nov1;
}

export function clockLabel(offset: number): string {
  const hour24 = VANCOUVER_UTC_HOUR + offset;
  if (hour24 < 0 || hour24 > 23) throw new Error(`Offset ${offset} is outside the map’s single day`);
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:00 ${suffix}`;
}

export function offsetLabel(offset: number): string {
  const sign = offset < 0 ? '−' : '+';
  return `UTC${sign}${Math.abs(offset)}`;
}

export function clockStamp(offset: number): string {
  return `${clockLabel(offset)} ${offsetLabel(offset)}`;
}

export const changingZone = (id: string): 'pac' | 'mtn' | 'ak' | null => {
  const region = clockRegions.find((item) => item.id === id);
  if (!region || !regionChanges(region)) return null;
  if (region.oct31 === -8) return 'ak';
  if (region.oct31 === -6) return 'mtn';
  return 'pac';
};

