<script lang="ts">
  import { clockMapMarkers, clockMapPaths, clockMapViewBox } from '$lib/clock-map-paths';
  import {
    changingZone,
    clockRegions,
    clockStamp,
    mapCallouts,
    offsetLabel,
    regionChanges,
    clockLabel,
  } from '$lib/clock-regions';

  const drawOrder = ['alaska', 'yukon', 'nwt', 'saskatchewan', 'alberta', 'bc', 'washington', 'oregon', 'california', 'montana', 'southIdaho', 'northIdaho', 'neBc', 'seBc', 'malheur'];
  const stay = clockRegions.filter((region) => !regionChanges(region));
  const fallBack = clockRegions.filter((region) => regionChanges(region));

  function zoneClass(id: string): string {
    const change = changingZone(id);
    if (change) return change;
    const region = clockRegions.find((item) => item.id === id)!;
    return region.oct31 === -6 ? 'stable6' : 'stable7';
  }

  const regionById = Object.fromEntries(clockRegions.map((region) => [region.id, region]));
  const vancouver = clockMapMarkers.Vancouver;
  const creston = clockMapMarkers.Creston;
  const seattle = clockMapMarkers.Seattle;
</script>

<section class="regional-clocks" id="regional-clocks" aria-labelledby="regional-clocks-title">
  <h2 id="regional-clocks-title">When it's 10:00 AM in Vancouver</h2>
  <p class="clock-lede">
    Same moment, two mornings. 10:00 AM in Vancouver is 17:00 UTC.
    On October 31 the U.S. Pacific coast still agrees with that hour.
    On November 1, after the 2 AM switch, those clocks have fallen back and B.C. has not.
  </p>

  <div class="clock-toggle" role="radiogroup" aria-label="Which morning the map shows">
    <label>
      <input type="radio" name="clock-morning" id="clock-oct31" value="oct31" checked />
      <span class="toggle-title">October 31</span>
      <span class="toggle-note">Before the switch</span>
    </label>
    <label>
      <span class="toggle-title">November 1</span>
      <span class="toggle-note">After 2 AM</span>
      <input type="radio" name="clock-morning" id="clock-nov1" value="nov1" />
    </label>
  </div>

  <div class="map-stage">
    <svg viewBox={clockMapViewBox} role="img" aria-labelledby="clock-map-title clock-map-desc">
      <title id="clock-map-title">Clocks around B.C. on October 31 and November 1, 2026</title>
      <desc id="clock-map-desc">
        Most of British Columbia, northeastern B.C., Creston and Yukon stay at 10:00 AM UTC−7 both mornings.
        Southeastern B.C., Alberta, the Northwest Territories and Saskatchewan stay at 11:00 AM UTC−6.
        Washington, most of Oregon, northern Idaho and California move from 10:00 AM UTC−7 to 9:00 AM UTC−8.
        Southern Idaho, Montana and most of Malheur County move from 11:00 AM UTC−6 to 10:00 AM UTC−7.
        Most of Alaska moves from 9:00 AM UTC−8 to 8:00 AM UTC−9.
        Striped places are the ones that fall back. The table under the map lists every region.
      </desc>
      <defs>
        <pattern id="clock-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#14120c" stroke-width="2.4" stroke-opacity="0.55" />
          <line x1="4" y1="0" x2="4" y2="8" stroke="#f7f4ee" stroke-width="1.3" stroke-opacity="0.7" />
        </pattern>
      </defs>
      {#each drawOrder as id (id)}
        <path class="zone zone-{zoneClass(id)} {id === 'neBc' || id === 'seBc' ? 'sub' : ''}" d={clockMapPaths[id]} fill-rule="evenodd">
          <title>{regionById[id].name}: October 31 {clockStamp(regionById[id].oct31)}; November 1 {clockStamp(regionById[id].nov1)}</title>
        </path>
      {/each}
      {#each drawOrder.filter((id) => changingZone(id)) as id (id)}
        <path class="hatch" d={clockMapPaths[id]} fill="url(#clock-hatch)" fill-rule="evenodd" aria-hidden="true" />
      {/each}
    </svg>
    <span class="you-pin" style="left: {vancouver[0] / 10}%; top: {vancouver[1] / 11.38}%" aria-hidden="true"></span>
    <span class="city-pin" style="left: {seattle[0] / 10}%; top: {seattle[1] / 11.38}%" aria-hidden="true"></span>
    <span class="city-pin" style="left: {creston[0] / 10}%; top: {creston[1] / 11.38}%" aria-hidden="true"></span>

    <ul class="map-callouts" aria-hidden="true">
      {#each mapCallouts as callout (callout.id)}
        {@const region = regionById[callout.id]}
        <li
          class="map-callout callout-{region.id} {callout.dense ? 'dense' : ''} {changingZone(region.id) ?? (region.oct31 === -6 ? 'stable6' : 'stable7')}"
          style="left: {callout.x}%; top: {callout.y}%;"
        >
          <span class="place">{region.short}</span>
          <span class="for-oct31 when">{clockLabel(region.oct31)}</span>
          <span class="for-oct31 off">{offsetLabel(region.oct31)}</span>
          <span class="for-nov1 when">{clockLabel(region.nov1)}</span>
          <span class="for-nov1 off">{offsetLabel(region.nov1)}</span>
        </li>
      {/each}
    </ul>
  </div>

  <ul class="clock-legend">
    <li><span class="swatch utc7" aria-hidden="true"></span> 10:00 AM · UTC−7</li>
    <li><span class="swatch utc6" aria-hidden="true"></span> 11:00 AM · UTC−6</li>
    <li><span class="swatch utc8" aria-hidden="true"></span> 9:00 AM · UTC−8</li>
    <li><span class="swatch utc9" aria-hidden="true"></span> 8:00 AM · UTC−9</li>
    <li><span class="swatch striped" aria-hidden="true"></span> Stripes fall back one hour</li>
    <li><span class="swatch home" aria-hidden="true"></span> Dot is Vancouver</li>
  </ul>

  <div class="clock-table-wrap">
    <table>
      <caption>Local time when it is 10:00 AM in Vancouver (17:00 UTC). November 1 is the morning after the 2 AM switch.</caption>
      <thead>
        <tr>
          <th scope="col">Region</th>
          <th scope="col">October 31</th>
          <th scope="col">November 1</th>
        </tr>
      </thead>
      <tbody>
        <tr class="group-row">
          <th colspan="3">Stays on the same clock</th>
        </tr>
        {#each stay as region (region.id)}
          <tr data-region={region.id}>
            <th scope="row">
              {region.name}
              <span class="badge badge-stay">No change</span>
              <span class="detail">{region.detail}</span>
            </th>
            <td><span class="t-time">{clockLabel(region.oct31)}</span><span class="t-off">{offsetLabel(region.oct31)}</span></td>
            <td><span class="t-time">{clockLabel(region.nov1)}</span><span class="t-off">{offsetLabel(region.nov1)}</span></td>
          </tr>
        {/each}
        <tr class="group-row">
          <th colspan="3">Falls back one hour</th>
        </tr>
        {#each fallBack as region (region.id)}
          <tr data-region={region.id}>
            <th scope="row">
              {region.name}
              <span class="badge badge-back">Falls back</span>
              <span class="detail">{region.detail}</span>
            </th>
            <td><span class="t-time">{clockLabel(region.oct31)}</span><span class="t-off">{offsetLabel(region.oct31)}</span></td>
            <td><span class="t-time">{clockLabel(region.nov1)}</span><span class="t-off">{offsetLabel(region.nov1)}</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <p class="clock-notes">
    Boundaries are simplified from <a href="#ref-map">Natural Earth</a> and U.S. census counties.
    Northeastern and southeastern B.C. follow the communities named in the province’s
    <a href="#ref-bc-dst">October 28 guidance</a>.
    <a href="#ref-abt">Alberta</a>, the <a href="#ref-nwt">Northwest Territories</a>,
    <a href="#ref-yukon">Yukon</a> and <a href="#ref-sk">Saskatchewan</a> publish the offsets used here.
    U.S. lines follow <a href="#ref-us-zones">49 CFR Part 71</a>, and the fall-back hour is the
    <a href="#ref-nist">NIST date</a> already cited below.
    Nunavut spans more than one time zone and is not shown.
  </p>
</section>

<style>
  .regional-clocks {
    margin: 0 0 16px;
    padding: 18px clamp(12px, 3vw, 20px) 16px;
    border: 1px solid #30363d;
    border-radius: 10px;
    background: var(--card-bg);
    scroll-margin-top: 16px;
  }

  h2 {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: clamp(26px, 4.4vw, 40px);
    line-height: 1.12;
    letter-spacing: -0.02em;
    color: #f5f0e8;
    margin: 0 0 10px;
  }

  .clock-lede {
    margin: 0 0 16px;
    max-width: 68ch;
    color: var(--text-muted);
    font-size: 15px;
    line-height: 1.6;
  }

  .clock-toggle {
    display: flex;
    width: min(100%, 420px);
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 24px;
    padding: 4px;
    gap: 2px;
    margin-bottom: 14px;
  }

  .clock-toggle label {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    border-radius: 20px;
    padding: 8px 10px;
    cursor: pointer;
    color: var(--text-muted);
    text-align: center;
  }

  .clock-toggle input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }

  .clock-toggle label:has(input:checked) {
    background: var(--accent-gold);
    color: #0d1117;
  }

  .clock-toggle label:focus-within {
    outline: 2px solid var(--accent-blue);
    outline-offset: 2px;
  }

  .toggle-title { font-size: 13px; font-weight: 700; }
  .toggle-note { font-size: 11px; font-weight: 500; letter-spacing: 0.02em; }

  .map-stage { position: relative; margin: 0 0 12px; }
  .map-stage svg { display: block; width: 100%; height: auto; }

  .zone { stroke: #c8c1b4; stroke-width: 1.15; stroke-linejoin: round; }
  .zone-stable7, .zone-pac { fill: #f0c654; }
  .zone-stable6, .zone-mtn { fill: #e76f51; }
  .zone-ak { fill: #58a6ff; }
  .zone.sub { stroke: #f7f4ee; stroke-width: 1.7; stroke-dasharray: 5 3.5; }
  .hatch { pointer-events: none; }

  :global(.regional-clocks:has(#clock-nov1:checked) .zone-pac) { fill: #58a6ff; }
  :global(.regional-clocks:has(#clock-nov1:checked) .zone-mtn) { fill: #f0c654; }
  :global(.regional-clocks:has(#clock-nov1:checked) .zone-ak) { fill: #1f4f93; }

  .you-pin, .city-pin {
    position: absolute;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .you-pin {
    width: 12px;
    height: 12px;
    background: #f7f4ee;
    border: 2px solid #14120c;
    box-shadow: 0 0 0 3px #f0c654;
  }
  .city-pin {
    width: 8px;
    height: 8px;
    background: #14120c;
    border: 2px solid #f7f4ee;
  }

  .map-callouts { list-style: none; margin: 0; padding: 0; }
  .map-callout {
    position: absolute;
    transform: translate(-50%, -50%);
    text-align: center;
    line-height: 1.05;
    font-weight: 700;
    font-size: clamp(10px, 1.7vw, 13px);
    color: #14120c;
    text-shadow: 0 0 4px #161b22, 0 0 4px #161b22, 0 1px 0 #161b22;
    pointer-events: none;
  }
  .map-callout .place,
  .map-callout .when,
  .map-callout .off { display: block; }
  .map-callout .place { letter-spacing: 0.01em; }
  .map-callout .when {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: 1.18em;
  }
  .map-callout .off { font-size: 0.86em; font-weight: 600; }
  .map-callout.dense { display: none; }

  :global(.regional-clocks:not(:has(#clock-nov1:checked)) .for-nov1),
  :global(.regional-clocks:has(#clock-nov1:checked) .for-oct31) { display: none; }

  .callout-alaska { color: #f7f4ee; text-shadow: 0 0 4px #0d1117, 0 0 4px #0d1117, 0 1px 0 #0d1117; }
  :global(.regional-clocks:has(#clock-nov1:checked) .callout-washington),
  :global(.regional-clocks:has(#clock-nov1:checked) .callout-oregon),
  :global(.regional-clocks:has(#clock-nov1:checked) .callout-northIdaho),
  :global(.regional-clocks:has(#clock-nov1:checked) .callout-california) {
    color: #f7f4ee;
    text-shadow: 0 0 4px #0d1117, 0 0 4px #0d1117, 0 1px 0 #0d1117;
  }

  .clock-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
    color: var(--text-primary);
    font-size: 12.5px;
    font-weight: 600;
  }
  .clock-legend li { display: flex; align-items: center; gap: 7px; }
  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid #30363d;
    flex: none;
  }
  .swatch.utc7 { background: #f0c654; }
  .swatch.utc6 { background: #e76f51; }
  .swatch.utc8 { background: #58a6ff; }
  .swatch.utc9 { background: #1f4f93; }
  .swatch.striped {
    background-color: #f0c654;
    background-image: repeating-linear-gradient(40deg, transparent 0 3px, rgba(20, 18, 12, 0.55) 3px 5px, transparent 5px 7px, rgba(247, 244, 238, 0.8) 7px 8px);
  }
  .swatch.home { background: #f7f4ee; border-radius: 50%; }

  .clock-table-wrap { max-width: 100%; overflow-x: auto; border: 1px solid #30363d; border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  caption {
    text-align: left;
    padding: 12px;
    color: var(--text-muted);
    caption-side: bottom;
    font-size: 12.5px;
    line-height: 1.5;
  }
  th, td { padding: 10px 10px; border-top: 1px solid #30363d; text-align: left; vertical-align: top; line-height: 1.4; }
  thead th { background: #0d1117; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted); }
  tbody th[scope="row"] { font-weight: 600; width: 48%; }
  .group-row th {
    background: #121820;
    color: var(--accent-gold);
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding-top: 12px;
    padding-bottom: 8px;
  }
  .t-time, .t-off { display: block; white-space: nowrap; }
  .t-time { font-variant-numeric: tabular-nums; font-weight: 700; }
  .t-off { color: var(--text-muted); font-size: 12px; }
  .detail { display: block; margin-top: 4px; color: var(--text-muted); font-weight: 400; font-size: 12.5px; line-height: 1.45; }
  .badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    vertical-align: 1px;
  }
  .badge-stay { color: var(--text-primary); border: 1px solid #8b949e; }
  .badge-back {
    color: #14120c;
    background-color: #f0c654;
    background-image: repeating-linear-gradient(40deg, transparent 0 2px, rgba(20, 18, 12, 0.4) 2px 3px);
  }

  .clock-notes {
    margin: 12px 0 0;
    color: var(--text-muted);
    font-size: 12.5px;
    line-height: 1.55;
  }
  .clock-notes a { color: var(--accent-gold); }

  @media (min-width: 900px) {
    .map-callout.dense { display: block; }
  }

  @media (max-width: 639px) {
    table { font-size: 12.5px; }
    th, td { padding: 8px 8px; }
    tbody th[scope="row"] { width: 46%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .zone { transition: none; }
  }

  @media (min-width: 640px) {
    .zone { transition: fill 0.2s ease; }
  }
</style>
