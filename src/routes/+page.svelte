<script lang="ts">
  import { onMount } from 'svelte';

  let canvas: HTMLCanvasElement;

  // Vancouver sunrise/sunset under permanent PDT (UTC-7)
  // Mid-month values in decimal hours (24h clock), UTC-7 year-round
  // Based on astronomical calculations for 49.25°N, 123.1°W
  const data = [
    { month: 'Jan', sunrise: 8.80, sunset: 17.15 },
    { month: 'Feb', sunrise: 8.10, sunset: 17.92 },
    { month: 'Mar', sunrise: 7.30, sunset: 18.63 },
    { month: 'Apr', sunrise: 6.38, sunset: 19.47 },
    { month: 'May', sunrise: 5.57, sunset: 20.22 },
    { month: 'Jun', sunrise: 5.35, sunset: 20.85 },
    { month: 'Jul', sunrise: 5.55, sunset: 20.70 },
    { month: 'Aug', sunrise: 6.18, sunset: 20.00 },
    { month: 'Sep', sunrise: 6.97, sunset: 19.02 },
    { month: 'Oct', sunrise: 7.75, sunset: 18.02 },
    { month: 'Nov', sunrise: 8.42, sunset: 17.18 },
    { month: 'Dec', sunrise: 8.88, sunset: 16.93 },
  ];

  const WAKE = 7;   // 7:00 AM
  const SLEEP = 23; // 11:00 PM

  function draw() {
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

    const padLeft = 52;
    const padRight = 20;
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
      return padLeft + (i + 0.5) / data.length * chartW;
    }

    const colW = chartW / data.length;
    const wakeY = yPos(WAKE);
    const sleepY = yPos(SLEEP);

    // Background
    ctx.fillStyle = DARK_BG;
    ctx.fillRect(padLeft, padTop, chartW, chartH);

    // Sleeping hours bands
    ctx.fillStyle = '#080b10';
    ctx.fillRect(padLeft, padTop, chartW, wakeY - padTop);
    ctx.fillRect(padLeft, sleepY, chartW, padTop + chartH - sleepY);

    // Waking hours band
    ctx.fillStyle = '#111820';
    ctx.fillRect(padLeft, wakeY, chartW, sleepY - wakeY);

    // Draw columns
    data.forEach((d, i) => {
      const x = padLeft + i * colW;
      const sunriseY = yPos(d.sunrise);
      const sunsetY = yPos(d.sunset);

      const effSunriseY = Math.max(padTop, sunriseY);
      const effSunsetY = Math.min(padTop + chartH, sunsetY);

      // Daylight band (full sunrise-to-sunset)
      const grad = ctx.createLinearGradient(0, effSunriseY, 0, effSunsetY);
      grad.addColorStop(0, 'rgba(240,198,84,0.08)');
      grad.addColorStop(0.3, 'rgba(240,198,84,0.15)');
      grad.addColorStop(0.7, 'rgba(240,198,84,0.15)');
      grad.addColorStop(1, 'rgba(231,111,81,0.08)');
      ctx.fillStyle = grad;
      ctx.fillRect(x + 2, effSunriseY, colW - 4, effSunsetY - effSunriseY);

      // Daylight during waking hours — solid gold
      const wakeStart = Math.max(wakeY, effSunriseY);
      const wakeEnd = Math.min(sleepY, effSunsetY);
      if (wakeEnd > wakeStart) {
        const goldGrad = ctx.createLinearGradient(0, wakeStart, 0, wakeEnd);
        goldGrad.addColorStop(0, 'rgba(251,191,36,0.35)');
        goldGrad.addColorStop(0.5, 'rgba(240,198,84,0.45)');
        goldGrad.addColorStop(1, 'rgba(231,111,81,0.30)');
        ctx.fillStyle = goldGrad;
        ctx.fillRect(x + 2, wakeStart, colW - 4, wakeEnd - wakeStart);
      }

      // "Wasted" sun — daylight before 7am (hatching)
      if (d.sunrise < WAKE) {
        const wastedTop = effSunriseY;
        const wastedBot = wakeY;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 2, wastedTop, colW - 4, wastedBot - wastedTop);
        ctx.clip();
        ctx.strokeStyle = 'rgba(88,166,255,0.18)';
        ctx.lineWidth = 1;
        for (let ly = wastedTop - 40; ly < wastedBot + 40; ly += 6) {
          ctx.beginPath();
          ctx.moveTo(x + 2, ly);
          ctx.lineTo(x + colW - 2, ly + colW);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Sunrise/sunset dashed connector
      ctx.strokeStyle = 'rgba(231,111,81,0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x + colW / 2, effSunriseY);
      ctx.lineTo(x + colW / 2, effSunsetY);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Smooth sunrise/sunset curves
    function drawCurve(getY: (d: typeof data[0]) => number, color: string, lineWidth: number) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = xPos(i);
        const y = getY(d);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          const prev = data[i - 1];
          const px = xPos(i - 1);
          const py = getY(prev);
          const cpx = (px + x) / 2;
          ctx.bezierCurveTo(cpx, py, cpx, y, x, y);
        }
      });
      ctx.stroke();
    }

    drawCurve(d => yPos(d.sunrise), '#e76f51', 2.5);
    drawCurve(d => yPos(d.sunset), '#f0c654', 2.5);

    // Curve labels
    ctx.font = '600 10px "DM Sans"';
    ctx.fillStyle = '#e76f51';
    ctx.textAlign = 'left';
    ctx.fillText('SUNRISE', xPos(11) + 12, yPos(data[11].sunrise) + 3);
    ctx.fillStyle = '#f0c654';
    ctx.fillText('SUNSET', xPos(11) + 12, yPos(data[11].sunset) + 3);

    // 7 AM and 11 PM reference lines
    ctx.strokeStyle = 'rgba(230,237,243,0.15)';
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
    ctx.fillStyle = 'rgba(230,237,243,0.4)';
    ctx.font = '600 9px "DM Sans"';
    ctx.textAlign = 'right';
    ctx.fillText('WAKE 7 AM', padLeft - 6, wakeY + 3);
    ctx.fillText('SLEEP 11 PM', padLeft - 6, sleepY + 3);

    // Y-axis hour labels
    ctx.font = '500 10px "DM Sans"';
    ctx.textAlign = 'right';
    for (let h = 5; h <= 22; h++) {
      if (h === 7 || h === 23) continue;
      const y = yPos(h);
      if (h === 12) {
        ctx.fillStyle = 'rgba(230,237,243,0.35)';
        ctx.fillText('NOON', padLeft - 6, y + 3);
        ctx.strokeStyle = 'rgba(230,237,243,0.06)';
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + chartW, y);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(230,237,243,0.2)';
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

    // Key time labels
    ctx.font = '700 9px "DM Sans"';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e76f51';
    ctx.fillText('8:53', xPos(11), yPos(data[11].sunrise) - 8);
    ctx.fillText('5:21', xPos(5), yPos(data[5].sunrise) - 8);
    ctx.fillStyle = '#f0c654';
    ctx.fillText('8:51', xPos(5), yPos(data[5].sunset) + 15);
    ctx.fillText('4:56', xPos(11), yPos(data[11].sunset) + 15);
  }

  onMount(() => {
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  });
</script>

