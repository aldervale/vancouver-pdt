<script lang="ts">
  import { onMount } from 'svelte';

  let canvas: HTMLCanvasElement;
  let overlayCanvas: HTMLCanvasElement;

  // Vancouver sunrise/sunset under permanent PDT (UTC-7)
  // Mid-month (15th) values in decimal hours (24h clock), UTC-7 year-round
  // Source: U.S. Naval Observatory API (aa.usno.navy.mil) for 49.25°N, 123.1°W
  const baseData = [
    { month: 'Jan', sunrise: 9.03, sunset: 17.70 },  // 9:02 / 5:42 PM
    { month: 'Feb', sunrise: 8.35, sunset: 18.55 },  // 8:21 / 6:33 PM
    { month: 'Mar', sunrise: 7.42, sunset: 19.30 },  // 7:25 / 7:18 PM
    { month: 'Apr', sunrise: 6.33, sunset: 20.08 },  // 6:20 / 8:05 PM
    { month: 'May', sunrise: 5.48, sunset: 20.82 },  // 5:29 / 8:49 PM
    { month: 'Jun', sunrise: 5.10, sunset: 21.33 },  // 5:06 / 9:20 PM
    { month: 'Jul', sunrise: 5.40, sunset: 21.22 },  // 5:24 / 9:13 PM
    { month: 'Aug', sunrise: 6.07, sunset: 20.47 },  // 6:04 / 8:28 PM
    { month: 'Sep', sunrise: 6.82, sunset: 19.42 },  // 6:49 / 7:25 PM
    { month: 'Oct', sunrise: 7.57, sunset: 18.37 },  // 7:34 / 6:22 PM
    { month: 'Nov', sunrise: 8.38, sunset: 17.50 },  // 8:23 / 5:30 PM
    { month: 'Dec', sunrise: 9.02, sunset: 17.23 },  // 9:01 / 5:14 PM
  ];

  // DST adjustment: winter months (Jan, Feb, Nov, Dec) shift -1hr
  const dstData = baseData.map((d, i) =>
    [0, 1, 10, 11].includes(i)
      ? { ...d, sunrise: d.sunrise - 1, sunset: d.sunset - 1 }
      : d
  );

  // PST: all months -1hr
  const pstData = baseData.map(d => ({ ...d, sunrise: d.sunrise - 1, sunset: d.sunset - 1 }));

  let wakeHour = $state(7);
  let sleepHour = $state(23);
  let mode: 'pdt' | 'dst' | 'pst' = $state('pdt');

  const activeData = $derived(
    mode === 'pdt' ? baseData : mode === 'dst' ? dstData : pstData
  );

  const accentColor = $derived(
    mode === 'pdt' ? 'var(--accent-gold)' : mode === 'dst' ? '#8b949e' : 'var(--accent-blue)'
  );

  function formatHour(h: number): string {
    const period = h < 12 || h >= 24 ? 'AM' : 'PM';
    let display = h % 12;
    if (display === 0) display = 12;
    return `${display} ${period}`;
  }

  function decimalToTime(d: number): string {
    const h = Math.floor(d);
    const m = Math.round((d - h) * 60);
    return `${h}:${m.toString().padStart(2, '0')}`;
  }

  function fmtTime(h: number): string {
    const hour = Math.floor(h);
    const min = Math.round((h - hour) * 60);
    const suffix = hour < 12 ? 'AM' : 'PM';
    const h12 = hour % 12 || 12;
    return `${h12}:${min.toString().padStart(2, '0')} ${suffix}`;
  }

  // Catmull-Rom spline interpolation for smooth curves
  function catmullRomPoints(pts: {x: number, y: number}[], segments = 20): {x: number, y: number}[] {
    const result: {x: number, y: number}[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let t = 0; t <= 1; t += 1 / segments) {
        const t2 = t * t;
        const t3 = t2 * t;
        const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        result.push({ x, y });
      }
    }
    return result;
  }

  // Compute stats from active dataset
  const stats = $derived.by(() => {
    const data = activeData;
    let latestSunrise = -Infinity;
    let earliestSunrise = Infinity;
    let latestSunset = -Infinity;
    let earliestSunset = Infinity;

    data.forEach(d => {
      if (d.sunrise > latestSunrise) latestSunrise = d.sunrise;
      if (d.sunrise < earliestSunrise) earliestSunrise = d.sunrise;
      if (d.sunset > latestSunset) latestSunset = d.sunset;
      if (d.sunset < earliestSunset) earliestSunset = d.sunset;
    });

    return {
      latestSunrise: decimalToTime(latestSunrise),
      earliestSunrise: decimalToTime(earliestSunrise),
      latestSunset: decimalToTime(latestSunset),
      earliestSunset: decimalToTime(earliestSunset),
    };
  });

  const modeLabel = $derived(
    mode === 'pdt' ? 'permanent PDT' : mode === 'dst' ? 'old DST' : 'permanent PST'
  );

  function draw() {
    if (!canvas) return;
    const data = activeData;
    const WAKE = wakeHour;
    const SLEEP = sleepHour;

    const TEXT_MUTED = '#8b949e';
    const DARK_BG = '#0d1117';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement!.getBoundingClientRect();
    const W = rect.width - 40;
    const H = 420;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    const padLeft = 80;
    const padRight = 70;
    const padTop = 10;
    const padBottom = 40;

    const chartW = W - padLeft - padRight;
    const chartH = H - padTop - padBottom;

    const yMin = 4;
    const yMax = 23;

    function yPos(hour: number) {
      return padTop + (hour - yMin) / (yMax - yMin) * chartH;
    }

    function xPos(i: number) {
      return padLeft + (i / (data.length - 1)) * chartW;
    }

    const colW = chartW / data.length;
    const wakeY = yPos(WAKE);
    const sleepY = yPos(SLEEP);

    // Determine fill colors based on mode
    const goldFillStart = mode === 'pdt' ? 'rgba(251, 191, 36, 0.40)'
      : mode === 'dst' ? 'rgba(139, 148, 158, 0.30)'
      : 'rgba(88, 166, 255, 0.35)';
    const goldFillMid = mode === 'pdt' ? 'rgba(240, 198, 84, 0.50)'
      : mode === 'dst' ? 'rgba(139, 148, 158, 0.40)'
      : 'rgba(88, 166, 255, 0.45)';
    const goldFillEnd = mode === 'pdt' ? 'rgba(231, 130, 60, 0.35)'
      : mode === 'dst' ? 'rgba(139, 148, 158, 0.25)'
      : 'rgba(88, 130, 255, 0.30)';

    // Single dark background
    ctx.fillStyle = DARK_BG;
    ctx.fillRect(padLeft, padTop, chartW, chartH);

    // Waking window — subtle warm tint
    ctx.fillStyle = 'rgba(230, 220, 200, 0.04)';
    ctx.fillRect(padLeft, wakeY, chartW, sleepY - wakeY);

    // Darkness while awake — pre-dawn and evening fills
    data.forEach((d, i) => {
      const cx = xPos(i);
      const halfCol = (i === 0 || i === data.length - 1) ? chartW / (data.length - 1) / 2 : chartW / (data.length - 1) / 2;
      const colLeft = Math.max(padLeft, cx - halfCol);
      const colRight = Math.min(padLeft + chartW, cx + halfCol);
      const w = colRight - colLeft;
      // Pre-dawn: awake but dark before sunrise
      if (d.sunrise > WAKE) {
        const sunriseY = yPos(d.sunrise);
        ctx.fillStyle = 'rgba(20, 30, 60, 0.65)';
        ctx.fillRect(colLeft, wakeY, w, sunriseY - wakeY);
      }
      // Evening: awake but dark after sunset
      if (d.sunset < SLEEP) {
        const sunsetY = yPos(d.sunset);
        ctx.fillStyle = 'rgba(20, 30, 60, 0.65)';
        ctx.fillRect(colLeft, sunsetY, w, sleepY - sunsetY);
      }
    });

    // Build spline points for sunrise and sunset
    const sunrisePts = data.map((d, i) => ({ x: xPos(i), y: yPos(d.sunrise) }));
    const sunsetPts = data.map((d, i) => ({ x: xPos(i), y: yPos(d.sunset) }));
    const sunriseSpline = catmullRomPoints(sunrisePts, 24);
    const sunsetSpline = catmullRomPoints(sunsetPts, 24);

    // Fill: sunlight during waking hours
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, wakeY, chartW, sleepY - wakeY);
    ctx.clip();

    ctx.beginPath();
    sunriseSpline.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    for (let i = sunsetSpline.length - 1; i >= 0; i--) {
      ctx.lineTo(sunsetSpline[i].x, sunsetSpline[i].y);
    }
    ctx.closePath();
    const goldGrad = ctx.createLinearGradient(0, wakeY, 0, sleepY);
    goldGrad.addColorStop(0, goldFillStart);
    goldGrad.addColorStop(0.5, goldFillMid);
    goldGrad.addColorStop(1, goldFillEnd);
    ctx.fillStyle = goldGrad;
    ctx.fill();
    ctx.restore();

    // Fill: "wasted" sun before wake time — blue hatching
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, padTop, chartW, wakeY - padTop);
    ctx.clip();

    // Clip to the daylight area (between sunrise and sunset curves)
    ctx.beginPath();
    sunriseSpline.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    for (let i = sunsetSpline.length - 1; i >= 0; i--) {
      ctx.lineTo(sunsetSpline[i].x, sunsetSpline[i].y);
    }
    ctx.closePath();
    ctx.clip();

    // Draw blue diagonal hatching
    ctx.strokeStyle = 'rgba(88, 166, 255, 0.22)';
    ctx.lineWidth = 1;
    for (let ly = padTop - chartW; ly < wakeY + chartW; ly += 6) {
      ctx.beginPath();
      ctx.moveTo(padLeft, ly);
      ctx.lineTo(padLeft + chartW, ly + chartW);
      ctx.stroke();
    }
    ctx.restore();

    // Fill: sun after sleep time — also hatched but dimmer
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, sleepY, chartW, padTop + chartH - sleepY);
    ctx.clip();

    ctx.beginPath();
    sunriseSpline.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    for (let i = sunsetSpline.length - 1; i >= 0; i--) {
      ctx.lineTo(sunsetSpline[i].x, sunsetSpline[i].y);
    }
    ctx.closePath();
    ctx.clip();

    ctx.strokeStyle = 'rgba(88, 166, 255, 0.12)';
    ctx.lineWidth = 1;
    for (let ly = sleepY - chartW; ly < padTop + chartH + chartW; ly += 6) {
      ctx.beginPath();
      ctx.moveTo(padLeft, ly);
      ctx.lineTo(padLeft + chartW, ly + chartW);
      ctx.stroke();
    }
    ctx.restore();

    // DST annotation markers
    if (mode === 'dst') {
      const springX = (xPos(1) + xPos(2)) / 2;
      const fallX = (xPos(9) + xPos(10)) / 2;

      ctx.save();
      ctx.strokeStyle = 'rgba(139, 148, 158, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);

      // Spring forward line
      ctx.beginPath();
      ctx.moveTo(springX, padTop);
      ctx.lineTo(springX, padTop + chartH);
      ctx.stroke();

      // Fall back line
      ctx.beginPath();
      ctx.moveTo(fallX, padTop);
      ctx.lineTo(fallX, padTop + chartH);
      ctx.stroke();

      ctx.setLineDash([]);

      // Labels above chart
      ctx.fillStyle = '#8b949e';
      ctx.font = '600 9px "DM Sans"';
      ctx.textAlign = 'center';
      ctx.fillText('\u25B2 Spring Forward', springX, padTop - 14 + 10);
      ctx.fillText('\u25BC Fall Back', fallX, padTop - 14 + 10);
      ctx.restore();
    }

    // Wake / sleep horizontal lines
    ctx.strokeStyle = 'rgba(230, 237, 243, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, wakeY);
    ctx.lineTo(padLeft + chartW, wakeY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padLeft, sleepY);
    ctx.lineTo(padLeft + chartW, sleepY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Wake/sleep labels
    ctx.fillStyle = 'rgba(230, 237, 243, 0.5)';
    ctx.font = '600 9px "DM Sans"';
    ctx.textAlign = 'right';
    ctx.fillText(`WAKE ${formatHour(WAKE)}`, padLeft - 6, wakeY + 3);
    ctx.fillText(`SLEEP ${formatHour(SLEEP)}`, padLeft - 6, sleepY + 3);

    // Sunrise curve (orange/red) — smooth catmull-rom
    ctx.strokeStyle = '#e76f51';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    sunriseSpline.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();

    // Sunset curve (gold/yellow)
    ctx.strokeStyle = '#f0c654';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    sunsetSpline.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();

    // Curve labels
    ctx.font = '600 10px "DM Sans"';
    ctx.fillStyle = '#e76f51';
    ctx.textAlign = 'left';
    ctx.fillText('SUNRISE', padLeft + chartW + 8, yPos(data[11].sunrise) + 3);
    ctx.fillStyle = '#f0c654';
    ctx.fillText('SUNSET', padLeft + chartW + 8, yPos(data[11].sunset) + 3);

    // Y-axis hour labels
    ctx.font = '500 10px "DM Sans"';
    ctx.textAlign = 'right';
    for (let h = 5; h <= 22; h++) {
      if (h === WAKE || h === SLEEP) continue;
      const y = yPos(h);
      if (h === 12) {
        ctx.fillStyle = 'rgba(230, 237, 243, 0.35)';
        ctx.fillText('NOON', padLeft - 6, y + 3);
        ctx.strokeStyle = 'rgba(230, 237, 243, 0.06)';
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + chartW, y);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(230, 237, 243, 0.2)';
        const label = h <= 12 ? `${h} AM` : `${h - 12} PM`;
        ctx.fillText(label, padLeft - 6, y + 3);
      }
    }

    // X-axis month labels
    ctx.fillStyle = TEXT_MUTED;
    ctx.font = '600 11px "DM Sans"';
    ctx.textAlign = 'center';
    data.forEach((d, i) => {
      ctx.fillText(d.month, xPos(i), padTop + chartH + 24);
    });

    // Dot markers
    data.forEach((d, i) => {
      const x = xPos(i);

      ctx.beginPath();
      ctx.arc(x, yPos(d.sunrise), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#e76f51';
      ctx.fill();
      ctx.strokeStyle = DARK_BG;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, yPos(d.sunset), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f0c654';
      ctx.fill();
      ctx.strokeStyle = DARK_BG;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // Key time labels on the chart — find actual extremes
    const maxSunriseIdx = data.reduce((mi, d, i, arr) => d.sunrise > arr[mi].sunrise ? i : mi, 0);
    const minSunriseIdx = data.reduce((mi, d, i, arr) => d.sunrise < arr[mi].sunrise ? i : mi, 0);
    const maxSunsetIdx = data.reduce((mi, d, i, arr) => d.sunset > arr[mi].sunset ? i : mi, 0);
    const minSunsetIdx = data.reduce((mi, d, i, arr) => d.sunset < arr[mi].sunset ? i : mi, 0);

    ctx.font = '700 9px "DM Sans"';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e76f51';
    ctx.fillText(decimalToTime(data[maxSunriseIdx].sunrise), xPos(maxSunriseIdx), yPos(data[maxSunriseIdx].sunrise) - 8);
    ctx.fillText(decimalToTime(data[minSunriseIdx].sunrise), xPos(minSunriseIdx), yPos(data[minSunriseIdx].sunrise) - 8);
    ctx.fillStyle = '#f0c654';
    ctx.fillText(decimalToTime(data[maxSunsetIdx].sunset), xPos(maxSunsetIdx), yPos(data[maxSunsetIdx].sunset) + 15);
    ctx.fillText(decimalToTime(data[minSunsetIdx].sunset), xPos(minSunsetIdx), yPos(data[minSunsetIdx].sunset) + 15);

    // Save layout for tooltip
    chartLayout = { padLeft, padTop, chartW, chartH, W, H, yMin, yMax };
  }

  // Store chart layout for tooltip use
  let chartLayout = $state({ padLeft: 0, padTop: 0, chartW: 0, chartH: 0, W: 0, H: 0, yMin: 4, yMax: 23 });

  function setupOverlay() {
    if (!overlayCanvas || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;
    overlayCanvas.style.width = canvas.style.width;
    overlayCanvas.style.height = canvas.style.height;
  }

  function handleMouseMove(e: MouseEvent) {
    if (!overlayCanvas) return;
    const data = activeData;
    const { padLeft, padTop, chartW, chartH, yMin, yMax } = chartLayout;
    const dpr = window.devicePixelRatio || 1;
    const rect = overlayCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left);
    const my = (e.clientY - rect.top);

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    ctx.scale(dpr, dpr);

    // Determine which month column
    const relX = mx - padLeft;
    if (relX < 0 || relX > chartW || my < padTop || my > padTop + chartH) return;

    // Find closest month index
    let monthIdx = Math.round(relX / chartW * (data.length - 1));
    monthIdx = Math.max(0, Math.min(data.length - 1, monthIdx));

    const cx = padLeft + (monthIdx / (data.length - 1)) * chartW;

    // Vertical indicator line
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, padTop);
    ctx.lineTo(cx, padTop + chartH);
    ctx.stroke();

    // Tooltip box
    const d = data[monthIdx];
    const lines = [
      d.month,
      `🌅 Sunrise: ${fmtTime(d.sunrise)}`,
      `🌇 Sunset: ${fmtTime(d.sunset)}`,
    ];

    ctx.font = '600 13px "DM Sans"';
    const boldWidth = ctx.measureText(d.month).width;
    ctx.font = '400 12px "DM Sans"';
    const lineWidths = lines.slice(1).map(l => ctx.measureText(l).width);
    const boxW = Math.max(boldWidth, ...lineWidths) + 28;
    const boxH = 68;

    let tx = mx + 14;
    let ty = my - boxH / 2;
    // Keep within canvas
    if (tx + boxW > padLeft + chartW) tx = mx - boxW - 14;
    if (ty < padTop) ty = padTop;
    if (ty + boxH > padTop + chartH) ty = padTop + chartH - boxH;

    ctx.fillStyle = '#0d1117';
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tx, ty, boxW, boxH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#e6edf3';
    ctx.font = '700 13px "DM Sans"';
    ctx.textAlign = 'left';
    ctx.fillText(d.month, tx + 14, ty + 20);
    ctx.font = '400 12px "DM Sans"';
    ctx.fillText(lines[1], tx + 14, ty + 38);
    ctx.fillText(lines[2], tx + 14, ty + 56);
  }

  function handleMouseLeave() {
    if (!overlayCanvas) return;
    const ctx = overlayCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }

  $effect(() => {
    // Access reactive state to trigger redraw
    wakeHour;
    sleepHour;
    mode;
    draw();
    setupOverlay();
  });

  onMount(() => {
    draw();
    setupOverlay();
    window.addEventListener('resize', () => { draw(); setupOverlay(); });
    return () => window.removeEventListener('resize', () => { draw(); setupOverlay(); });
  });
</script>

<svelte:head>
  <title>Vancouver Permanent Daylight Time — Daylight Impact</title>
</svelte:head>

<div class="container">
  <header>
    <div class="badge">Announced March 2, 2026</div>
    <h1>No More Clock Changes<br />for Vancouver</h1>
    {#if mode === 'pdt'}
      <p class="subtitle">
        B.C. is adopting <strong>permanent daylight time (UTC−7)</strong> after the final spring-forward
        on March 8, 2026. Here's how it reshapes the daylight you'll actually experience during your
        waking hours.
      </p>
    {:else if mode === 'dst'}
      <p class="subtitle">
        How daylight looked under the old clock-change system — spring forward in March, fall back in November.
      </p>
    {:else}
      <p class="subtitle">
        The alternative B.C. rejected — permanent standard time (UTC−8). Brighter mornings, darker evenings, all year.
      </p>
    {/if}
  </header>

  <div class="selector-row">
    <div class="selector">
      <label for="wake-slider">Wake up</label>
      <div class="stepper">
        <button onclick={() => { if (wakeHour > 4) wakeHour-- }} aria-label="Earlier wake time">−</button>
        <span class="stepper-value">{formatHour(wakeHour)}</span>
        <button onclick={() => { if (wakeHour < 11) wakeHour++ }} aria-label="Later wake time">+</button>
      </div>
      <input id="wake-slider" type="range" min="4" max="11" bind:value={wakeHour} />
    </div>
    <div class="selector">
      <label for="sleep-slider">Bedtime</label>
      <div class="stepper">
        <button onclick={() => { if (sleepHour > 19) sleepHour-- }} aria-label="Earlier bedtime">−</button>
        <span class="stepper-value">{formatHour(sleepHour)}</span>
        <button onclick={() => { if (sleepHour < 25) sleepHour++ }} aria-label="Later bedtime">+</button>
      </div>
      <input id="sleep-slider" type="range" min="19" max="25" bind:value={sleepHour} />
    </div>
  </div>

  <div class="mode-toggle">
    <button class:active={mode === 'pdt'} class="mode-pdt" onclick={() => mode = 'pdt'}>Permanent PDT</button>
    <button class:active={mode === 'dst'} class="mode-dst" onclick={() => mode = 'dst'}>Old DST</button>
    <button class:active={mode === 'pst'} class="mode-pst" onclick={() => mode = 'pst'}>Permanent PST</button>
  </div>

  <div class="chart-wrapper">
    <div class="chart-title">Daylight vs. Waking Hours Across the Year</div>
    <div class="chart-subtitle">
      {#if mode === 'pdt'}
        Permanent PDT (UTC−7) · Sunrise &amp; sunset curves plotted against your {formatHour(wakeHour)}–{formatHour(sleepHour)} awake window
      {:else if mode === 'dst'}
        Old DST (UTC−8 winter / UTC−7 summer) · Sunrise &amp; sunset curves plotted against your {formatHour(wakeHour)}–{formatHour(sleepHour)} awake window
      {:else}
        Permanent PST (UTC−8) · Sunrise &amp; sunset curves plotted against your {formatHour(wakeHour)}–{formatHour(sleepHour)} awake window
      {/if}
    </div>
    <div class="canvas-container">
      <canvas bind:this={canvas}></canvas>
      <canvas bind:this={overlayCanvas} class="overlay-canvas" onmousemove={handleMouseMove} onmouseleave={handleMouseLeave}></canvas>
    </div>
    <div class="legend">
      <div class="legend-item">
        <div class="legend-swatch" style="background: linear-gradient(90deg, rgba(251,191,36,0.5), rgba(240,198,84,0.6));"></div>
        <span>Sunlight while you're awake</span>
      </div>
      <div class="legend-item">
        <div class="legend-swatch" style="background: repeating-linear-gradient(45deg, #58a6ff33, #58a6ff33 2px, transparent 2px, transparent 4px); border: 1px solid #58a6ff55;"></div>
        <span>Sunlight while you're asleep</span>
      </div>
      <div class="legend-item">
        <div class="legend-line-swatch" style="background: #e76f51;"></div>
        <span>Sunrise</span>
      </div>
      <div class="legend-item">
        <div class="legend-line-swatch" style="background: #f0c654;"></div>
        <span>Sunset</span>
      </div>
      <div class="legend-item">
        <div class="legend-swatch" style="background: rgba(20,30,60,0.9); border: 1px solid rgba(88,133,255,0.3);"></div>
        <span>Darkness while you're awake</span>
      </div>
    </div>
  </div>

  <div class="stats-strip">
    <div class="stat-card">
      <div class="stat-number orange">{stats.latestSunrise}</div>
      <div class="stat-label">Latest sunrise (AM)<br />under {modeLabel}</div>
    </div>
    <div class="stat-card">
      <div class="stat-number blue">{stats.earliestSunrise}</div>
      <div class="stat-label">Earliest sunrise (AM)<br />under {modeLabel}</div>
    </div>
    <div class="stat-card">
      <div class="stat-number gold">{stats.latestSunset}</div>
      <div class="stat-label">Latest sunset (PM)<br />under {modeLabel}</div>
    </div>
    <div class="stat-card">
      <div class="stat-number gold">{stats.earliestSunset}</div>
      <div class="stat-label">Earliest sunset (PM)<br />under {modeLabel}</div>
    </div>
    {#if mode === 'dst'}
      <div class="stat-card">
        <div class="stat-number dst-grey">2</div>
        <div class="stat-label">Clock changes<br />per year</div>
      </div>
    {/if}
  </div>

  <div class="insight-row">
    <div class="insight-card pro">
      <div class="insight-label">The Evening Win</div>
      <div class="insight-text">
        In winter, sunset shifts from <strong>~4:15 PM</strong> (old PST) to <strong>~5:15 PM</strong>
        permanent PDT. That means an extra hour of usable daylight after work and school — huge for
        outdoor activities, commuting safety, and mood.
      </div>
    </div>
    <div class="insight-card con">
      <div class="insight-label">The Morning Trade-off</div>
      <div class="insight-text">
        Sunrise in late December won't arrive until <strong>~9:05 AM</strong> — over two hours after
        a 7 AM wake-up. Kids heading to school and early commuters will start the day in
        <strong>full darkness</strong> for about 3 months (Nov–Jan).
      </div>
    </div>
  </div>

  <footer>
    Sunrise/sunset data from the <a href="https://aa.usno.navy.mil/data/rstt" target="_blank" rel="noopener">U.S. Naval Observatory</a>
    for Vancouver (49.25°N, 123.1°W) under permanent UTC−7, mid-month values.
    Waking window is user-configurable above.
    B.C. legislation passed March 2026. Permanent PDT takes effect after the final spring-forward on March 8, 2026.
  </footer>
</div>

<style>
  .container {
    max-width: 1100px;
    margin: 0 auto;
    padding: 40px 24px 60px;
  }

  header {
    text-align: center;
    margin-bottom: 12px;
  }

  .badge {
    display: inline-block;
    background: linear-gradient(135deg, var(--accent-orange), var(--accent-gold));
    color: var(--dark-bg);
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
    padding: 6px 16px;
    border-radius: 20px;
    margin-bottom: 20px;
  }

  h1 {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: clamp(28px, 5vw, 52px);
    line-height: 1.1;
    margin-bottom: 12px;
    background: linear-gradient(135deg, #fff 40%, var(--accent-gold));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: 15px;
    max-width: 640px;
    margin: 0 auto 8px;
    line-height: 1.5;
  }

  .subtitle strong {
    color: var(--text-primary);
  }

  /* Mode toggle */
  .mode-toggle {
    display: flex;
    background: var(--card-bg);
    border: 1px solid #30363d;
    border-radius: 24px;
    padding: 4px;
    gap: 2px;
    width: fit-content;
    margin: 24px auto 0;
  }

  .mode-toggle button {
    border: none;
    border-radius: 20px;
    padding: 8px 20px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    background: transparent;
    color: var(--text-muted);
    letter-spacing: 0.5px;
  }

  .mode-toggle button.mode-pdt.active {
    background: var(--accent-gold);
    color: var(--dark-bg);
  }

  .mode-toggle button.mode-dst.active {
    background: #8b949e;
    color: var(--dark-bg);
  }

  .mode-toggle button.mode-pst.active {
    background: var(--accent-blue);
    color: var(--dark-bg);
  }

  /* Wake/Sleep selector */
  .selector-row {
    display: flex;
    justify-content: center;
    gap: 40px;
    margin-top: 28px;
    flex-wrap: wrap;
  }

  .selector {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .selector label {
    font-size: 10px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--text-muted);
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .stepper button {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid #30363d;
    background: var(--card-bg);
    color: var(--text-primary);
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.15s;
    line-height: 1;
  }

  .stepper button:hover {
    border-color: var(--accent-gold);
  }

  .stepper-value {
    font-family: 'Playfair Display', serif;
    font-weight: 700;
    font-size: 20px;
    min-width: 70px;
    text-align: center;
    color: var(--text-primary);
  }

  .selector input[type="range"] {
    width: 160px;
    accent-color: var(--accent-gold);
    opacity: 0.6;
  }

  /* Chart */
  .chart-wrapper {
    background: var(--card-bg);
    border-radius: 16px;
    padding: 32px 20px 20px;
    margin-top: 20px;
    border: 1px solid #30363d;
    position: relative;
    overflow: hidden;
  }

  .chart-title {
    font-weight: 700;
    font-size: 15px;
    margin-bottom: 4px;
    color: var(--text-primary);
  }

  .chart-subtitle {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 24px;
  }

  .canvas-container {
    position: relative;
  }

  canvas {
    display: block;
    width: 100% !important;
  }

  .overlay-canvas {
    position: absolute;
    top: 0;
    left: 0;
    cursor: crosshair;
  }

  /* Legend */
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    justify-content: center;
    margin-top: 20px;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .legend-swatch {
    width: 32px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .legend-line-swatch {
    width: 32px;
    height: 2px;
    border-radius: 1px;
    flex-shrink: 0;
    align-self: center;
  }

  /* Stats */
  .stats-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-top: 28px;
  }

  .stat-card {
    background: var(--card-bg);
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 20px;
    text-align: center;
  }

  .stat-number {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: 36px;
    line-height: 1;
    margin-bottom: 4px;
  }

  .stat-number.gold { color: var(--accent-gold); }
  .stat-number.orange { color: var(--accent-orange); }
  .stat-number.blue { color: var(--accent-blue); }
  .stat-number.dst-grey { color: #8b949e; }

  .stat-label {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  /* Insight cards */
  .insight-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 16px;
  }

  @media (max-width: 640px) {
    .insight-row { grid-template-columns: 1fr; }
    .selector-row { gap: 24px; }
  }

  .insight-card {
    background: var(--card-bg);
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 20px;
    position: relative;
    overflow: hidden;
  }

  .insight-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
  }

  .insight-card.pro::before { background: linear-gradient(90deg, var(--accent-gold), transparent); }
  .insight-card.con::before { background: linear-gradient(90deg, var(--accent-orange), transparent); }

  .insight-label {
    font-size: 10px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    font-weight: 700;
    margin-bottom: 8px;
  }

  .insight-card.pro .insight-label { color: var(--accent-gold); }
  .insight-card.con .insight-label { color: var(--accent-orange); }

  .insight-text {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.6;
  }

  .insight-text strong { color: var(--text-primary); }

  footer {
    text-align: center;
    margin-top: 40px;
    color: var(--text-muted);
    font-size: 11px;
    opacity: 0.6;
    line-height: 1.6;
  }

  footer a {
    color: var(--accent-blue, #58a6ff);
    text-decoration: none;
  }

  footer a:hover {
    text-decoration: underline;
  }
</style>
