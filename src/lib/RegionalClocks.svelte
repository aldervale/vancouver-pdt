<script lang="ts">
  import { onMount } from 'svelte';
  import { alaskaInsetPath, alaskaViewBox, clockMapAnchors, clockMapMarkers, clockMapPaths, clockMapViewBox } from '$lib/clock-map-paths';
  import {
    clockLabel,
    clockRegions,
    clockStamp,
    offsetLabel,
    regionChanges,
  } from '$lib/clock-regions';

  type Morning = 'oct31' | 'nov1';

  const drawOrder = ['alaskaPanhandle', 'yukon', 'nwt', 'saskatchewan', 'alberta', 'bc', 'washington', 'oregon', 'california', 'montana', 'southIdaho', 'northIdaho', 'malheur', 'neBc', 'seBc'];
  const labels: { id: string; major?: boolean; dx?: number; dy?: number }[] = [
    { id: 'yukon', major: true },
    { id: 'nwt', major: true },
    { id: 'bc', major: true, dy: 18 },
    { id: 'alberta', major: true },
    { id: 'saskatchewan', major: true, dx: -36 },
    { id: 'washington', dy: 16 },
    { id: 'oregon' },
    { id: 'montana', dx: 10 },
    { id: 'california', dy: -8 },
  ];
  const stay = clockRegions.filter((region) => !regionChanges(region));
  const fallBack = clockRegions.filter((region) => regionChanges(region));
  const regionById = Object.fromEntries(clockRegions.map((region) => [region.id, region]));
  const [, , mapW, mapH] = clockMapViewBox.split(' ').map(Number);
  const vancouver = clockMapMarkers.Vancouver;
  const creston = clockMapMarkers.Creston;

  function regionFor(id: string) {
    return regionById[id === 'alaskaPanhandle' ? 'alaska' : id];
  }

  function offsetFor(id: string, morning: Morning) {
    const region = regionFor(id);
    return morning === 'oct31' ? region.oct31 : region.nov1;
  }

  function fillClass(offset: number) {
    return `off${Math.abs(offset)}`;
  }

  function placeName(id: string) {
    if (id === 'washington') return 'Wash.';
    if (id === 'california') return 'Calif.';
    return regionById[id].short;
  }

  let dialogEl: HTMLDialogElement | undefined = $state();

  function supportsCommandInvoker() {
    return typeof HTMLButtonElement !== 'undefined' && 'commandForElement' in HTMLButtonElement.prototype;
  }

  function revealDialog() {
    if (dialogEl) dialogEl.style.display = '';
  }

  function syncScrollLock(open: boolean) {
    document.documentElement.classList.toggle('clock-dialog-open', open);
  }

  function openDialog() {
    const dialog = dialogEl;
    if (!dialog || dialog.open) return;
    revealDialog();
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
    syncScrollLock(Boolean(dialog.open));
  }

  function onTriggerClick(event: MouseEvent) {
    // Browsers that support invoker commands open the dialog after this click.
    // preventDefault would cancel that, and calling showModal as well throws.
    if (supportsCommandInvoker()) {
      revealDialog();
      queueMicrotask(() => {
        if (dialogEl?.open) syncScrollLock(true);
      });
      return;
    }
    event.preventDefault();
    openDialog();
  }

  function onDocumentClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a[href="#regional-clocks"]');
    if (!link) return;
    event.preventDefault();
    openDialog();
  }

  function onDialogClick(event: MouseEvent) {
    if (event.target === dialogEl) {
      dialogEl?.close();
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('a[href^="#ref-"]')) dialogEl?.close();
  }

  function onDialogToggle(event: Event) {
    const open = 'newState' in event ? (event as ToggleEvent).newState === 'open' : Boolean(dialogEl?.open);
    syncScrollLock(open);
    if (!dialogEl) return;
    if (open) revealDialog();
    else dialogEl.style.display = 'none';
  }

  function onDialogKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !dialogEl?.open) return;
    const dialog = dialogEl;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
      .filter((el) => {
        if (el.tabIndex < 0) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return el.getClientRects().length > 0;
      });
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onDialogClose() {
    syncScrollLock(false);
    if (dialogEl) dialogEl.style.display = 'none';
  }

  onMount(() => () => {
    document.documentElement.classList.remove('clock-dialog-open');
  });