<svelte:head>
  <title>Vancouver Permanent Daylight Time — Daylight Impact</title>
</svelte:head>

<div class="container">
  <header>
    <div class="badge">Announced March 2, 2026</div>
    <h1>No More Clock Changes<br />for Vancouver</h1>
    <p class="subtitle">
      B.C. is adopting <strong>permanent daylight time (UTC−7)</strong> after the final spring-forward
      on March 8, 2026. Here's how it reshapes the daylight you'll actually experience during your
      <strong>7 AM – 11 PM</strong> waking hours.
    </p>
  </header>

  <div class="chart-wrapper">
    <div class="chart-title">Daylight vs. Waking Hours Across the Year</div>
    <div class="chart-subtitle">
      Permanent PDT (UTC−7) · Sunrise &amp; sunset curves plotted against the 7 AM–11 PM awake window
    </div>
    <canvas bind:this={canvas}></canvas>
    <div class="legend">
      <div class="legend-item">
        <div class="legend-swatch" style="background: linear-gradient(90deg, #f0c654, #fbbf24);"></div>
        <span>Sunlight during waking hours</span>
      </div>
      <div class="legend-item">
        <div class="legend-swatch" style="background: #1a2332;"></div>
        <span>Dark while awake</span>
      </div>
      <div class="legend-item">
        <div class="legend-swatch" style="background: repeating-linear-gradient(45deg, #58a6ff22, #58a6ff22 2px, transparent 2px, transparent 4px); border: 1px solid #58a6ff55;"></div>
        <span>Daylight while asleep (wasted sun)</span>
      </div>
      <div class="legend-item">
        <div class="legend-swatch" style="border-top: 2px dashed #e76f51; background: transparent;"></div>
        <span>Sunrise / Sunset</span>
      </div>
    </div>
  </div>

  <div class="stats-strip">
    <div class="stat-card">
      <div class="stat-number gold">+1 hr</div>
      <div class="stat-label">Extra evening light in<br />Dec &amp; Jan vs. old PST</div>
    </div>
    <div class="stat-card">
      <div class="stat-number orange">8:56</div>
      <div class="stat-label">Latest sunrise (AM)<br />Dec 21 under permanent PDT</div>
    </div>
    <div class="stat-card">
      <div class="stat-number blue">5:22</div>
      <div class="stat-label">Earliest sunrise (AM)<br />Jun 14 under permanent PDT</div>
    </div>
    <div class="stat-card">
      <div class="stat-number gold">9:21</div>
      <div class="stat-label">Latest sunset (PM)<br />Jun 25 under permanent PDT</div>
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
        Sunrise in late December won't arrive until <strong>~8:56 AM</strong> — nearly two hours after
        a 7 AM wake-up. Kids heading to school and early commuters will start the day in
        <strong>full darkness</strong> for about 3 months (Nov–Jan).
      </div>
    </div>
  </div>

  <footer>
    Sunrise/sunset data based on astronomical calculations for Vancouver (49.25°N, 123.1°W) under
    permanent UTC−7. Waking window assumption: 7 AM – 11 PM.
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

  /* Chart */
  .chart-wrapper {
    background: var(--card-bg);
    border-radius: 16px;
    padding: 32px 20px 20px;
    margin-top: 32px;
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

  canvas {
    display: block;
    width: 100% !important;
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
  }
</style>
