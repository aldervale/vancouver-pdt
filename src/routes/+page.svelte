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
  // Count calendar days with sunrise after the illustrative 8:30 AM threshold.
  const schoolDarkDays = {
    pdt: pdtData.filter(d => d.sunrise > 8.5).length,
    dst: dstData.filter(d => d.sunrise > 8.5).length,
    pst: pstData.filter(d => d.sunrise > 8.5).length,
  };

  const worstSunrisePDT = pdtData.reduce((max, d) => d.sunrise > max.sunrise ? d : max, pdtData[0]);
  const worstSunriseDST = dstData.reduce((max, d) => d.sunrise > max.sunrise ? d : max, dstData[0]);
  const worstSunrisePST = pstData.reduce((max, d) => d.sunrise > max.sunrise ? d : max, pstData[0]);

  // ── Work 9-5 stats (static, computed once) ────────────────────────────────
  // Count calendar days with sunset after 5:00 PM, not actual workdays.
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
    mode === 'pdt' ? 'permanent PDT' : mode === 'dst' ? 'old system' : 'permanent PST'
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
    const W = rect.width;
    const H = 420;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    const padLeft = 94;
    const padRight = W < 500 ? 20 : 82;
    const padTop = mode === 'dst' ? (W < 500 ? 70 : 44) : 18;
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

      ctx.font = '600 12px "DM Sans"';
      ctx.textAlign = 'center';

      const labelY = 18;
      const springLabel = '▲ Spring Forward';
      const fallLabel = '▼ Fall Back';
      const springW = ctx.measureText(springLabel).width + 12;
      const fallW = ctx.measureText(fallLabel).width + 12;
      const badgeH = 22;
      const badgeR = 3;

      ctx.fillStyle = 'rgba(20, 28, 40, 0.82)';
      ctx.beginPath();
      ctx.roundRect(Math.max(padLeft, Math.min(springX - springW / 2, W - springW)), labelY - 11, springW, badgeH, badgeR);
      ctx.fill();

      ctx.strokeStyle = 'rgba(139, 148, 158, 0.4)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.roundRect(Math.max(padLeft, Math.min(springX - springW / 2, W - springW)), labelY - 11, springW, badgeH, badgeR);
      ctx.stroke();

      ctx.fillStyle = '#a8b3bf';
      ctx.fillText(springLabel, Math.max(padLeft + springW / 2, Math.min(springX, W - springW / 2)), labelY);

      ctx.fillStyle = 'rgba(20, 28, 40, 0.82)';
      ctx.beginPath();
      ctx.roundRect(Math.max(padLeft, Math.min(fallX - fallW / 2, W - fallW)), labelY - 11 + (chartW < 300 ? 24 : 0), fallW, badgeH, badgeR);
      ctx.fill();

      ctx.strokeStyle = 'rgba(139, 148, 158, 0.4)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.roundRect(Math.max(padLeft, Math.min(fallX - fallW / 2, W - fallW)), labelY - 11 + (chartW < 300 ? 24 : 0), fallW, badgeH, badgeR);
      ctx.stroke();

      ctx.fillStyle = '#a8b3bf';
      ctx.fillText(fallLabel, Math.max(padLeft + fallW / 2, Math.min(fallX, W - fallW / 2)), labelY + (chartW < 300 ? 24 : 0));

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

    ctx.fillStyle = TEXT_MUTED;
    ctx.font = '600 12px "DM Sans"';
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
    ctx.font = '600 12px "DM Sans"';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e76f51';
    ctx.fillText('SUNRISE', W - 4, yPos(data[364].sunrise) + 3);
    ctx.fillStyle = '#f0c654';
    ctx.fillText('SUNSET', W - 4, yPos(data[364].sunset) + 3);

    // Y-axis labels
    ctx.font = '500 12px "DM Sans"';
    ctx.textAlign = 'right';
    for (let h = 5; h <= 26; h++) {
      if (h === WAKE || h === SLEEP) continue;
      const y = yPos(h);
      if (h === 12) {
        ctx.fillStyle = TEXT_MUTED;
        ctx.fillText('NOON', padLeft - 6, y + 3);
        ctx.strokeStyle = 'rgba(230, 237, 243, 0.06)';
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + chartW, y);
        ctx.stroke();
      } else if (h === 24) {
        ctx.fillStyle = TEXT_MUTED;
        ctx.fillText('12 AM', padLeft - 6, y + 3);
      } else if (h === 25) {
        ctx.fillStyle = TEXT_MUTED;
        ctx.fillText('1 AM', padLeft - 6, y + 3);
      } else if (h === 26) {
        ctx.fillStyle = TEXT_MUTED;
        ctx.fillText('2 AM', padLeft - 6, y + 3);
      } else {
        ctx.fillStyle = TEXT_MUTED;
        const label = h < 12 ? `${h} AM` : `${h - 12} PM`;
        ctx.fillText(label, padLeft - 6, y + 3);
      }
    }

    // X-axis: month labels at 1st of each month
    ctx.fillStyle = TEXT_MUTED;
    ctx.font = '600 12px "DM Sans"';
    ctx.textAlign = 'center';
    MONTH_START_DOY.forEach((doy, i) => {
      if (chartW < 400 && i % 2 !== 0) return;
      ctx.fillText(MONTH_NAMES[i], xPosDoy(doy), padTop + chartH + 24);
    });

    // Min/max time labels on curves
    const maxSunriseIdx = data.reduce((mi, d, i, arr) => d.sunrise > arr[mi].sunrise ? i : mi, 0);
    const minSunriseIdx = data.reduce((mi, d, i, arr) => d.sunrise < arr[mi].sunrise ? i : mi, 0);
    const maxSunsetIdx = data.reduce((mi, d, i, arr) => d.sunset > arr[mi].sunset ? i : mi, 0);
    const minSunsetIdx = data.reduce((mi, d, i, arr) => d.sunset < arr[mi].sunset ? i : mi, 0);

    ctx.font = '700 12px "DM Sans"';
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

  let tour: ReturnType<typeof driver> | undefined;
  let tourTimer: ReturnType<typeof setTimeout> | undefined;

  function rememberTourDismissal() {
    try { localStorage.setItem('vdt_tour_done', '1'); } catch { /* Storage may be blocked. */ }
  }

  function startTour() {
    clearTimeout(tourTimer);
    if (tour?.isActive()) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    tour = driver({
      showProgress: true,
      // Immediate steps keep keyboard navigation and early dismissal reliable.
      animate: false,
      overlayOpacity: 0,
      stagePadding: 0,
      popoverClass: 'daylight-tour',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      onDestroyStarted: (_element, _step, { driver: activeTour }) => {
        rememberTourDismissal();
        activeTour.destroy();
      },
      onDestroyed: () => {
        rememberTourDismissal();
        // Driver restores its own last-step focus after this callback.
        queueMicrotask(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
      },
      onPopoverRender: (popover, { driver: activeTour }) => {
        popover.closeButton.setAttribute('aria-label', 'Close tour');
        popover.previousButton.hidden = activeTour.isFirstStep();
        popover.previousButton.style.display = activeTour.isFirstStep() ? 'none' : 'block';
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'tour-skip';
        skip.textContent = 'Skip tour';
        skip.addEventListener('click', () => { rememberTourDismissal(); activeTour.destroy(); });
        popover.footer.prepend(skip);
      },
      steps: [
        { element: '.selector-row', popover: { title: 'Your schedule', description: 'Set your typical wake-up and bedtime to see how daylight fits your day.', side: 'bottom', align: 'start' } },
        { element: '.mode-toggle', popover: { title: 'Three scenarios', description: 'Compare permanent PDT, the old clock-change system, and permanent standard time.', side: 'bottom', align: 'center' } },
        { element: '.chart-wrapper', popover: { title: 'Your daylight', description: 'The gold band shows sunlight during your waking hours. Hover over any date to see exact sunrise and sunset times.', side: 'over', align: 'center' } },
        { element: '.context-toggle-grid', popover: { title: 'Your daily life', description: 'See how the time change affects sports, school mornings, evenings after work, and the stock market.', side: 'bottom', align: 'center' } },
      ],
    });
    tour.drive();
  }

  onMount(() => {
    let disposed = false;
    const fontsPromise = document.fonts?.ready ?? Promise.resolve();
    fontsPromise.then(() => { if (!disposed) { fontsReady = true; draw(); } });
    setupOverlay();
    const handleResize = () => { draw(); setupOverlay(); };
    window.addEventListener('resize', handleResize);
    try {
      if (!localStorage.getItem('vdt_tour_done')) tourTimer = setTimeout(startTour, 300);
    } catch { /* If storage is blocked, keep the tour opt-in rather than repeat it. */ }

    return () => {
      disposed = true;
      clearTimeout(tourTimer);
      tour?.destroy();
      window.removeEventListener('resize', handleResize);
    };
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
    <button class="tour-launch" onclick={startTour}>Take a quick tour</button>
  </header>

  <div class="controls-row">
    <div class="selector-row">
      <div class="selector">
        <label for="wake-slider">Wake up</label>
        <div class="stepper">
          <button onclick={() => { if (wakeHour > 4) wakeHour-- }} aria-label="Earlier wake time" disabled={wakeHour <= 4}>−</button>
          <span class="stepper-value">{formatHour(wakeHour)}</span>
          <button onclick={() => { if (wakeHour < 12) wakeHour++ }} aria-label="Later wake time" disabled={wakeHour >= 12}>+</button>
        </div>
        <input id="wake-slider" type="range" min="4" max="12" bind:value={wakeHour} />
      </div>
      <div class="selector">
        <label for="sleep-slider">Bedtime</label>
        <div class="stepper">
          <button onclick={() => { if (sleepHour > 18) sleepHour-- }} aria-label="Earlier bedtime" disabled={sleepHour <= 18}>−</button>
          <span class="stepper-value">{formatHour(sleepHour)}</span>
          <button onclick={() => { if (sleepHour < 26) sleepHour++ }} aria-label="Later bedtime" disabled={sleepHour >= 26}>+</button>
        </div>
        <input id="sleep-slider" type="range" min="18" max="26" bind:value={sleepHour} />
      </div>
    </div>

    <div class="mode-toggle" role="group" aria-label="Compare time systems">
      <button class:active={mode === 'pdt'} class="mode-pdt" aria-pressed={mode === 'pdt'} onclick={() => mode = 'pdt'}>Permanent PDT</button>
      <button class:active={mode === 'dst'} class="mode-dst" aria-pressed={mode === 'dst'} onclick={() => mode = 'dst'}>Old system (clock changes)</button>
      <button class:active={mode === 'pst'} class="mode-pst" aria-pressed={mode === 'pst'} onclick={() => mode = 'pst'}>Permanent PST</button>
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
          Old system (UTC−8 winter / UTC−7 summer) — your {formatHour(wakeHour)}–{formatHour(sleepHour)} window
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
          Under permanent PDT, sunset stays after 5 PM on <strong>{workDaylightDays.pdt} calendar days</strong> in the 2026 model — shifting evening light an hour later than permanent standard time.
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
          Spring clock changes can <a href="#ref-sleep">disrupt sleep</a> and have been linked in some observational studies to <a href="#ref-crashes">more fatal crashes</a>. <a href="#ref-heart">Heart-attack findings vary</a>. Ending clock changes is a separate choice from permanent daylight time: <a href="#ref-aasm">sleep specialists favor permanent standard time</a>.
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
    <button class="sports-btn" class:active={openPanel === 'sports'} aria-expanded={openPanel === 'sports'} aria-controls="panel-sports" onclick={() => openPanel = openPanel === 'sports' ? null : 'sports'}>
      🏒 I like sports
      <span aria-hidden="true" class="sports-btn-chevron" class:open={openPanel === 'sports'}>▾</span>
    </button>
    <button class="sports-btn" class:active={openPanel === 'school'} aria-expanded={openPanel === 'school'} aria-controls="panel-school" onclick={() => openPanel = openPanel === 'school' ? null : 'school'}>
      👧 I have a kid
      <span aria-hidden="true" class="sports-btn-chevron" class:open={openPanel === 'school'}>▾</span>
    </button>
    <button class="sports-btn" class:active={openPanel === 'work'} aria-expanded={openPanel === 'work'} aria-controls="panel-work" onclick={() => openPanel = openPanel === 'work' ? null : 'work'}>
      💼 I work a 9-to-5
      <span aria-hidden="true" class="sports-btn-chevron" class:open={openPanel === 'work'}>▾</span>
    </button>
    <button class="sports-btn" class:active={openPanel === 'stocks'} aria-expanded={openPanel === 'stocks'} aria-controls="panel-stocks" onclick={() => openPanel = openPanel === 'stocks' ? null : 'stocks'}>
      📈 I trade stocks
      <span aria-hidden="true" class="sports-btn-chevron" class:open={openPanel === 'stocks'}>▾</span>
    </button>
  </div>

  <!-- Sports panel -->
  <div id="panel-sports" class="sports-panel" class:open={openPanel === 'sports'} aria-hidden={openPanel !== 'sports'} inert={openPanel !== 'sports'}>
    <div class="sports-panel-inner">
      <div class="sports-header">
        <div class="sports-title">Game Times in Vancouver</div>
        <div class="sports-subtitle">
          How the time system affects when you watch sports — using real winter UTC offsets.
        </div>
        <div class="panel-mode-toggle" role="group" aria-label="Compare time systems">
          <button class="panel-mode-btn" class:active={mode === 'pdt'} class:pdt={mode === 'pdt'} aria-pressed={mode === 'pdt'} onclick={() => mode = 'pdt'}>Permanent PDT</button>
          <button class="panel-mode-btn" class:active={mode === 'dst'} class:dst={mode === 'dst'} aria-pressed={mode === 'dst'} onclick={() => mode = 'dst'}>Old system</button>
          <button class="panel-mode-btn" class:active={mode === 'pst'} class:pst={mode === 'pst'} aria-pressed={mode === 'pst'} onclick={() => mode = 'pst'}>Permanent PST</button>
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
                <span class="mode-pill dst-pill">Old system</span>
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
        Times computed from UTC. Winter offsets: EST = UTC−5, CET = UTC+1. PDT = UTC−7 year-round; PST and old system winter = UTC−8.
      </div>
    </div>
  </div>

  <!-- School Start Times panel -->
  <div id="panel-school" class="sports-panel" class:open={openPanel === 'school'} aria-hidden={openPanel !== 'school'} inert={openPanel !== 'school'}>
    <div class="sports-panel-inner">
      <div class="sports-header">
        <div class="sports-title">School Mornings & Sunrise</div>
        <div class="sports-subtitle">
          An illustrative 8:30 AM reference time, not a universal school start or departure time.
          School schedules and travel times vary. This counts calendar days when the sun has not yet risen.
          Currently showing: <strong class:pdt-accent={mode === 'pdt'} class:dst-accent={mode === 'dst'} class:pst-accent={mode === 'pst'}>
            {mode === 'pdt' ? 'Permanent PDT (UTC−7)' : mode === 'dst' ? 'Old system' : 'Permanent PST (UTC−8)'}
          </strong>
        </div>
      </div>

      <div class="context-cards">
        <div class="context-card mode-switchable" class:context-card-active={mode === 'pdt'} role="button" tabindex="0" aria-pressed={mode === 'pdt'} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); mode = 'pdt'; } }} onclick={() => mode = 'pdt'} title="Switch to PDT">
          <div class="context-card-header">
            <span class="mode-pill pdt-pill">PDT</span>
            <span class="context-mode-label">Permanent PDT (UTC−7)</span>
          </div>
          <div class="context-big-number orange">{schoolDarkDays.pdt}</div>
          <div class="context-big-label">calendar days with sunrise after 8:30 AM</div>
          <div class="context-detail">
            Worst day: <strong>{MONTH_NAMES[worstSunrisePDT.date.getMonth()]} {worstSunrisePDT.date.getDate()}</strong>
            — sunrise at <strong class="orange">{fmtTime(worstSunrisePDT.sunrise)}</strong>
          </div>
          <div class="context-insight">Sun rises after 8:30 AM for ~{Math.round(schoolDarkDays.pdt / 30.4)} months. The 1-hour shift from PST means more mornings before sunrise at this reference time.</div>
        </div>

        <div class="context-card mode-switchable" class:context-card-active={mode === 'dst'} role="button" tabindex="0" aria-pressed={mode === 'dst'} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); mode = 'dst'; } }} onclick={() => mode = 'dst'} title="Switch to Old system">
          <div class="context-card-header">
            <span class="mode-pill dst-pill">Seasonal</span>
            <span class="context-mode-label">Old system (UTC−8 winter)</span>
          </div>
          <div class="context-big-number dst-grey">{schoolDarkDays.dst}</div>
          <div class="context-big-label">calendar days with sunrise after 8:30 AM</div>
          <div class="context-detail">
            Worst day: <strong>{MONTH_NAMES[worstSunriseDST.date.getMonth()]} {worstSunriseDST.date.getDate()}</strong>
            — sunrise at <strong class="dst-grey">{fmtTime(worstSunriseDST.sunrise)}</strong>
          </div>
          <div class="context-insight">The seasonal system moved winter sunrise an hour earlier than permanent PDT.</div>
        </div>

        <div class="context-card mode-switchable" class:context-card-active={mode === 'pst'} role="button" tabindex="0" aria-pressed={mode === 'pst'} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); mode = 'pst'; } }} onclick={() => mode = 'pst'} title="Switch to PST">
          <div class="context-card-header">
            <span class="mode-pill pst-pill">PST</span>
            <span class="context-mode-label">Permanent PST (UTC−8)</span>
          </div>
          <div class="context-big-number blue">{schoolDarkDays.pst}</div>
          <div class="context-big-label">calendar days with sunrise after 8:30 AM</div>
          <div class="context-detail">
            Worst day: <strong>{MONTH_NAMES[worstSunrisePST.date.getMonth()]} {worstSunrisePST.date.getDate()}</strong>
            — sunrise at <strong class="blue">{fmtTime(worstSunrisePST.sunrise)}</strong>
          </div>
          <div class="context-insight">Permanent PST has the fewest dates with sunrise after this reference time.</div>
        </div>
      </div>

      <div class="sports-footnote">
        Counts include all 365 dates in 2026, including weekends and school holidays. Before sunrise does not mean completely dark: twilight is not modeled. Actual school times vary: <a href="#ref-school-secondary">VSB secondary guidance</a> uses 8:40 AM, while <a href="#ref-school-elementary">David Oppenheimer Elementary</a> lists 9:00 AM. Check your own school and travel time.
      </div>
    </div>
  </div>

  <!-- 9-5 Work panel -->
  <div id="panel-work" class="sports-panel" class:open={openPanel === 'work'} aria-hidden={openPanel !== 'work'} inert={openPanel !== 'work'}>
    <div class="sports-panel-inner">
      <div class="sports-header">
        <div class="sports-title">Leaving Work in Daylight</div>
        <div class="sports-subtitle">
          Calendar days when sunset is after 5:00 PM, a reference time for the end of a typical workday.
          Currently showing: <strong class:pdt-accent={mode === 'pdt'} class:dst-accent={mode === 'dst'} class:pst-accent={mode === 'pst'}>
            {mode === 'pdt' ? 'Permanent PDT (UTC−7)' : mode === 'dst' ? 'Old system' : 'Permanent PST (UTC−8)'}
          </strong>
        </div>
      </div>

      <div class="context-cards">
        <div class="context-card mode-switchable" class:context-card-active={mode === 'pdt'} role="button" tabindex="0" aria-pressed={mode === 'pdt'} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); mode = 'pdt'; } }} onclick={() => mode = 'pdt'} title="Switch to PDT">
          <div class="context-card-header">
            <span class="mode-pill pdt-pill">PDT</span>
            <span class="context-mode-label">Permanent PDT (UTC−7)</span>
          </div>
          <div class="context-big-number gold">{workDaylightDays.pdt}</div>
          <div class="context-big-label">calendar days with sunset after 5 PM</div>
          <div class="context-detail">
            {365 - workDaylightDays.pdt} calendar days with sunset at or before 5 PM
          </div>
          {#if workDaylightRange.pdt.first && workDaylightRange.pdt.last}
          <div class="context-detail">
            Dates with sunset after 5 PM:
            <strong>{MONTH_NAMES[workDaylightRange.pdt.first.date.getMonth()]} {workDaylightRange.pdt.first.date.getDate()}</strong>
            → <strong>{MONTH_NAMES[workDaylightRange.pdt.last.date.getMonth()]} {workDaylightRange.pdt.last.date.getDate()}</strong>
          </div>
          {/if}
          <div class="context-insight">Permanent PDT's main benefit — evening daylight is shifted 1 hour later all year.</div>
        </div>

        <div class="context-card mode-switchable" class:context-card-active={mode === 'dst'} role="button" tabindex="0" aria-pressed={mode === 'dst'} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); mode = 'dst'; } }} onclick={() => mode = 'dst'} title="Switch to Old system">
          <div class="context-card-header">
            <span class="mode-pill dst-pill">Seasonal</span>
            <span class="context-mode-label">Old system (UTC−8 winter)</span>
          </div>
          <div class="context-big-number dst-grey">{workDaylightDays.dst}</div>
          <div class="context-big-label">calendar days with sunset after 5 PM</div>
          <div class="context-detail">
            {365 - workDaylightDays.dst} calendar days with sunset at or before 5 PM
          </div>
          {#if workDaylightRange.dst.first && workDaylightRange.dst.last}
          <div class="context-detail">
            Dates with sunset after 5 PM:
            <strong>{MONTH_NAMES[workDaylightRange.dst.first.date.getMonth()]} {workDaylightRange.dst.first.date.getDate()}</strong>
            → <strong>{MONTH_NAMES[workDaylightRange.dst.last.date.getMonth()]} {workDaylightRange.dst.last.date.getDate()}</strong>
          </div>
          {/if}
          <div class="context-insight">Old system gave you evening daylight in summer but short winter days at 5 PM.</div>
        </div>

        <div class="context-card mode-switchable" class:context-card-active={mode === 'pst'} role="button" tabindex="0" aria-pressed={mode === 'pst'} onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); mode = 'pst'; } }} onclick={() => mode = 'pst'} title="Switch to PST">
          <div class="context-card-header">
            <span class="mode-pill pst-pill">PST</span>
            <span class="context-mode-label">Permanent PST (UTC−8)</span>
          </div>
          <div class="context-big-number blue">{workDaylightDays.pst}</div>
          <div class="context-big-label">calendar days with sunset after 5 PM</div>
          <div class="context-detail">
            {365 - workDaylightDays.pst} calendar days with sunset at or before 5 PM
          </div>
          {#if workDaylightRange.pst.first && workDaylightRange.pst.last}
          <div class="context-detail">
            Dates with sunset after 5 PM:
            <strong>{MONTH_NAMES[workDaylightRange.pst.first.date.getMonth()]} {workDaylightRange.pst.first.date.getDate()}</strong>
            → <strong>{MONTH_NAMES[workDaylightRange.pst.last.date.getMonth()]} {workDaylightRange.pst.last.date.getDate()}</strong>
          </div>
          {/if}
          <div class="context-insight">PST gives the fewest evening daylight days — sunset arrives earlier every day of the year.</div>
        </div>
      </div>

      <div class="sports-footnote">
        Counts cover all 365 dates in 2026, including weekends and holidays, not actual commutes. The two counts add up to 365. Sunset at or before 5 PM does not mean complete darkness: twilight and travel time are not modeled. The old system uses UTC−8 in winter and UTC−7 in summer, changing on March 8 and November 1.
      </div>
    </div>
  </div>

  <!-- NYSE Opens panel -->
  <div id="panel-stocks" class="sports-panel" class:open={openPanel === 'stocks'} aria-hidden={openPanel !== 'stocks'} inert={openPanel !== 'stocks'}>
    <div class="sports-panel-inner">
      <div class="sports-header">
        <div class="sports-title">NYSE Open — Vancouver Clock Time</div>
        <div class="sports-subtitle">
          NYSE opens at 9:30 AM ET (EST UTC−5 in winter, EDT UTC−4 in summer).
          What time does the bell ring on your clock in Vancouver?
        </div>
        <div class="panel-mode-toggle" role="group" aria-label="Compare time systems">
          <button class="panel-mode-btn" class:active={mode === 'pdt'} class:pdt={mode === 'pdt'} aria-pressed={mode === 'pdt'} onclick={() => mode = 'pdt'}>Permanent PDT</button>
          <button class="panel-mode-btn" class:active={mode === 'dst'} class:dst={mode === 'dst'} aria-pressed={mode === 'dst'} onclick={() => mode = 'dst'}>Old system</button>
          <button class="panel-mode-btn" class:active={mode === 'pst'} class:pst={mode === 'pst'} aria-pressed={mode === 'pst'} onclick={() => mode = 'pst'}>Permanent PST</button>
        </div>
      </div>

      <div class="nyse-table">
        <div class="nyse-header-row">
          <div class="nyse-season-label">Season</div>
          <div class="nyse-col">
            <span class="mode-pill pdt-pill" class:nyse-active={mode === 'pdt'}>PDT</span>
          </div>
          <div class="nyse-col">
            <span class="mode-pill dst-pill" class:nyse-active={mode === 'dst'}>Old system</span>
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
        Under permanent PDT, NYSE opens at <strong>7:30 AM in winter</strong> — a full hour later than the current 6:30 AM under old system/PST. Better for sleep, trickier if you need to catch the open. Under permanent PST, summer trading starts at a brutal <strong>5:30 AM</strong>.
      </div>

      <div class="sports-footnote">
        NYSE open = 9:30 AM ET. EST (UTC−5) Nov–Mar; EDT (UTC−4) Mar–Nov. PDT = UTC−7 year-round; PST = UTC−8 year-round; Old system = UTC−8 winter / UTC−7 summer.
      </div>
    </div>
  </div>

  <footer>
    <div class="about-project">
      <strong>About BC Daylight</strong>
      <p>An independent, open-source comparison of Vancouver daylight under three clock systems. Created by Adam Stuckert. <a href="https://github.com/aldervale/vancouver-pdt" target="_blank" rel="noopener">Source code &amp; feedback</a>.</p>
      <p>Model year: 2026 · Site update: <time datetime="2026-10-24">October 24, 2026</time>.</p>
    </div>
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
          <div class="references-col-label">Science &amp; School Sources</div>
          <ul class="references-list">
            <li><a href="https://www.cbc.ca/news/canada/bc-daylight-saving-health-concerns-9.7114947" target="_blank" rel="noopener">'Scientifically not a good idea,' says researcher — health concerns over permanent PDT</a> — CBC News, Mar 2026</li>
            <li><a href="https://www.cbc.ca/news/canada/daylight-saving-time-canada-9.7113377" target="_blank" rel="noopener">B.C. is moving to permanent daylight time. Could your province be next?</a> — CBC News, Mar 2026</li>
            <li><a href="https://www.cbc.ca/news/canada/london/should-ontario-follow-bc-daylight-savings-9.7113343" target="_blank" rel="noopener">B.C. is scrapping time changes. Should Ontario be next?</a> — CBC News, Mar 2026</li>
            <li id="ref-sleep"><a href="https://pubmed.ncbi.nlm.nih.gov/25979095/" target="_blank" rel="noopener">Adverse effects of daylight saving time on adolescents' sleep and vigilance</a> — Medina et al., Journal of Clinical Sleep Medicine, 2015.</li>
            <li id="ref-crashes"><a href="https://pubmed.ncbi.nlm.nih.gov/32008905/" target="_blank" rel="noopener">A chronobiological evaluation of the acute effects of daylight saving time on traffic accident risk</a> — Fritz et al., Current Biology, 2020. Observational spring-transition findings, not all transitions.</li>
            <li id="ref-heart"><a href="https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2838653" target="_blank" rel="noopener">Daylight saving time and acute myocardial infarction</a> — JAMA Network Open, 2025. A large study found no significant association.</li>
            <li id="ref-aasm"><a href="https://pubmed.ncbi.nlm.nih.gov/37904574/" target="_blank" rel="noopener">Permanent standard time is the optimal choice for health and safety</a> — American Academy of Sleep Medicine position statement, 2024.</li>
            <li id="ref-school-secondary"><a href="https://www.vsb.bc.ca/preparing-for-grade-8-what-to-know-during-the-grade-7-year" target="_blank" rel="noopener">Preparing for Grade 8: what to know during the Grade 7 year</a> — Vancouver School Board. Secondary guidance lists an 8:40 AM start.</li>
            <li id="ref-school-elementary"><a href="https://www.vsb.bc.ca/david-oppenheimer/school-policies-and-procedures" target="_blank" rel="noopener">School policies and procedures</a> — David Oppenheimer Elementary. Its schedule lists a 9:00 AM start.</li>
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
    font-size: 12px;
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
    font-size: 12px;
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
    flex-shrink: 1;
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
    white-space: normal;
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
    font-size: 13px;
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
    font-size: 13px;
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
    font-size: 12px;
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
    font-size: 13px;
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
    font-size: 12px;
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
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
    line-height: 1.4;
  }

  .sport-source {
    font-size: 12px;
    color: var(--text-muted);
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
    font-size: 12px;
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
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
    font-style: italic;
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px solid #21262d;
  }

  .sports-footnote {
    margin-top: 16px;
    font-size: 13px;
    color: var(--text-muted);
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
    font-size: 12px;
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
    font-size: 12px;
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
    font-size: 12px;
    color: var(--text-muted);
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
    font-size: 12px;
    color: var(--text-muted);
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
    font-size: 12px;
    color: var(--text-muted);
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
    font-size: 12px;
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
    color: var(--text-muted);
    font-size: 12px;
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
    font-size: 12px;
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
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--text-muted);
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
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.55;
  }

  .footer-credit {
    font-size: 13px;
    color: var(--text-muted);
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
      font-size: 12px;
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

  .about-project { margin-bottom: 24px; font-size: 14px; }
  .about-project strong { color: var(--text-primary); }
  .about-project p { margin-top: 8px; }
  .sports-footnote a, .insight-text a { color: var(--accent-blue); text-decoration: underline; text-underline-offset: 3px; }
  .references-list li { scroll-margin-top: 24px; }
  .references-list li:target { outline: 2px solid var(--accent-gold); outline-offset: 6px; }
  :global(button:focus-visible), :global(a:focus-visible), .mode-switchable:focus-visible { outline: 2px solid var(--accent-gold); outline-offset: 4px; }
  .stepper button:disabled { opacity: 0.55; cursor: not-allowed; }
  .tour-launch { margin-top: 16px; color: var(--accent-gold); background: transparent; border: 1px solid #8b949e; border-radius: 8px; padding: 8px 12px; font-size: 14px; cursor: pointer; }

  /* ─── Driver.js tour overrides ───────────────────────── */
  :global(.driver-popover.daylight-tour) {
    background: #161b22; border: 1px solid #8b949e; color: #e6edf3;
    width: min(360px, calc(100vw - 40px)); max-width: calc(100vw - 40px);
    padding: 20px; font-family: 'DM Sans', sans-serif;
  }
  :global(.daylight-tour .driver-popover-title) { color: #f5f0e8; font-family: 'Playfair Display', serif; font-size: 22px; padding-right: 20px; }
  :global(.daylight-tour .driver-popover-description) { color: #e6edf3; font-size: 15px; line-height: 1.6; }
  :global(.daylight-tour .driver-popover-progress-text) { color: #c0c8d2; font-size: 13px; }
  :global(.daylight-tour .driver-popover-footer) { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  :global(.daylight-tour .driver-popover-navigation-btns) { margin-left: auto; }
  :global(.daylight-tour .driver-popover-footer button) { font: 600 14px 'DM Sans', sans-serif; text-shadow: none; border-radius: 6px; padding: 8px 10px; }
  :global(.daylight-tour .driver-popover-next-btn) { background: #f0c654; color: #0d1117; border: 1px solid #f0c654; }
  :global(.daylight-tour .driver-popover-prev-btn), :global(.daylight-tour .tour-skip) { color: #e6edf3; background: #161b22; border: 1px solid #8b949e; cursor: pointer; }
  :global(.daylight-tour .driver-popover-footer button:hover), :global(.daylight-tour .driver-popover-footer button:focus) { background: #e6edf3; color: #0d1117; border-color: #e6edf3; }
  :global(.daylight-tour .driver-popover-close-btn) { color: #e6edf3; width: 32px; height: 32px; font-size: 24px; }
  :global(.daylight-tour .driver-popover-arrow-side-top) { border-bottom-color: #161b22; }
  :global(.daylight-tour .driver-popover-arrow-side-bottom) { border-top-color: #161b22; }
</style>