</script>

<svelte:document onclick={onDocumentClick} />

{#snippet hatchDefs(suffix: string, size = 7)}
  <defs>
    <pattern id="clock-hatch-{suffix}" width={size} height={size} patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
      <line x1="0" y1="0" x2="0" y2={size} stroke="#1a140c" stroke-width={size > 14 ? 3.4 : 1.35} stroke-opacity="0.32" />
    </pattern>
    <pattern id="clock-hatch-light-{suffix}" width={size} height={size} patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
      <line x1="0" y1="0" x2="0" y2={size} stroke="#f7f4ee" stroke-width={size > 14 ? 3.4 : 1.35} stroke-opacity="0.42" />
    </pattern>
  </defs>
{/snippet}

{#snippet zonePaths(morning: Morning)}
  {#each drawOrder as id (id)}
    {@const region = regionFor(id)}
    {@const offset = offsetFor(id, morning)}
    <path
      class="zone {fillClass(offset)} {id === 'neBc' || id === 'seBc' ? 'sub' : ''}"
      d={id === 'alaska' ? alaskaInsetPath : clockMapPaths[id]}
      fill-rule="evenodd"
    >
      <title>{id === 'alaskaPanhandle' ? 'Alaska panhandle' : region.name}: {clockStamp(offset)}</title>
    </path>
  {/each}
  {#each drawOrder.filter((id) => regionChanges(regionFor(id))) as id (id)}
    <path class="hatch" d={clockMapPaths[id]} fill={offsetFor(id, morning) === -9 ? `url(#clock-hatch-light-${morning})` : `url(#clock-hatch-${morning})`} fill-rule="evenodd" />
  {/each}
{/snippet}

{#snippet morningMap(morning: Morning)}
  {@const alaskaOffset = offsetFor('alaska', morning)}
  <figure class="map-card map-{morning}">
    <figcaption>
      <span class="cap-kicker">{morning === 'oct31' ? 'October 31' : 'November 1'}</span>
      <span class="cap-note">{morning === 'oct31' ? 'Before the switch' : 'After 2 AM'}</span>
    </figcaption>
    <div class="map-layout">
      <div class="map-stage">
        <svg viewBox={clockMapViewBox} role="img" aria-labelledby="clock-map-title-{morning} clock-map-desc-{morning}">
          <title id="clock-map-title-{morning}">Clocks around B.C. on {morning === 'oct31' ? 'October 31' : 'November 1'}, 2026</title>
          <desc id="clock-map-desc-{morning}">
            Most of British Columbia, northeastern B.C., Creston and Yukon stay at 10:00 AM UTC−7 both mornings.
            Southeastern B.C., Alberta, the Northwest Territories and Saskatchewan stay at 11:00 AM UTC−6.
            Washington, most of Oregon, northern Idaho and California move from 10:00 AM UTC−7 to 9:00 AM UTC−8.
            Southern Idaho, Montana and most of Malheur County move from 11:00 AM UTC−6 to 10:00 AM UTC−7.
            Most of Alaska, including the panhandle beside northern B.C., moves from 9:00 AM UTC−8 to 8:00 AM UTC−9.
            Striped places are the ones that fall back. The table under the map lists every region.
          </desc>
          {@render hatchDefs(morning)}
          <rect class="ocean" width="100%" height="100%" rx="18" />
          {@render zonePaths(morning)}
        </svg>
        <span class="you-pin" style="left: {(vancouver[0] / mapW) * 100}%; top: {(vancouver[1] / mapH) * 100}%" aria-hidden="true"></span>
        <span class="creston-pin" style="left: {(creston[0] / mapW) * 100}%; top: {(creston[1] / mapH) * 100}%" aria-hidden="true"></span>
        <ul class="map-callouts" aria-hidden="true">
          {#each labels as label (label.id)}
            {@const anchor = clockMapAnchors[label.id]}
            <li
              class="map-callout callout-{label.id} {label.major ? 'major' : 'minor'}"
              style="left: {((anchor[0] + (label.dx ?? 0)) / mapW) * 100}%; top: {((anchor[1] + (label.dy ?? 0)) / mapH) * 100}%;"
            >
              <span class="place">{placeName(label.id)}</span>
              <span class="when for-{morning}">{clockLabel(offsetFor(label.id, morning))}</span>
            </li>
          {/each}
        </ul>
      </div>
      <aside class="alaska-card">
        <svg class="alaska-svg" viewBox={alaskaViewBox} aria-hidden="true">
          {@render hatchDefs(`ak-${morning}`, 26)}
          <path class="zone {fillClass(alaskaOffset)}" d={alaskaInsetPath} fill-rule="evenodd">
            <title>Most of Alaska: {clockStamp(alaskaOffset)}</title>
          </path>
          <path class="hatch" d={alaskaInsetPath} fill={alaskaOffset === -9 ? `url(#clock-hatch-light-ak-${morning})` : `url(#clock-hatch-ak-${morning})`} />
        </svg>
        <p class="map-callout callout-alaska major">
          <span class="place">Alaska</span>
          <span class="when for-{morning}">{clockLabel(alaskaOffset)}</span>
          <span class="off for-{morning}">{offsetLabel(alaskaOffset)}</span>
          <span class="hint">Most of the state</span>
        </p>
      </aside>
    </div>
  </figure>
{/snippet}

<div class="clock-map-entry" id="regional-clocks">
  <button
    type="button"
    class="clock-map-trigger"
    command="show-modal"
    commandfor="regional-clocks-dialog"
    aria-haspopup="dialog"
    aria-controls="regional-clocks-dialog"
    onclick={onTriggerClick}
  >
    <svg class="trigger-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="7.25" fill="none" stroke="currentColor" stroke-width="1.75" />
      <path d="M12 8.5V12.2l2.4 1.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <span class="trigger-label">
      <span class="label-long">See the map: what time it is across the West on Oct 31 vs Nov 1</span>
      <span class="label-short">See the map: Oct 31 vs Nov 1</span>
    </span>
    <svg class="trigger-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>

  <dialog
    id="regional-clocks-dialog"
    class="clock-dialog"
    aria-labelledby="regional-clocks-title"
    closedby="any"
    style="display: none"
    bind:this={dialogEl}
    ontoggle={onDialogToggle}
    onclose={onDialogClose}
    onkeydown={onDialogKeydown}
    onclick={onDialogClick}
  >
    <div class="regional-clocks">
      <div class="dialog-bar">
        <span class="dialog-bar-spacer" aria-hidden="true"></span>
        <h2 id="regional-clocks-title">When it's 10:00 AM in Vancouver</h2>
        <form method="dialog" class="dialog-close-form">
          <button type="submit" class="dialog-close" aria-label="Close map">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M3.2 3.2 12.8 12.8M12.8 3.2 3.2 12.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
        </form>
      </div>
      <div class="dialog-body">
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

  <div class="map-pair">
    {@render morningMap('oct31')}
    {@render morningMap('nov1')}
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
    This is a simplified regional overview, not an address-level time-zone lookup.
    Colour is the local time at that moment, one colour per offset.
    Stripes mark the regions that fall back; nothing in Canada moves.
    Dashed lines are northeastern B.C. and the southeast from Golden to the Elk Valley.
    Idaho is split at the Salmon River, and most of Malheur County follows Montana.
    The small ring near Creston stays on Vancouver’s hour.
    The map is cropped above about 64°N and just south of San Francisco.
    Most of Alaska is drawn beside the map; the panhandle is the blue strip beside northern B.C.
    Provincial and state outlines are from <a href="#ref-map">Natural Earth</a>.
    Northeastern and southeastern B.C. follow the communities named in the province’s
    <a href="#ref-bc-dst">time-zone guidance</a>; southeastern offsets are confirmed by the
    <a href="#ref-rdek">East Kootenay decision</a> and <a href="#ref-golden">Golden’s October 29 reminder</a>.
    <a href="#ref-abt">Alberta</a>, the <a href="#ref-nwt">Northwest Territories</a>,
    <a href="#ref-yukon">Yukon</a> and <a href="#ref-sk">Saskatchewan</a> publish the offsets used here.
    U.S. time-zone lines are simplified from the <a href="#ref-us-map">BTS boundary map</a>, based on
    <a href="#ref-us-zones">49 CFR Part 71</a>, and the fall-back hour is the
    <a href="#ref-nist">NIST date</a> already cited below.
    Nunavut spans more than one time zone and is not shown. The western Aleutians are cropped.
  </p>
      </div>
    </div>
  </dialog>
</div>

<style>
  .clock-map-entry {
    margin-top: 36px;
    scroll-margin-top: 16px;
  }

  .clock-map-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    margin: 0;
    padding: 8px 12px;
    border: 1px solid #30363d;
    border-radius: 10px;
    background: #121820;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 14.5px;
    font-weight: 600;
    line-height: 1.3;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    appearance: none;
    transition: border-color 160ms ease, color 160ms ease;
  }

  .clock-map-trigger:hover {
    border-color: var(--accent-gold);
    color: #f5f0e8;
  }

  .clock-map-trigger:focus-visible {
    outline: 2px solid var(--accent-blue);
    outline-offset: 3px;
  }

  .trigger-icon,
  .trigger-chevron {
    flex: none;
    color: var(--accent-gold);
  }

  .trigger-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .label-short { display: none; }

  .regional-clocks {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }

  .dialog-bar {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 12px 12px 10px;
    border-bottom: 1px solid #30363d;
    background: var(--card-bg);
  }

  .dialog-bar h2 {
    grid-column: 2;
    margin: 0;
    text-align: center;
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: clamp(17px, 2.2vw, 26px);
    line-height: 1.15;
    letter-spacing: -0.02em;
    color: #f5f0e8;
  }

  .dialog-close-form { grid-column: 3; }

  .dialog-close {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-left: auto;
    padding: 0;
    border: 1px solid #30363d;
    border-radius: 50%;
    background: #0d1117;
    color: #f5f0e8;
    cursor: pointer;
  }

  .dialog-close:hover {
    border-color: var(--accent-gold);
    color: var(--accent-gold);
  }

  .dialog-close:focus-visible {
    outline: 2px solid var(--accent-blue);
    outline-offset: 2px;
  }

  .dialog-body {
    min-height: 0;
    flex: 1 1 auto;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 14px clamp(12px, 2vw, 18px) 16px;
  }

  :global(dialog.clock-dialog[open]) {
    display: flex !important;
    flex-direction: column;
    width: min(1040px, calc(100vw - 24px));
    height: min(880px, calc(100dvh - 24px));
    max-width: calc(100vw - 16px);
    max-height: calc(100dvh - 16px);
    margin: auto;
    padding: 0;
    border: 1px solid #30363d;
    border-radius: 16px;
    background: var(--card-bg);
    color: var(--text-primary);
    box-shadow: 0 28px 80px rgba(0, 0, 0, 0.55);
    overflow: hidden;
  }

  :global(dialog.clock-dialog::backdrop) {
    background: rgba(6, 8, 12, 0.72);
  }

  :global(html.clock-dialog-open) {
    overflow: hidden;
  }

  @media (max-width: 719px) {
    .label-long { display: none; }
    .label-short { display: inline; }
  }

  @media (max-width: 359px) {
    .clock-map-trigger {
      font-size: 13.5px;
      padding: 8px 10px;
    }
  }

  @media (max-width: 640px) {
    :global(dialog.clock-dialog[open]) {
      width: calc(100vw - 12px);
      height: calc(100dvh - 12px);
      max-height: calc(100dvh - 12px);
      border-radius: 14px;
    }
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

  .map-pair { display: grid; gap: 16px; }
  .map-card { margin: 0; min-width: 0; }
  figcaption {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 8px;
  }
  .cap-kicker {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: clamp(18px, 2vw, 22px);
    color: #f5f0e8;
    letter-spacing: -0.02em;
  }
  .cap-note { color: var(--text-muted); font-size: 12px; font-weight: 600; }

  .map-layout {
    display: grid;
    grid-template-columns: 108px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
  }
  .map-stage { position: relative; min-width: 0; order: 2; }
  .alaska-card { order: 1; }
  .map-stage svg, .alaska-svg { display: block; width: 100%; height: auto; }
  .ocean { fill: #10161d; }

  .zone {
    stroke: rgba(247, 244, 238, 0.92);
    stroke-width: 1px;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .zone.sub {
    stroke: #1a140c;
    stroke-width: 1.25px;
    stroke-dasharray: 3 2.2;
  }
  .zone.off7 { fill: #f0c654; }
  .zone.off6 { fill: #e36a45; }
  .zone.off8 { fill: #8ec8ff; }
  .zone.off9 { fill: #1f4e8c; }
  .hatch { pointer-events: none; }

  .alaska-card {
    background: #10161d;
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 8px 8px 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .alaska-svg { width: min(100%, 96px); }
  .alaska-card .map-callout {
    position: static;
    transform: none;
    color: #f5f0e8;
    margin-top: 2px;
    text-shadow: none;
  }
  .alaska-card .place { color: #f7f4ee; font-size: 12px; }
  .alaska-card .when { color: #f0c654; font-size: 20px; }
  .alaska-card .off, .alaska-card .hint {
    display: block;
    color: #8b949e;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .you-pin, .creston-pin {
    position: absolute;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .you-pin {
    width: 11px;
    height: 11px;
    background: #f7f4ee;
    border: 2px solid #14120c;
    box-shadow: 0 0 0 3px #f0c654;
    z-index: 2;
  }
  .creston-pin {
    width: 7px;
    height: 7px;
    background: transparent;
    border: 1.5px solid #1a140c;
    box-shadow: 0 0 0 1.5px rgba(247, 244, 238, 0.85);
  }

  .map-callouts { list-style: none; margin: 0; padding: 0; }
  .map-callout {
    position: absolute;
    transform: translate(-50%, -50%);
    text-align: center;
    line-height: 1.02;
    font-weight: 700;
    color: #1a140c;
    pointer-events: none;
    white-space: nowrap;
    text-shadow:
      0 1px 0 rgba(247, 244, 238, 0.95),
      0 -1px 0 rgba(247, 244, 238, 0.95),
      1px 0 0 rgba(247, 244, 238, 0.95),
      -1px 0 0 rgba(247, 244, 238, 0.95);
  }
  .map-callout .place, .map-callout .when { display: block; }
  .map-callout .place {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .map-callout .when {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: 14px;
    letter-spacing: -0.02em;
  }

  .clock-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    list-style: none;
    margin: 14px 0 16px;
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
  .swatch.utc6 { background: #e36a45; }
  .swatch.utc8 { background: #8ec8ff; }
  .swatch.utc9 { background: #1f4e8c; }
  .swatch.striped {
    background-color: #c8c1b4;
    background-image: repeating-linear-gradient(38deg, transparent 0 3px, rgba(26, 20, 12, 0.45) 3px 4.4px);
  }
  .swatch.home {
    width: 12px;
    height: 12px;
    background: #f7f4ee;
    border: 2px solid #14120c;
    border-radius: 50%;
    box-shadow: 0 0 0 2px #f0c654;
  }

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
  .badge-back { color: #14120c; background: #f0c654; }

  .clock-notes {
    margin: 12px 0 0;
    color: var(--text-muted);
    font-size: 12.5px;
    line-height: 1.55;
  }
  .clock-notes a { color: var(--accent-gold); }

  @media (max-width: 899px) {
    .map-card.map-nov1 { display: none; }
    .regional-clocks:has(#clock-nov1:checked) .map-card.map-oct31 { display: none; }
    .regional-clocks:has(#clock-nov1:checked) .map-card.map-nov1 { display: block; }
  }

  @media (min-width: 900px) {
    .map-pair { grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
    /* Keep the morning control focusable so arrow keys still switch it while both maps stay on screen. */
    .clock-toggle {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: 0;
      padding: 0;
      overflow: hidden;
      opacity: 0;
      border: 0;
      pointer-events: none;
    }
    .map-callout .when { font-size: 15px; }
    .map-callout .place { font-size: 11px; }
  }

  @media (max-width: 719px) {
    .map-layout { grid-template-columns: 1fr; }
    .alaska-card {
      order: 0;
      flex-direction: row;
      justify-content: flex-start;
      gap: 12px;
      text-align: left;
      padding: 8px 12px;
    }
    .alaska-svg { width: 78px; flex: none; }
    .alaska-card .map-callout { margin-top: 0; }
    .alaska-card .when { font-size: 26px; }
    .map-callout.minor .place { display: none; }
    .map-callout .when { font-size: 13px; }
    .map-stage { order: 1; }
    table { font-size: 12.5px; }
    th, td { padding: 8px 8px; }
    tbody th[scope="row"] { width: 46%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .zone, .clock-map-trigger { transition: none; }
  }
</style>

