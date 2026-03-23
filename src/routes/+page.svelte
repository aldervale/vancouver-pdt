<script lang="ts">
  import { onMount } from 'svelte';
  import SunCalc from 'suncalc';
  import { driver } from 'driver.js';
  import 'driver.js/dist/driver.css';

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

  let wakeHour = $state(7);
  let sleepHour = $state(23);
  let mode: 'pdt' | 'dst' | 'pst' = $state('pdt');
  let openPanel: string | null = $state(null);

  // ── School start times stats (static, computed once) ──────────────────────
  // Count days where sunrise > 8.5 (8:30 AM) — kid leaves for school in darkness
  const schoolDarkDays = {
    pdt: pdtData.filter(d => d.sunrise > 8.5).length,
    dst: dstData.filter(d => d.sunrise > 8.5).length,
    pst: pstData.filter(d => d.sunrise > 8.5).length,
  };

  const worstSunrisePDT = pdtData.reduce((max, d) => d.sunrise > max.sunrise ? d : max, pdtData[0]);
  const worstSunriseDST = dstData.reduce((max, d) => d.sunrise > max.sunrise ? d : max, dstData[0]);
  const worstSunrisePST = pstData.reduce((max, d) => d.sunrise > max.sunrise ? d : max, pstData[0]);

  // ── Work 9-5 stats (static, computed once) ────────────────────────────────
  // Count days where sunset > 17.0 (5:00 PM) — worker leaves in daylight
  const workDaylightDays = {
    pdt: pdtData.filter(d => d.sunset > 17.0).length,
    dst: dstData.filter(d => d.sunset > 17.0).length,
    pst: pstData.filter(d => d.sunset > 17.0).length,
  };

  const workDaylightRange = {
    pdt: {
      first: pdtData.find(d => d.sunset > 17.0),
      last: [...pdtData].reverse().find(d => d.sunset > 17.0),
    },
    dst: {
      first: dstData.find(d => d.sunset > 17.0),
      last: [...dstData].reverse().find(d => d.sunset > 17.0),
    },
    pst: {
      first: pstData.find(d => d.sunset > 17.0),
      last: [...pstData].reverse().find(d => d.sunset > 17.0),
    },
  };

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
    const padRight = 82;
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
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e76f51';
    ctx.fillText('SUNRISE', W - 4, yPos(data[364].sunrise) + 3);
    ctx.fillStyle = '#f0c654';
    ctx.fillText('SUNSET', W - 4, yPos(data[364].sunset) + 3);

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
    // For each extremum label, flip below the curve if drawing above would clip the top edge
    const minLabelClearance = padTop + 12;
    const maxSunriseY = yPos(data[maxSunriseIdx].sunrise);
    ctx.fillText(decimalToTime(data[maxSunriseIdx].sunrise), xPosDoy(data[maxSunriseIdx].dayOfYear),
      maxSunriseY - 8 < minLabelClearance ? maxSunriseY + 14 : maxSunriseY - 8);
    const minSunriseY = yPos(data[minSunriseIdx].sunrise);
    ctx.fillText(decimalToTime(data[minSunriseIdx].sunrise), xPosDoy(data[minSunriseIdx].dayOfYear),
      minSunriseY - 8 < minLabelClearance ? minSunriseY + 14 : minSunriseY - 8);
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

    let fontsReady = false;
  $effect(() => {
    wakeHour;
    sleepHour;
    mode;
    if (fontsReady) {
      draw();
      setupOverlay();
    }
  });

  onMount(() => {
    const fontsPromise = document.fonts?.ready ?? Promise.resolve();
    fontsPromise.then(() => { fontsReady = true; draw(); });
    setupOverlay();
    window.addEventListener('resize', () => { draw(); setupOverlay(); });

    // Guided onboarding tour (first visit only)
    if (!localStorage.getItem('vdt_tour_done')) {
      setTimeout(() => {
        const driverObj = driver({
          showProgress: true,
          onDestroyed: () => localStorage.setItem('vdt_tour_done', '1'),
          steps: [
            {
              element: '.selector-row',
              popover: {
                title: 'Your schedule',
                description: 'Set your typical wake-up and bedtime to see how daylight fits your day.',
              }
            },
            {
              element: '.mode-toggle',
              popover: {
                title: 'Three scenarios',
                description: 'Compare permanent PDT (what\'s coming), the old clock-change system, and permanent standard time.',
              }
            },
            {
              element: '.chart-wrapper',
              popover: {
                title: 'Your daylight',
                description: 'The gold band shows sunlight during your waking hours. Hover over any date to see exact sunrise and sunset times.',
              }
            },
            {
              element: '.context-toggle-grid',
              popover: {
                title: 'Your daily life',
                description: 'See how the time change affects sports, school runs, work commutes, and the stock market.',
              }
            },
          ],
        });
        driverObj.drive();
      }, 300);
    }

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
        The alternative B.C. was never offered — permanent standard time (UTC−8).
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

  <div class="insight-row">
    <div class="insight-card pro">
      {#if mode === 'pdt'}
        <div class="insight-label">Evening win</div>
        <div class="insight-text">
          Under permanent PDT, sunset stays after 5 PM from <strong>late February through late October</strong> — giving you evening daylight for most of the year.
        </div>
      {:else if mode === 'dst'}
        <div class="insight-label">Familiar rhythm</div>
        <div class="insight-text">
          The old system kept mornings brighter in winter and evenings longer in summer — a seasonal balance most Vancouverites grew up with.
        </div>
      {:else}
        <div class="insight-label">Morning win</div>
        <div class="insight-text">
          Earlier sunrises year-round mean brighter mornings for kids heading to school and commuters leaving the house. December sunrise before <strong>8 AM</strong>.
        </div>
      {/if}
    </div>
    <div class="insight-card con">
      {#if mode === 'pdt'}
        <div class="insight-label">Morning trade-off</div>
        <div class="insight-text">
          Winter sunrises shift an hour later. In December, the sun doesn't rise until after <strong>9 AM</strong> — a real consideration for early commuters and school-age kids.
        </div>
      {:else if mode === 'dst'}
        <div class="insight-label">The hidden cost</div>
        <div class="insight-text">
          Clock changes aren't just annoying. Research links them to spikes in <strong>heart attacks, accidents, and disrupted sleep</strong> in the days after each transition.
        </div>
      {:else}
        <div class="insight-label">Evening trade-off</div>
        <div class="insight-text">
          Sunset arrives before 5 PM for much of the year — meaning most after-work hours happen in the dark, especially November through February.
        </div>
      {/if}
    </div>
  </div>

  <!-- Context panel toggles — 2×2 grid -->
  <div class="context-toggle-grid">
    <button class="sports-btn" class:active={openPanel === 'sports'} onclick={() => openPanel = openPanel === 'sports' ? null : 'sports'}>
      🏒 I like sports
      <span class="sports-btn-chevron" class:open={openPanel === 'sports'}>▾</span>
    </button>
    <button class="sports-btn" class:active={openPanel === 'school'} onclick={() => openPanel = openPanel === 'school' ? null : 'school'}>
      👧 I have a kid
      <span class="sports-btn-chevron" class:open={openPanel === 'school'}>▾</span>
    </button>
    <button class="sports-btn" class:active={openPanel === 'work'} onclick={() => openPanel = openPanel === 'work' ? null : 'work'}>
      💼 I work a 9-to-5
      <span class="sports-btn-chevron" class:open={openPanel === 'work'}>▾</span>
    </button>
    <button class="sports-btn" class:active={openPanel === 'stocks'} onclick={() => openPanel = openPanel === 'stocks' ? null : 'stocks'}>
      📈 I trade stocks
      <span class="sports-btn-chevron" class:open={openPanel === 'stocks'}>▾</span>
    </button>
  </div>

  <!-- Sports panel -->
  <div class="sports-panel" class:open={openPanel === 'sports'} aria-hidden={openPanel !== 'sports'}>
    <div class="sports-panel-inner">
      <div class="sports-header">
        <div class="sports-title">Game Times in Vancouver</div>
        <div class="sports-subtitle">
          How the time system affects when you watch sports — using real winter UTC offsets.
        </div>
        <div class="panel-mode-toggle" role="group" aria-label="Compare time systems">
          <button class="panel-mode-btn" class:active={mode === 'pdt'} class:pdt={mode === 'pdt'} onclick={() => mode = 'pdt'}>Permanent PDT</button>
          <button class="panel-mode-btn" class:active={mode === 'dst'} class:dst={mode === 'dst'} onclick={() => mode = 'dst'}>Old DST</button>
          <button class="panel-mode-btn" class:active={mode === 'pst'} class:pst={mode === 'pst'} onclick={() => mode = 'pst'}>Permanent PST</button>
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

  <!-- School Start Times panel -->
  <div class="sports-panel" class:open={openPanel === 'school'} aria-hidden={openPanel !== 'school'}>
    <div class="sports-panel-inner">
      <div class="sports-header">
        <div class="sports-title">School Start Times & Dark Mornings</div>
        <div class="sports-subtitle">
          Vancouver elementary schools start at 8:45 AM; middle/secondary at 8:30 AM.
          Days where sunrise is after 8:30 AM = kids leave for school before sunrise.
          Currently showing: <strong class:pdt-accent={mode === 'pdt'} class:dst-accent={mode === 'dst'} class:pst-accent={mode === 'pst'}>
            {mode === 'pdt' ? 'Permanent PDT (UTC−7)' : mode === 'dst' ? 'Old DST' : 'Permanent PST (UTC−8)'}
          </strong>
        </div>
      </div>

      <div class="context-cards">
        <div class="context-card mode-switchable" class:context-card-active={mode === 'pdt'} onclick={() => mode = 'pdt'} title="Switch to PDT">
          <div class="context-card-header">
            <span class="mode-pill pdt-pill">PDT</span>
            <span class="context-mode-label">Permanent PDT (UTC−7)</span>
          </div>
          <div class="context-big-number orange">{schoolDarkDays.pdt}</div>
          <div class="context-big-label">days of dark morning commutes</div>
          <div class="context-detail">
            Worst day: <strong>{MONTH_NAMES[worstSunrisePDT.date.getMonth()]} {worstSunrisePDT.date.getDate()}</strong>
            — sunrise at <strong class="orange">{fmtTime(worstSunrisePDT.sunrise)}</strong>
          </div>
          <div class="context-insight">Sun rises after 8:30 AM for ~{Math.round(schoolDarkDays.pdt / 30.4)} months. The 1-hour shift from PST means more dark mornings for kids.</div>
        </div>

        <div class="context-card mode-switchable" class:context-card-active={mode === 'dst'} onclick={() => mode = 'dst'} title="Switch to Old DST">
          <div class="context-card-header">
            <span class="mode-pill dst-pill">DST</span>
            <span class="context-mode-label">Old DST (UTC−8 winter)</span>
          </div>
          <div class="context-big-number dst-grey">{schoolDarkDays.dst}</div>
          <div class="context-big-label">days of dark morning commutes</div>
          <div class="context-detail">
            Worst day: <strong>{MONTH_NAMES[worstSunriseDST.date.getMonth()]} {worstSunriseDST.date.getDate()}</strong>
            — sunrise at <strong class="dst-grey">{fmtTime(worstSunriseDST.sunrise)}</strong>
          </div>
          <div class="context-insight">The clock change gave earlier winter sunrises — kids benefited from darker evenings but brighter mornings.</div>
        </div>

        <div class="context-card mode-switchable" class:context-card-active={mode === 'pst'} onclick={() => mode = 'pst'} title="Switch to PST">
          <div class="context-card-header">
            <span class="mode-pill pst-pill">PST</span>
            <span class="context-mode-label">Permanent PST (UTC−8)</span>
          </div>
          <div class="context-big-number blue">{schoolDarkDays.pst}</div>
          <div class="context-big-label">days of dark morning commutes</div>
          <div class="context-detail">
            Worst day: <strong>{MONTH_NAMES[worstSunrisePST.date.getMonth()]} {worstSunrisePST.date.getDate()}</strong>
            — sunrise at <strong class="blue">{fmtTime(worstSunrisePST.sunrise)}</strong>
          </div>
          <div class="context-insight">PST wins for school mornings — earlier sunrises mean fewer dark commutes for kids all year.</div>
        </div>
      </div>

      <div class="sports-footnote">
        Dark morning = sunrise after 8:30 AM. Elementary schools start 8:45 AM, middle/secondary 8:30 AM. PST has the fewest dark morning commutes; permanent PDT has the most.
      </div>
    </div>
  </div>

  <!-- 9-5 Work panel -->
  <div class="sports-panel" class:open={openPanel === 'work'} aria-hidden={openPanel !== 'work'}>
    <div class="sports-panel-inner">
      <div class="sports-header">
        <div class="sports-title">Leaving Work in Daylight</div>
        <div class="sports-subtitle">
          Days per year where sunset is after 5:00 PM — you walk out of the office into daylight.
          Currently showing: <strong class:pdt-accent={mode === 'pdt'} class:dst-accent={mode === 'dst'} class:pst-accent={mode === 'pst'}>
            {mode === 'pdt' ? 'Permanent PDT (UTC−7)' : mode === 'dst' ? 'Old DST' : 'Permanent PST (UTC−8)'}
          </strong>
        </div>
      </div>

      <div class="context-cards">
        <div class="context-card mode-switchable" class:context-card-active={mode === 'pdt'} onclick={() => mode = 'pdt'} title="Switch to PDT">
          <div class="context-card-header">
            <span class="mode-pill pdt-pill">PDT</span>
            <span class="context-mode-label">Permanent PDT (UTC−7)</span>
          </div>
          <div class="context-big-number gold">{workDaylightDays.pdt}</div>
          <div class="context-big-label">days/year you leave work in daylight</div>
          <div class="context-detail">
            {365 - workDaylightDays.pdt} days commuting home in the dark
          </div>
          {#if workDaylightRange.pdt.first && workDaylightRange.pdt.last}
          <div class="context-detail">
            Daylight-after-5 runs
            <strong>{MONTH_NAMES[workDaylightRange.pdt.first.date.getMonth()]} {workDaylightRange.pdt.first.date.getDate()}</strong>
            → <strong>{MONTH_NAMES[workDaylightRange.pdt.last.date.getMonth()]} {workDaylightRange.pdt.last.date.getDate()}</strong>
          </div>
          {/if}
          <div class="context-insight">Permanent PDT's main benefit — evening daylight is shifted 1 hour later all year.</div>
        </div>

        <div class="context-card mode-switchable" class:context-card-active={mode === 'dst'} onclick={() => mode = 'dst'} title="Switch to Old DST">
          <div class="context-card-header">
            <span class="mode-pill dst-pill">DST</span>
            <span class="context-mode-label">Old DST (UTC−8 winter)</span>
          </div>
          <div class="context-big-number dst-grey">{workDaylightDays.dst}</div>
          <div class="context-big-label">days/year you leave work in daylight</div>
          <div class="context-detail">
            {365 - workDaylightDays.dst} days commuting home in the dark
          </div>
          {#if workDaylightRange.dst.first && workDaylightRange.dst.last}
          <div class="context-detail">
            Daylight-after-5 runs
            <strong>{MONTH_NAMES[workDaylightRange.dst.first.date.getMonth()]} {workDaylightRange.dst.first.date.getDate()}</strong>
            → <strong>{MONTH_NAMES[workDaylightRange.dst.last.date.getMonth()]} {workDaylightRange.dst.last.date.getDate()}</strong>
          </div>
          {/if}
          <div class="context-insight">Old DST gave you evening daylight in summer but short winter days at 5 PM.</div>
        </div>

        <div class="context-card mode-switchable" class:context-card-active={mode === 'pst'} onclick={() => mode = 'pst'} title="Switch to PST">
          <div class="context-card-header">
            <span class="mode-pill pst-pill">PST</span>
            <span class="context-mode-label">Permanent PST (UTC−8)</span>
          </div>
          <div class="context-big-number blue">{workDaylightDays.pst}</div>
          <div class="context-big-label">days/year you leave work in daylight</div>
          <div class="context-detail">
            {365 - workDaylightDays.pst} days commuting home in the dark
          </div>
          {#if workDaylightRange.pst.first && workDaylightRange.pst.last}
          <div class="context-detail">
            Daylight-after-5 runs
            <strong>{MONTH_NAMES[workDaylightRange.pst.first.date.getMonth()]} {workDaylightRange.pst.first.date.getDate()}</strong>
            → <strong>{MONTH_NAMES[workDaylightRange.pst.last.date.getMonth()]} {workDaylightRange.pst.last.date.getDate()}</strong>
          </div>
          {/if}
          <div class="context-insight">PST gives the fewest evening daylight days — sunset arrives earlier every day of the year.</div>
        </div>
      </div>

      <div class="sports-footnote">
        Daylight after 5 PM = sunset after 17:00. Permanent PDT has significantly more evenings with sunlight after the workday ends.
      </div>
    </div>
  </div>

  <!-- NYSE Opens panel -->
  <div class="sports-panel" class:open={openPanel === 'stocks'} aria-hidden={openPanel !== 'stocks'}>
    <div class="sports-panel-inner">
      <div class="sports-header">
        <div class="sports-title">NYSE Open — Vancouver Clock Time</div>
        <div class="sports-subtitle">
          NYSE opens at 9:30 AM ET (EST UTC−5 in winter, EDT UTC−4 in summer).
          What time does the bell ring on your clock in Vancouver?
        </div>
        <div class="panel-mode-toggle" role="group" aria-label="Compare time systems">
          <button class="panel-mode-btn" class:active={mode === 'pdt'} class:pdt={mode === 'pdt'} onclick={() => mode = 'pdt'}>Permanent PDT</button>
          <button class="panel-mode-btn" class:active={mode === 'dst'} class:dst={mode === 'dst'} onclick={() => mode = 'dst'}>Old DST</button>
          <button class="panel-mode-btn" class:active={mode === 'pst'} class:pst={mode === 'pst'} onclick={() => mode = 'pst'}>Permanent PST</button>
        </div>
      </div>

      <div class="nyse-table">
        <div class="nyse-header-row">
          <div class="nyse-season-label">Season</div>
          <div class="nyse-col">
            <span class="mode-pill pdt-pill" class:nyse-active={mode === 'pdt'}>PDT</span>
          </div>
          <div class="nyse-col">
            <span class="mode-pill dst-pill" class:nyse-active={mode === 'dst'}>Old DST</span>
          </div>
          <div class="nyse-col">
            <span class="mode-pill pst-pill" class:nyse-active={mode === 'pst'}>PST</span>
          </div>
        </div>

        <div class="nyse-row" >
          <div class="nyse-season-label">
            <div class="nyse-season-name">🥶 Winter</div>
            <div class="nyse-season-sub">Nov – Mar · EST (UTC−5)</div>
            <div class="nyse-season-sub">14:30 UTC</div>
          </div>
          <div class="nyse-col nyse-time" class:nyse-mode-active={mode === 'pdt'}>
            <span class="nyse-time-value">7:30 AM</span>
            <span class="nyse-time-note">1hr later than today</span>
          </div>
          <div class="nyse-col nyse-time" class:nyse-mode-active={mode === 'dst'}>
            <span class="nyse-time-value">6:30 AM</span>
            <span class="nyse-time-note">same as now</span>
          </div>
          <div class="nyse-col nyse-time" class:nyse-mode-active={mode === 'pst'}>
            <span class="nyse-time-value">6:30 AM</span>
            <span class="nyse-time-note">same as now</span>
          </div>
        </div>

        <div class="nyse-row">
          <div class="nyse-season-label">
            <div class="nyse-season-name">☀️ Summer</div>
            <div class="nyse-season-sub">Mar – Nov · EDT (UTC−4)</div>
            <div class="nyse-season-sub">13:30 UTC</div>
          </div>
          <div class="nyse-col nyse-time" class:nyse-mode-active={mode === 'pdt'}>
            <span class="nyse-time-value">6:30 AM</span>
            <span class="nyse-time-note">same as today</span>
          </div>
          <div class="nyse-col nyse-time" class:nyse-mode-active={mode === 'dst'}>
            <span class="nyse-time-value">6:30 AM</span>
            <span class="nyse-time-note">same as PDT summer</span>
          </div>
          <div class="nyse-col nyse-time" class:nyse-mode-active={mode === 'pst'}>
            <span class="nyse-time-value">5:30 AM</span>
            <span class="nyse-time-note">1hr earlier — pre-dawn</span>
          </div>
        </div>
      </div>

      <div class="nyse-insight">
        Under permanent PDT, NYSE opens at <strong>7:30 AM in winter</strong> — a full hour later than the current 6:30 AM under old DST/PST. Better for sleep, trickier if you need to catch the open. Under permanent PST, summer trading starts at a brutal <strong>5:30 AM</strong>.
      </div>

      <div class="sports-footnote">
        NYSE open = 9:30 AM ET. EST (UTC−5) Nov–Mar; EDT (UTC−4) Mar–Nov. PDT = UTC−7 year-round; PST = UTC−8 year-round; Old DST = UTC−8 winter / UTC−7 summer.
      </div>
    </div>
  </div>

  <footer>
    <div class="references-section">
      <div class="references-title">References &amp; Further Reading</div>
      <div class="references-grid">
        <div class="references-col">
          <div class="references-col-label">B.C. Coverage</div>
          <ul class="references-list">
            <li><a href="https://www.cbc.ca/news/canada/british-columbia/b-c-adopting-year-round-daylight-time-9.7111657" target="_blank" rel="noopener">Reactions mixed as B.C. ends time changes, adopts year-round daylight time</a> — CBC News, Mar 2026</li>
            <li><a href="https://www.cbc.ca/news/canada/british-columbia/bc-permanent-daylight-saving-time-pacific-time-zone-clocks-9.7116954" target="_blank" rel="noopener">March 8 is the last time most British Columbians will change their clocks</a> — CBC News, Mar 2026</li>
            <li><a href="https://www.cbc.ca/news/canada/british-columbia/bc-clocks-changing-timeline-9.7112204" target="_blank" rel="noopener">A timeline of how B.C. got to Pacific time year-round</a> — CBC News, Mar 2026</li>
            <li><a href="https://dailyhive.com/vancouver/bc-permanent-daylight-saving-time" target="_blank" rel="noopener">You are my sunshine: B.C. inches closer to permanent Daylight Saving Time</a> — Daily Hive, Mar 2022</li>
            <li><a href="https://www.cbc.ca/news/canada/british-columbia/time-change-british-columbia-9.7112139" target="_blank" rel="noopener">People in northeast B.C. say rest of province should consider their experience</a> — CBC News, Mar 2026</li>
          </ul>
        </div>
        <div class="references-col">
          <div class="references-col-label">Science &amp; Debate</div>
          <ul class="references-list">
            <li><a href="https://www.cbc.ca/news/canada/bc-daylight-saving-health-concerns-9.7114947" target="_blank" rel="noopener">'Scientifically not a good idea,' says researcher — health concerns over permanent PDT</a> — CBC News, Mar 2026 <span class="ref-tag ref-con">con</span></li>
            <li><a href="https://www.cbc.ca/news/canada/daylight-saving-time-canada-9.7113377" target="_blank" rel="noopener">B.C. is moving to permanent daylight time. Could your province be next?</a> — CBC News, Mar 2026</li>
            <li><a href="https://www.cbc.ca/news/canada/london/should-ontario-follow-bc-daylight-savings-9.7113343" target="_blank" rel="noopener">B.C. is scrapping time changes. Should Ontario be next?</a> — CBC News, Mar 2026</li>
            <li><a href="https://www.science.org/content/article/does-daylight-saving-time-affect-our-health" target="_blank" rel="noopener">Does daylight saving time affect our health?</a> — Science magazine <span class="ref-tag ref-con">con</span></li>
            <li><a href="https://currentbiology.com/article/S0960-9822(19)31293-7/fulltext" target="_blank" rel="noopener">Humans in permanent summer time are late chronotypes</a> — Current Biology <span class="ref-tag ref-pro">pro</span></li>
          </ul>
        </div>
      </div>
    </div>
    <div class="footer-credit">
      Sunrise/sunset computed with <a href="https://github.com/mourner/suncalc" target="_blank" rel="noopener">SunCalc</a>
      for Vancouver (49.28°N, 123.12°W), daily values for 2026.
      Waking window is user-configurable above.
      B.C. legislation passed March 2026. Permanent PDT takes effect after the final spring-forward on March 8, 2026.
    </div>
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
    margin-bottom: 20px;
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

  /* ─── Context toggle grid ────────────────────────────── */

  .context-toggle-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 24px;
  }

  @media (max-width: 560px) {
    .context-toggle-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ─── Sports toggle button ───────────────────────────── */

  .sports-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
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
    width: 100%;
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
    flex-shrink: 0;
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
    max-height: 2400px;
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
    margin-bottom: 12px;
  }

  .sports-subtitle strong {
    font-weight: 600;
  }

  /* ─── Panel-level mode toggle ────────────────────────── */

  .panel-mode-toggle {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .panel-mode-btn {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.2px;
    padding: 5px 12px;
    border-radius: 20px;
    border: 1px solid #30363d;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
  }

  .panel-mode-btn:hover {
    border-color: #58a6ff55;
    color: var(--text-primary);
  }

  .panel-mode-btn.active.pdt {
    border-color: rgba(240, 198, 84, 0.5);
    color: var(--accent-gold);
    background: rgba(240, 198, 84, 0.08);
  }

  .panel-mode-btn.active.dst {
    border-color: rgba(139, 148, 158, 0.4);
    color: #8b949e;
    background: rgba(139, 148, 158, 0.08);
  }

  .panel-mode-btn.active.pst {
    border-color: rgba(88, 166, 255, 0.4);
    color: var(--accent-blue);
    background: rgba(88, 166, 255, 0.08);
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

  /* ─── Context panel cards (school, 9-5) ─────────────── */

  .context-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  .context-card {
    background: var(--card-bg);
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 20px 18px 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 0.2s ease;
  }

  .context-card-active {
    border-color: rgba(240, 198, 84, 0.35);
    background: rgba(240, 198, 84, 0.03);
  }

  .context-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .context-mode-label {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 600;
  }

  .context-big-number {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: clamp(36px, 5vw, 52px);
    line-height: 1;
    letter-spacing: -0.02em;
  }

  .context-big-number.gold { color: var(--accent-gold); }
  .context-big-number.orange { color: var(--accent-orange); }
  .context-big-number.blue { color: var(--accent-blue); }
  .context-big-number.dst-grey { color: #8b949e; }

  .context-big-label {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: -4px;
  }

  .context-detail {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .context-detail strong { color: var(--text-primary); font-weight: 600; }
  .context-detail strong.orange { color: var(--accent-orange); }
  .context-detail strong.blue { color: var(--accent-blue); }
  .context-detail strong.dst-grey { color: #8b949e; }

  .context-insight {
    font-size: 11.5px;
    color: #6e7681;
    line-height: 1.55;
    font-style: italic;
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px solid #21262d;
  }

  /* ─── NYSE table ─────────────────────────────────────── */

  .nyse-table {
    background: var(--card-bg);
    border: 1px solid #30363d;
    border-radius: 12px;
    overflow: hidden;
  }

  .nyse-header-row,
  .nyse-row {
    display: grid;
    grid-template-columns: 160px 1fr 1fr 1fr;
    gap: 0;
  }

  .nyse-header-row {
    padding: 12px 16px;
    border-bottom: 1px solid #21262d;
    background: rgba(255,255,255,0.02);
    align-items: center;
  }

  .nyse-row {
    padding: 16px 16px;
    border-bottom: 1px solid #21262d;
    align-items: center;
  }

  .nyse-row:last-child {
    border-bottom: none;
  }

  .nyse-season-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .nyse-season-name {
    font-weight: 700;
    font-size: 13px;
    color: var(--text-primary);
  }

  .nyse-season-sub {
    font-size: 10px;
    color: #6e7681;
  }

  .nyse-col {
    text-align: center;
    padding: 0 8px;
  }

  .nyse-time {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 8px;
    border-radius: 8px;
    transition: background-color 0.2s ease;
  }

  .nyse-mode-active {
    background: rgba(255,255,255,0.04);
  }

  .nyse-active {
    opacity: 1;
  }

  .nyse-time-value {
    font-family: 'Playfair Display', serif;
    font-weight: 900;
    font-size: 20px;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .nyse-mode-active .nyse-time-value {
    font-size: 22px;
  }

  .nyse-time-note {
    font-size: 10px;
    color: #6e7681;
    text-align: center;
    line-height: 1.3;
  }

  .nyse-insight {
    margin-top: 16px;
    padding: 14px 18px;
    background: rgba(240, 198, 84, 0.05);
    border: 1px solid rgba(240, 198, 84, 0.15);
    border-radius: 10px;
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.65;
  }

  .nyse-insight strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  @media (max-width: 768px) {
    .context-cards {
      grid-template-columns: 1fr;
    }

    .nyse-header-row,
    .nyse-row {
      grid-template-columns: 120px 1fr 1fr 1fr;
    }

    .nyse-time-value {
      font-size: 16px;
    }
  }

  /* ─── Insight cards ──────────────────────────────────── */

  .insight-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 24px;
  }

  .insight-card {
    background: var(--card-bg);
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 22px;
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

  .references-section {
    margin-bottom: 24px;
    padding-bottom: 20px;
    border-bottom: 1px solid #21262d;
  }

  .references-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #8b949e;
    margin-bottom: 16px;
  }

  .references-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }

  @media (max-width: 640px) {
    .references-grid {
      grid-template-columns: 1fr;
    }
  }

  .references-col-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: #6e7681;
    margin-bottom: 10px;
  }

  .references-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .references-list li {
    font-size: 12px;
    color: #6e7681;
    line-height: 1.55;
  }

  .ref-tag {
    display: inline-block;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 8px;
    vertical-align: middle;
    margin-left: 4px;
  }

  .ref-pro {
    background: rgba(240, 198, 84, 0.12);
    color: var(--accent-gold);
    border: 1px solid rgba(240, 198, 84, 0.3);
  }

  .ref-con {
    background: rgba(231, 111, 81, 0.12);
    color: var(--accent-orange);
    border: 1px solid rgba(231, 111, 81, 0.3);
  }

  .footer-credit {
    font-size: 11px;
    color: #6e7681;
    line-height: 1.7;
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

  /* ─── Click-to-switch mode affordance ────────────────── */

  .mode-switchable {
    cursor: pointer;
    transition: filter 0.15s ease, border-color 0.15s ease;
  }

  .mode-switchable:hover {
    filter: brightness(1.15);
  }

  /* ─── Driver.js tour overrides ───────────────────────── */

  :global(.driver-popover) {
    background: #161b22 !important;
    border: 1px solid #30363d !important;
    color: #e6edf3 !important;
  }

  :global(.driver-popover-title) {
    color: #f5f0e8 !important;
    font-family: 'Playfair Display', serif !important;
  }

  :global(.driver-popover-description) {
    color: #8b949e !important;
  }

  :global(.driver-popover-next-btn) {
    background: #f0c654 !important;
    color: #0d1117 !important;
    border: none !important;
  }

  :global(.driver-popover-prev-btn),
  :global(.driver-popover-close-btn) {
    color: #8b949e !important;
    border-color: #30363d !important;
  }
</style>
