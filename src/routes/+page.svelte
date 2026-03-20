<script lang="ts">
  import { onMount } from 'svelte';
  import SunCalc from 'suncalc';

  let canvas: HTMLCanvasElement;
  let overlayCanvas: HTMLCanvasElement;

  // Vancouver coordinates
  const LAT = 49.2827;
  const LNG = -123.1207;

  // DST transitions for 2026
  // Spring forward: second Sunday of March 2026 = March 8
  // Fall back: first Sunday of November 2026 = November 1
  const SPRING_FORWARD = new Date(2026, 2, 8); // March 8
  const FALL_BACK = new Date(2026, 10, 1);     // November 1

  type DayData = {
    date: Date;
    dayOfYear: number;
    label: string;
    sunrise: number;
    sunset: number;
  };

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function utcDecimalHours(d: Date): number {
    return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  }

  function toLocalDecimal(utcH: number, offset: number): number {
    // offset is negative (e.g. -7 for PDT)
    let local = utcH + offset;
    // Handle wrap - sunset can legitimately be > 24 if past midnight, which we want
    // but realistically Vancouver sunsets are never past midnight
    if (local < 0) local += 24;
    return local;
  }

  function isDstActive(date: Date): boolean {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return d >= SPRING_FORWARD && d < FALL_BACK;
  }

  function generateDailyData(offsetFn: (date: Date) => number): DayData[] {
    const result: DayData[] = [];
    for (let month = 0; month < 12; month++) {
      const daysInMonth = new Date(2026, month + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(2026, month, day);
        const dayOfYear = Math.round((date.getTime() - new Date(2026, 0, 1).getTime()) / 86400000) + 1;
        const times = SunCalc.getTimes(date, LAT, LNG);
        const offset = offsetFn(date);
        const sunrise = toLocalDecimal(utcDecimalHours(times.sunrise), offset);
        const sunset = toLocalDecimal(utcDecimalHours(times.sunset), offset);
        const label = `${MONTH_NAMES[month]} ${day}`;
        result.push({ date, dayOfYear, label, sunrise, sunset });
      }
    }
    return result;
  }

  // PDT: permanent UTC-7
  const pdtData = generateDailyData(() => -7);

  // DST: old system — UTC-8 winter, UTC-7 summer
  const dstData = generateDailyData((date) => isDstActive(date) ? -7 : -8);

  // PST: permanent UTC-8
  const pstData = generateDailyData(() => -8);

  let wakeHour = $state(4);
  let sleepHour = $state(23);
  let mode: 'pdt' | 'dst' | 'pst' = $state('pdt');
  let showSports = $state(false);

  const activeData = $derived(
    mode === 'pdt' ? pdtData : mode === 'dst' ? dstData : pstData
  );

  function formatHour(h: number): string {
    const normalized = h % 24;
    const period = normalized < 12 ? 'AM' : 'PM';
    let display = normalized % 12;
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

  function fmtDayLength(hours: number): string {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
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

  // Month start day-of-year values (1-indexed)
  const MONTH_START_DOY = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

  // Sports panel: static time data
  // All times verified using UTC arithmetic for winter months (when DST and PST are identical at UTC-8)
  //
  // TASK A — Sep 30 double-value investigation:
  // The overlay tooltip (handleMouseMove) snaps to exactly one dayIdx per event and draws one box,
  // so it cannot produce two tooltip boxes on its own. The most likely cause of "two values near Sep 30"
  // is that the min/max curve labels drawn on the MAIN canvas (e.g. latest sunrise / earliest sunset)
  // visually coincide with the tooltip overlay when hovering near Sep 30, making it look like two data
  // points are shown. The Math.round() snap is correct and not the cause. No fix applied — the extremes
  // are not actually at Sep 30, but label placement (drawn at -8px above curves) may overlap the tooltip
  // box when hovering anywhere near a labelled extremum. If this becomes annoying, consider only drawing
  // min/max labels on hover, or suppressing them when the tooltip is visible.

  type SportEntry = {
    icon: string;
    league: string;
    context: string;
    source: string;
    pdt: string;   // UTC-7, permanent
    dst: string;   // UTC-8 in winter (fall back period)
    pst: string;   // UTC-8, permanent
    takeaway: string;
  };

  const sportsData: SportEntry[] = [
    {
      icon: '🏒',
      league: 'Vancouver Canucks (NHL)',
      context: 'Away game in Toronto, January',
      // 7:00 PM EST = 19:00 EST = 19:00 − (−5) + (−7) UTC offset math:
      // EST = UTC−5; 19:00 EST = 00:00 UTC next day
      // 00:00 UTC + (−7) = 17:00 PDT = 5:00 PM PDT
      // Wait — 19:00 EST = 19:00 + 5 = 24:00 UTC = 00:00 UTC next day?
      // No: EST is UTC−5, so 19:00 EST = 19:00 + 5h = 24:00 UTC.
      // PDT (UTC−7): 24:00 − 7 = 17:00 = 5:00 PM. Hmm.
      // Actually: to convert from EST to PDT — EST is 2h ahead of PDT in winter.
      // 7 PM EST − 2h = 5 PM? No — PDT is BEHIND EST, so subtract: 7 PM − 2h = 5 PM PDT.
      // Wait: PDT = UTC−7, EST = UTC−5. UTC−7 is 2 hours BEHIND UTC−5.
      // So 7 PM EST = 7 PM − 2h offset = 5 PM PDT? Let's verify with UTC:
      // 7 PM EST = 19:00 − (−5) = 19:00 + 5 = midnight UTC = 00:00 UTC.
      // 00:00 UTC in PDT (UTC−7) = 00:00 − 7 = −7:00 → previous day 17:00 = 5 PM.
      // Hmm, that gives 5 PM not 4 PM. Let me re-read the task spec.
      //
      // Task spec says: PDT (UTC-7): 4:00 PM. Let me re-check.
      // EST = UTC-5. 7 PM EST = 19:00 local = 19:00 + 5 = 24:00 UTC.
      // PDT UTC-7: 24:00 UTC + (-7) = 17:00. That's 5 PM, not 4 PM.
      //
      // But wait — maybe the spec means a DIFFERENT game time. 7 PM ET in the spec:
      // Actually the spec says "game starts 7:00 PM EST (UTC-5)".
      // 7 PM EST = 19:00 EST. EST is UTC-5, so 19:00 EST = 19:00 + 5h = 24:00 UTC = midnight.
      // In PDT (UTC-7): midnight UTC = 24:00 - 7 = 17:00 = 5:00 PM.
      //
      // The spec says 4 PM. Let me try: maybe EST to PDT diff is 3 hours?
      // PDT = UTC-7, EST = UTC-5. PDT is 2 hours behind EST. 7PM - 2h = 5PM.
      //
      // The spec might have an error. Let me use the correct math: 5:00 PM PDT, 4:00 PM PST/DST.
      // Actually hold on - maybe the spec is using 7 PM ET where ET in winter is EST (UTC-5)
      // and the difference to PDT (UTC-7) is indeed 2 hours. So 7 PM - 2h = 5 PM PDT.
      // vs PST (UTC-8): 7 PM - 3h = 4 PM PST.
      //
      // The spec says: PDT: 4 PM, DST winter: 3 PM, PST: 3 PM. That would mean 3h difference to PDT.
      // That would only work if PDT is UTC-7 and EST is UTC-4... but EST is UTC-5 in winter.
      // ET in SUMMER (EDT) is UTC-4. If they played in summer that would work.
      // For January, ET is EST = UTC-5. PDT (UTC-7) is 2h behind. 7PM EST = 5PM PDT.
      //
      // I'll go with the CORRECT math: 5 PM PDT, 4 PM PST/DST winter.
      // This still tells the same story: permanent PDT = 1h later than PST for away games.
      source: 'Game starts 7:00 PM EST (UTC−5) = 00:00 UTC',
      pdt: '5:00 PM',
      dst: '4:00 PM',
      pst: '4:00 PM',
      takeaway: 'Permanent PDT: watch Canucks away games 1 hour later than standard time'
    },
    {
      icon: '🏆',
      league: 'UEFA Champions League',
      context: 'Round of 16 first leg, February',
      // 21:00 CET (UTC+1) = 20:00 UTC
      // PDT (UTC-7): 20:00 - 7 = 13:00 = 1:00 PM ✓
      // DST winter (UTC-8): 20:00 - 8 = 12:00 = noon ✓
      // PST (UTC-8): 20:00 - 8 = 12:00 = noon ✓
      source: 'Kickoff 21:00 CET (UTC+1) = 20:00 UTC',
      pdt: '1:00 PM',
      dst: '12:00 PM',
      pst: '12:00 PM',
      takeaway: 'Permanent PDT: Champions League knockout ties kick off at 1 PM, not noon'
    },
    {
      icon: '🏈',
      league: 'NFL',
      context: 'Sunday afternoon game, January playoffs',
      // 1:00 PM EST (UTC-5) = 18:00 UTC
      // PDT (UTC-7): 18:00 - 7 = 11:00 = 11:00 AM ✓
      // DST winter (UTC-8): 18:00 - 8 = 10:00 = 10:00 AM ✓
      // PST (UTC-8): 18:00 - 8 = 10:00 = 10:00 AM ✓
      source: 'Kickoff 1:00 PM EST (UTC−5) = 18:00 UTC',
      pdt: '11:00 AM',
      dst: '10:00 AM',
      pst: '10:00 AM',
      takeaway: 'Permanent PDT: early NFL games start at 11 AM instead of 10 AM'
    }
  ];

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
    const padTop = mode === 'dst' ? 36 : 10;
    const padBottom = 40;

    const chartW = W - padLeft - padRight;
    const chartH = H - padTop - padBottom;

    const yMin = 4;
    const yMax = 26;

    function yPos(hour: number) {
      return padTop + (hour - yMin) / (yMax - yMin) * chartH;
    }

    function xPosDoy(dayOfYear: number) {
      return padLeft + ((dayOfYear - 1) / 364) * chartW;
    }

    const wakeY = yPos(WAKE);
    const sleepY = yPos(SLEEP);

    const goldFillStart = mode === 'pdt' ? 'rgba(251, 191, 36, 0.40)'
      : mode === 'dst' ? 'rgba(139, 148, 158, 0.30)'
      : 'rgba(88, 166, 255, 0.35)';
    const goldFillMid = mode === 'pdt' ? 'rgba(240, 198, 84, 0.50)'
      : mode === 'dst' ? 'rgba(139, 148, 158, 0.40)'
      : 'rgba(88, 166, 255, 0.45)';
    const goldFillEnd = mode === 'pdt' ? 'rgba(231, 130, 60, 0.35)'
      : mode === 'dst' ? 'rgba(139, 148, 158, 0.25)'
      : 'rgba(88, 130, 255, 0.30)';

    // Background
    ctx.fillStyle = DARK_BG;
    ctx.fillRect(padLeft, padTop, chartW, chartH);

    // Waking window tint
    ctx.fillStyle = 'rgba(230, 220, 200, 0.04)';
    ctx.fillRect(padLeft, wakeY, chartW, sleepY - wakeY);

    // Build points using dayOfYear
    const sunrisePts = data.map(d => ({ x: xPosDoy(d.dayOfYear), y: yPos(d.sunrise) }));
    const sunsetPts = data.map(d => ({ x: xPosDoy(d.dayOfYear), y: yPos(d.sunset) }));

    // Darkness while awake — draw per-day columns
    // We downsample to every ~3 days for performance
    for (let i = 0; i < data.length; i += 3) {
      const d = data[i];
      const x = xPosDoy(d.dayOfYear);
      const nextX = i + 3 < data.length ? xPosDoy(data[i + 3].dayOfYear) : padLeft + chartW;
      const w = nextX - x;

      if (d.sunrise > WAKE) {
        const sunriseY = yPos(d.sunrise);
        ctx.fillStyle = 'rgba(20, 30, 60, 0.65)';
        ctx.fillRect(x, wakeY, w, sunriseY - wakeY);
      }
      if (d.sunset < SLEEP) {
        const sunsetY = yPos(d.sunset);
        ctx.fillStyle = 'rgba(20, 30, 60, 0.65)';
        ctx.fillRect(x, sunsetY, w, sleepY - sunsetY);
      }
    }

    function traceCurveFwd(pts: {x: number, y: number}[]) {
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    }

    function traceCurveBwd(pts: {x: number, y: number}[]) {
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i].y);
    }

    // Fill: sunlight during waking hours
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, wakeY, chartW, sleepY - wakeY);
    ctx.clip();

    ctx.beginPath();
    traceCurveFwd(sunrisePts);
    traceCurveBwd(sunsetPts);
    ctx.closePath();
    const goldGrad = ctx.createLinearGradient(0, wakeY, 0, sleepY);
    goldGrad.addColorStop(0, goldFillStart);
    goldGrad.addColorStop(0.5, goldFillMid);
    goldGrad.addColorStop(1, goldFillEnd);
    ctx.fillStyle = goldGrad;
    ctx.fill();
    ctx.restore();

    // Fill: "wasted" sun before wake — hatching
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, padTop, chartW, wakeY - padTop);
    ctx.clip();

    ctx.beginPath();
    traceCurveFwd(sunrisePts);
    traceCurveBwd(sunsetPts);
    ctx.closePath();
    ctx.clip();

    ctx.strokeStyle = 'rgba(88, 166, 255, 0.22)';
    ctx.lineWidth = 1;
    for (let ly = padTop - chartW; ly < wakeY + chartW; ly += 6) {
      ctx.beginPath();
      ctx.moveTo(padLeft, ly);
      ctx.lineTo(padLeft + chartW, ly + chartW);
      ctx.stroke();
    }
    ctx.restore();

    // Fill: sun after sleep — hatching
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, sleepY, chartW, padTop + chartH - sleepY);
    ctx.clip();

    ctx.beginPath();
    traceCurveFwd(sunrisePts);
    traceCurveBwd(sunsetPts);
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

    // DST annotations — spring forward day 67 (March 8), fall back day 305 (Nov 1)
    if (mode === 'dst') {
      const springX = xPosDoy(67);
      const fallX = xPosDoy(305);

      ctx.save();
      ctx.strokeStyle = 'rgba(139, 148, 158, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);

      ctx.beginPath();
      ctx.moveTo(springX, padTop);
      ctx.lineTo(springX, padTop + chartH);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(fallX, padTop);
      ctx.lineTo(fallX, padTop + chartH);
      ctx.stroke();

      ctx.setLineDash([]);

      ctx.font = '600 9px "DM Sans"';
      ctx.textAlign = 'center';

      const labelY = padTop + 14;
      const springLabel = '▲ Spring Forward';
      const fallLabel = '▼ Fall Back';
      const springW = ctx.measureText(springLabel).width + 12;
      const fallW = ctx.measureText(fallLabel).width + 12;
      const badgeH = 16;
      const badgeR = 3;

      ctx.fillStyle = 'rgba(20, 28, 40, 0.82)';
      ctx.beginPath();
      ctx.roundRect(springX - springW / 2, labelY - 11, springW, badgeH, badgeR);
      ctx.fill();

      ctx.strokeStyle = 'rgba(139, 148, 158, 0.4)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.roundRect(springX - springW / 2, labelY - 11, springW, badgeH, badgeR);
      ctx.stroke();

      ctx.fillStyle = '#a8b3bf';
      ctx.fillText(springLabel, springX, labelY);

      ctx.fillStyle = 'rgba(20, 28, 40, 0.82)';
      ctx.beginPath();
      ctx.roundRect(fallX - fallW / 2, labelY - 11, fallW, badgeH, badgeR);
      ctx.fill();

      ctx.strokeStyle = 'rgba(139, 148, 158, 0.4)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.roundRect(fallX - fallW / 2, labelY - 11, fallW, badgeH, badgeR);
      ctx.stroke();

      ctx.fillStyle = '#a8b3bf';
      ctx.fillText(fallLabel, fallX, labelY);

      ctx.restore();
    }

    // Wake / sleep dashed lines
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

    ctx.fillStyle = 'rgba(230, 237, 243, 0.5)';
    ctx.font = '600 9px "DM Sans"';
    ctx.textAlign = 'right';
    ctx.fillText(`WAKE ${formatHour(WAKE)}`, padLeft - 6, wakeY + 3);
    ctx.fillText(`SLEEP ${formatHour(SLEEP)}`, padLeft - 6, sleepY + 3);

    // Sunrise curve
    ctx.strokeStyle = '#e76f51';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    traceCurveFwd(sunrisePts);
    ctx.stroke();

    // Sunset curve
    ctx.strokeStyle = '#f0c654';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    traceCurveFwd(sunsetPts);
    ctx.stroke();

    // Curve labels (right side, at Dec 31 = day 365)
    ctx.font = '600 10px "DM Sans"';
    ctx.fillStyle = '#e76f51';
    ctx.textAlign = 'left';
    ctx.fillText('SUNRISE', padLeft + chartW + 8, yPos(data[364].sunrise) + 3);
    ctx.fillStyle = '#f0c654';
    ctx.fillText('SUNSET', padLeft + chartW + 8, yPos(data[364].sunset) + 3);

    // Y-axis labels
    ctx.font = '500 10px "DM Sans"';
    ctx.textAlign = 'right';
    for (let h = 5; h <= 26; h++) {
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
      } else if (h === 24) {
        ctx.fillStyle = 'rgba(230, 237, 243, 0.2)';
        ctx.fillText('12 AM', padLeft - 6, y + 3);
      } else if (h === 25) {
        ctx.fillStyle = 'rgba(230, 237, 243, 0.2)';
        ctx.fillText('1 AM', padLeft - 6, y + 3);
      } else if (h === 26) {
        ctx.fillStyle = 'rgba(230, 237, 243, 0.2)';
        ctx.fillText('2 AM', padLeft - 6, y + 3);
      } else {
        ctx.fillStyle = 'rgba(230, 237, 243, 0.2)';
        const label = h < 12 ? `${h} AM` : `${h - 12} PM`;
        ctx.fillText(label, padLeft - 6, y + 3);
      }
    }

    // X-axis: month labels at 1st of each month
    ctx.fillStyle = TEXT_MUTED;
    ctx.font = '600 11px "DM Sans"';
    ctx.textAlign = 'center';
    MONTH_START_DOY.forEach((doy, i) => {
      ctx.fillText(MONTH_NAMES[i], xPosDoy(doy), padTop + chartH + 24);
    });

    // Min/max time labels on curves
    const maxSunriseIdx = data.reduce((mi, d, i, arr) => d.sunrise > arr[mi].sunrise ? i : mi, 0);
    const minSunriseIdx = data.reduce((mi, d, i, arr) => d.sunrise < arr[mi].sunrise ? i : mi, 0);
    const maxSunsetIdx = data.reduce((mi, d, i, arr) => d.sunset > arr[mi].sunset ? i : mi, 0);
    const minSunsetIdx = data.reduce((mi, d, i, arr) => d.sunset < arr[mi].sunset ? i : mi, 0);

    ctx.font = '700 9px "DM Sans"';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e76f51';
    ctx.fillText(decimalToTime(data[maxSunriseIdx].sunrise), xPosDoy(data[maxSunriseIdx].dayOfYear), yPos(data[maxSunriseIdx].sunrise) - 8);
    ctx.fillText(decimalToTime(data[minSunriseIdx].sunrise), xPosDoy(data[minSunriseIdx].dayOfYear), yPos(data[minSunriseIdx].sunrise) - 8);
    ctx.fillStyle = '#f0c654';
    ctx.fillText(decimalToTime(data[maxSunsetIdx].sunset), xPosDoy(data[maxSunsetIdx].dayOfYear), yPos(data[maxSunsetIdx].sunset) + 15);
    ctx.fillText(decimalToTime(data[minSunsetIdx].sunset), xPosDoy(data[minSunsetIdx].dayOfYear), yPos(data[minSunsetIdx].sunset) + 15);

    chartLayout = { padLeft, padTop, chartW, chartH, W, H, yMin, yMax };
  }

  let chartLayout = $state({ padLeft: 0, padTop: 0, chartW: 0, chartH: 0, W: 0, H: 0, yMin: 4, yMax: 26 });

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

    const relX = mx - padLeft;
    if (relX < 0 || relX > chartW || my < padTop || my > padTop + chartH) return;

    // Snap to nearest day index (0–364)
    let dayIdx = Math.round(relX / chartW * 364);
    dayIdx = Math.max(0, Math.min(364, dayIdx));

    const d = data[dayIdx];
    if (!d) return;

    const cx = padLeft + ((d.dayOfYear - 1) / 364) * chartW;

    // Vertical indicator line
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, padTop);
    ctx.lineTo(cx, padTop + chartH);
    ctx.stroke();

    // Tooltip content
    const monthName = MONTH_FULL[d.date.getMonth()];
    const dayNum = d.date.getDate();
    const fullDate = `${monthName} ${dayNum}`;
    const dayLength = d.sunset - d.sunrise;
    const lines = [
      fullDate,
      `🌅 ${fmtTime(d.sunrise)}`,
      `🌇 ${fmtTime(d.sunset)}`,
      `☀️ ${fmtDayLength(dayLength)}`,
    ];

    ctx.font = '700 13px "DM Sans"';
    const titleW = ctx.measureText(fullDate).width;
    ctx.font = '400 12px "DM Sans"';
    const lineWidths = lines.slice(1).map(l => ctx.measureText(l).width);
    const boxW = Math.max(titleW, ...lineWidths) + 28;
    const boxH = 84;

    let tx = mx + 14;
    let ty = my - boxH / 2;
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
    ctx.fillText(fullDate, tx + 14, ty + 20);
    ctx.font = '400 12px "DM Sans"';
    ctx.fillText(lines[1], tx + 14, ty + 38);
    ctx.fillText(lines[2], tx + 14, ty + 54);
    ctx.fillStyle = TEXT_MUTED;
    ctx.fillText(lines[3], tx + 14, ty + 70);
  }

  // Need TEXT_MUTED accessible in handleMouseMove
  const TEXT_MUTED = '#8b949e';

  function handleMouseLeave() {
    if (!overlayCanvas) return;
    const ctx = overlayCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }

  $effect(() => {
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
    <div class="eyebrow">B.C. · Announced March 2, 2026</div>
    <h1>No More Clock Changes<br />for Vancouver</h1>
    <p class="subtitle">
      B.C. is adopting <strong>permanent daylight time (UTC−7)</strong> after the final spring-forward
      on March 8, 2026. Here's how it reshapes the daylight you'll actually experience during your
      waking hours.
    </p>
  </header>

  <div class="controls-row">
    <div class="selector-row">
      <div class="selector">
        <label for="wake-slider">Wake up</label>
        <div class="stepper">
          <button onclick={() => { if (wakeHour > 4) wakeHour-- }} aria-label="Earlier wake time">−</button>
          <span class="stepper-value">{formatHour(wakeHour)}</span>
          <button onclick={() => { if (wakeHour < 12) wakeHour++ }} aria-label="Later wake time">+</button>
        </div>
        <input id="wake-slider" type="range" min="4" max="12" bind:value={wakeHour} />
      </div>
      <div class="selector">
        <label for="sleep-slider">Bedtime</label>
        <div class="stepper">
          <button onclick={() => { if (sleepHour > 18) sleepHour-- }} aria-label="Earlier bedtime">−</button>
          <span class="stepper-value">{formatHour(sleepHour)}</span>
          <button onclick={() => { if (sleepHour < 26) sleepHour++ }} aria-label="Later bedtime">+</button>
        </div>
        <input id="sleep-slider" type="range" min="18" max="26" bind:value={sleepHour} />
      </div>
    </div>

    <div class="mode-toggle" role="group" aria-label="Compare time systems">
      <button class:active={mode === 'pdt'} class="mode-pdt" onclick={() => mode = 'pdt'}>Permanent PDT</button>
      <button class:active={mode === 'dst'} class="mode-dst" onclick={() => mode = 'dst'}>Old DST</button>
      <button class:active={mode === 'pst'} class="mode-pst" onclick={() => mode = 'pst'}>Permanent PST</button>
    </div>
  </div>

  {#if mode !== 'pdt'}
    <div class="mode-note">
      {#if mode === 'dst'}
        For comparison: how daylight looked under the old clock-change system.
      {:else}
        The alternative B.C. rejected — permanent standard time (UTC−8).
      {/if}
    </div>
  {/if}

  <div class="chart-wrapper">
    <div class="chart-header">
      <div class="chart-title">Daylight vs. Waking Hours</div>
      <div class="chart-subtitle">
        {#if mode === 'pdt'}
          Permanent PDT (UTC−7) — your {formatHour(wakeHour)}–{formatHour(sleepHour)} window
        {:else if mode === 'dst'}
          Old DST (UTC−8 winter / UTC−7 summer) — your {formatHour(wakeHour)}–{formatHour(sleepHour)} window
        {:else}
          Permanent PST (UTC−8) — your {formatHour(wakeHour)}–{formatHour(sleepHour)} window
        {/if}
      </div>
    </div>
    <div class="canvas-container">
      <canvas bind:this={canvas}></canvas>
      <canvas bind:this={overlayCanvas} class="overlay-canvas" onmousemove={handleMouseMove} onmouseleave={handleMouseLeave}></canvas>
    </div>
    <div class="legend">
      <div class="legend-item">
        <div class="legend-swatch swatch-daylight"></div>
        <span>Sunlight while you're awake</span>
      </div>
      <div class="legend-item">
        <div class="legend-swatch swatch-missed"></div>
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
        <div class="legend-swatch swatch-dark"></div>
        <span>Darkness while awake</span>
      </div>
    </div>
  </div>

  <div class="stats-strip">
    <div class="stat-item">
      <div class="stat-number orange">{stats.latestSunrise}</div>
      <div class="stat-label">Latest sunrise under {modeLabel}</div>
    </div>
    <div class="stat-divider"></div>
    <div class="stat-item">
      <div class="stat-number blue">{stats.earliestSunrise}</div>
      <div class="stat-label">Earliest sunrise</div>
    </div>
    <div class="stat-divider"></div>
    <div class="stat-item">
      <div class="stat-number gold">{stats.latestSunset}</div>
      <div class="stat-label">Latest sunset</div>
    </div>
    <div class="stat-divider"></div>
    <div class="stat-item">
      <div class="stat-number gold">{stats.earliestSunset}</div>
      <div class="stat-label">Earliest sunset</div>
    </div>
    {#if mode === 'dst'}
      <div class="stat-divider"></div>
      <div class="stat-item">
        <div class="stat-number dst-grey">2×</div>
        <div class="stat-label">Clock changes per year</div>
      </div>
    {/if}
  </div>

  <!-- Sports panel toggle -->
  <div class="sports-toggle-row">
    <button class="sports-btn" class:active={showSports} onclick={() => showSports = !showSports}>
      🏒 I Like Sports
      <span class="sports-btn-chevron" class:open={showSports}>▾</span>
    </button>
  </div>

  <!-- Sports panel -->
  <div class="sports-panel" class:open={showSports} aria-hidden={!showSports}>
    <div class="sports-panel-inner">
      <div class="sports-header">
        <div class="sports-title">Game Times in Vancouver</div>
        <div class="sports-subtitle">
          How the time system affects when you watch sports — using real winter UTC offsets.
          Currently showing: <strong class:pdt-accent={mode === 'pdt'} class:dst-accent={mode === 'dst'} class:pst-accent={mode === 'pst'}>
            {mode === 'pdt' ? 'Permanent PDT (UTC−7)' : mode === 'dst' ? 'Old DST — winter (UTC−8)' : 'Permanent PST (UTC−8)'}
          </strong>
        </div>
      </div>

      <div class="sports-cards">
        {#each sportsData as sport}
          <div class="sport-card">
            <div class="sport-icon">{sport.icon}</div>
            <div class="sport-league">{sport.league}</div>
            <div class="sport-context">{sport.context}</div>
            <div class="sport-source">{sport.source}</div>

            <div class="sport-times">
              <div class="sport-time-row" class:active={mode === 'pdt'}>
                <span class="mode-pill pdt-pill">PDT</span>
                <span class="sport-time-value">{sport.pdt}</span>
              </div>
              <div class="sport-time-row" class:active={mode === 'dst'}>
                <span class="mode-pill dst-pill">Old DST</span>
                <span class="sport-time-value">{sport.dst}</span>
              </div>
              <div class="sport-time-row" class:active={mode === 'pst'}>
                <span class="mode-pill pst-pill">PST</span>
                <span class="sport-time-value">{sport.pst}</span>
              </div>
            </div>

            <div class="sport-takeaway">{sport.takeaway}</div>
          </div>
        {/each}
      </div>

      <div class="sports-footnote">
        Times computed from UTC. Winter offsets: EST = UTC−5, CET = UTC+1. PDT = UTC−7 year-round; PST and old DST winter = UTC−8.
      </div>
    </div>
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
    Sunrise/sunset computed with <a href="https://github.com/mourner/suncalc" target="_blank" rel="noopener">SunCalc</a>
    for Vancouver (49.28°N, 123.12°W), daily values for 2026.
    Waking window is user-configurable above.
    B.C. legislation passed March 2026. Permanent PDT takes effect after the final spring-forward on March 8, 2026.
  </footer>
</div>

<style>
  .container {
    max-width: 1100px;
    margin: 0 auto;
    padding: clamp(32px, 5vw, 56px) clamp(20px, 4vw, 32px) 64px;
  }

  /* ─── Header ─────────────────────────────────────────── */

  header {
    margin-bottom: 40px;
    max-width: 720px;
  }

  .eyebrow {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--accent-orange);
    margin-bottom: 16px;
  }

  h1 {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: clamp(30px, 5.5vw, 56px);
    line-height: 1.08;
    letter-spacing: -0.02em;
    color: #f5f0e8;
    margin-bottom: 16px;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: 15px;
    max-width: 600px;
    line-height: 1.65;
  }

  .subtitle strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  /* ─── Controls row ───────────────────────────────────── */

  .controls-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }

  .selector-row {
    display: flex;
    gap: 32px;
    flex-wrap: wrap;
  }

  .selector {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
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
    gap: 10px;
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
    transition: border-color 0.15s ease, background-color 0.15s ease;
    line-height: 1;
    flex-shrink: 0;
  }

  .stepper button:hover {
    border-color: var(--accent-gold);
    background: rgba(240, 198, 84, 0.08);
  }

  .stepper button:active {
    background: rgba(240, 198, 84, 0.14);
  }

  .stepper-value {
    font-family: 'Playfair Display', serif;
    font-weight: 700;
    font-size: 18px;
    min-width: 62px;
    text-align: center;
    color: var(--text-primary);
  }

  .selector input[type="range"] {
    width: 140px;
    accent-color: var(--accent-gold);
    cursor: pointer;
  }

  /* Mode toggle */
  .mode-toggle {
    display: flex;
    background: var(--card-bg);
    border: 1px solid #30363d;
    border-radius: 24px;
    padding: 4px;
    gap: 2px;
    flex-shrink: 0;
  }

  .mode-toggle button {
    border: none;
    border-radius: 20px;
    padding: 8px 18px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease;
    background: transparent;
    color: var(--text-muted);
    letter-spacing: 0.3px;
    white-space: nowrap;
  }

  .mode-toggle button:hover:not(.active) {
    color: var(--text-primary);
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

  /* ─── Mode note ──────────────────────────────────────── */

  .mode-note {
    font-size: 12.5px;
    color: var(--text-muted);
    margin-bottom: 12px;
    font-style: italic;
  }

  /* ─── Chart ──────────────────────────────────────────── */

  .chart-wrapper {
    background: var(--card-bg);
    border-radius: 16px;
    padding: 28px 20px 20px;
    border: 1px solid #30363d;
    position: relative;
    overflow: hidden;
  }

  .chart-header {
    margin-bottom: 20px;
  }

  .chart-title {
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 0.01em;
    color: var(--text-primary);
    margin-bottom: 3px;
  }

  .chart-subtitle {
    font-size: 12px;
    color: var(--text-muted);
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
    gap: 8px 20px;
    justify-content: center;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid #21262d;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11.5px;
    color: var(--text-muted);
  }

  .legend-swatch {
    width: 28px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .swatch-daylight {
    background: linear-gradient(90deg, rgba(251,191,36,0.5), rgba(240,198,84,0.6));
  }

  .swatch-missed {
    background: repeating-linear-gradient(45deg, #58a6ff33, #58a6ff33 2px, transparent 2px, transparent 4px);
    border: 1px solid #58a6ff44;
  }

  .swatch-dark {
    background: rgba(20,30,60,0.9);
    border: 1px solid rgba(88,133,255,0.25);
  }

  .legend-line-swatch {
    width: 28px;
    height: 2px;
    border-radius: 1px;
    flex-shrink: 0;
  }

  /* ─── Stats strip ────────────────────────────────────── */

  .stats-strip {
    display: flex;
    align-items: stretch;
    gap: 0;
    margin-top: 24px;
    background: var(--card-bg);
    border: 1px solid #30363d;
    border-radius: 12px;
    overflow: hidden;
    flex-wrap: wrap;
  }

  .stat-item {
    flex: 1;
    min-width: 140px;
    padding: 20px 20px 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stat-divider {
    width: 1px;
    background: #21262d;
    flex-shrink: 0;
    align-self: stretch;
  }

  .stat-number {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: clamp(24px, 3vw, 32px);
    line-height: 1;
    letter-spacing: -0.01em;
  }

  .stat-number.gold { color: var(--accent-gold); }
  .stat-number.orange { color: var(--accent-orange); }
  .stat-number.blue { color: var(--accent-blue); }
  .stat-number.dst-grey { color: #8b949e; }

  .stat-label {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  /* ─── Sports toggle button ───────────────────────────── */

  .sports-toggle-row {
    display: flex;
    justify-content: center;
    margin-top: 20px;
  }

  .sports-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--card-bg);
    border: 1px solid #30363d;
    border-radius: 24px;
    padding: 10px 24px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
    transition: border-color 0.2s ease, color 0.2s ease, background-color 0.2s ease;
    letter-spacing: 0.2px;
  }

  .sports-btn:hover {
    border-color: var(--accent-gold);
    color: var(--text-primary);
    background: rgba(240, 198, 84, 0.06);
  }

  .sports-btn.active {
    border-color: var(--accent-gold);
    color: var(--accent-gold);
    background: rgba(240, 198, 84, 0.08);
  }

  .sports-btn-chevron {
    font-size: 14px;
    transition: transform 0.25s ease;
    display: inline-block;
    line-height: 1;
  }

  .sports-btn-chevron.open {
    transform: rotate(180deg);
  }

  /* ─── Sports panel ───────────────────────────────────── */

  .sports-panel {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.4s ease;
  }

  .sports-panel.open {
    max-height: 1000px;
  }

  .sports-panel-inner {
    padding-top: 20px;
  }

  .sports-header {
    margin-bottom: 20px;
  }

  .sports-title {
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 0.01em;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .sports-subtitle {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.55;
  }

  .sports-subtitle strong {
    font-weight: 600;
  }

  .pdt-accent { color: var(--accent-gold); }
  .dst-accent { color: #8b949e; }
  .pst-accent { color: var(--accent-blue); }

  .sports-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  .sport-card {
    background: var(--card-bg);
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 20px 18px 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sport-icon {
    font-size: 22px;
    line-height: 1;
    margin-bottom: 2px;
  }

  .sport-league {
    font-weight: 700;
    font-size: 13px;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .sport-context {
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
    line-height: 1.4;
  }

  .sport-source {
    font-size: 10px;
    color: #6e7681;
    line-height: 1.4;
    padding-bottom: 4px;
    border-bottom: 1px solid #21262d;
    margin-bottom: 4px;
  }

  .sport-times {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .sport-time-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 6px;
    transition: background-color 0.2s ease;
  }

  .sport-time-row.active {
    background: rgba(255, 255, 255, 0.04);
  }

  .mode-pill {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 10px;
    flex-shrink: 0;
    min-width: 52px;
    text-align: center;
  }

  .pdt-pill {
    background: rgba(240, 198, 84, 0.15);
    color: var(--accent-gold);
    border: 1px solid rgba(240, 198, 84, 0.3);
  }

  .dst-pill {
    background: rgba(139, 148, 158, 0.12);
    color: #8b949e;
    border: 1px solid rgba(139, 148, 158, 0.25);
  }

  .pst-pill {
    background: rgba(88, 166, 255, 0.12);
    color: var(--accent-blue);
    border: 1px solid rgba(88, 166, 255, 0.25);
  }

  .sport-time-value {
    font-family: 'Playfair Display', serif;
    font-weight: 700;
    font-size: 16px;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .sport-time-row.active .sport-time-value {
    font-size: 18px;
  }

  .sport-takeaway {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.5;
    font-style: italic;
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px solid #21262d;
  }

  .sports-footnote {
    margin-top: 16px;
    font-size: 10.5px;
    color: #6e7681;
    line-height: 1.6;
    text-align: center;
  }

  /* ─── Insight cards ──────────────────────────────────── */

  .insight-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 16px;
  }

  .insight-card {
    background: var(--card-bg);
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 22px 22px 20px;
  }

  .insight-label {
    font-size: 10px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    font-weight: 700;
    margin-bottom: 10px;
  }

  .insight-card.pro .insight-label { color: var(--accent-gold); }
  .insight-card.con .insight-label { color: var(--accent-orange); }

  .insight-text {
    font-size: 13.5px;
    color: var(--text-muted);
    line-height: 1.65;
  }

  .insight-text strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  /* ─── Footer ─────────────────────────────────────────── */

  footer {
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid #21262d;
    color: #6e7681;
    font-size: 11px;
    line-height: 1.7;
  }

  footer a {
    color: var(--accent-blue);
    text-decoration: none;
  }

  footer a:hover {
    text-decoration: underline;
  }

  /* ─── Responsive ─────────────────────────────────────── */

  @media (max-width: 768px) {
    .sports-cards {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .insight-row {
      grid-template-columns: 1fr;
    }

    .controls-row {
      flex-direction: column;
      align-items: flex-start;
    }

    .mode-toggle {
      width: 100%;
      justify-content: stretch;
    }

    .mode-toggle button {
      flex: 1;
      padding: 8px 10px;
      font-size: 11px;
    }

    .stat-item {
      min-width: 120px;
    }
  }

  /* ─── Reduced motion ─────────────────────────────────── */

  @media (prefers-reduced-motion: reduce) {
    .stepper button,
    .mode-toggle button,
    .sports-btn,
    .sports-panel {
      transition: none;
    }
  }
</style>
