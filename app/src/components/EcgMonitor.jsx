import { useEffect, useRef, useState } from "react";

const DISPLAY_MS = 8_000;
const DISPLAY_DELAY_MS = 1_500;

function batchIsUsable(batch, now) {
  const receivedAt = batch?.recorded_at ? new Date(batch.recorded_at).getTime() : NaN;
  if (!batch || !Number.isFinite(receivedAt) ||
    batch.lead_off_positive || batch.lead_off_negative || batch.signal_saturated ||
    !Array.isArray(batch.samples) || batch.samples.length < 2) return false;
  const samples = batch.samples.map(Number);
  const startAt = batch.batch_started_at ? new Date(batch.batch_started_at).getTime() : receivedAt - 1_000;
  const lastSampleAt = startAt + (samples.length - 1) * 1000 / (Number(batch.sample_rate_hz) || 250);
  const age = now - lastSampleAt;
  return Number.isFinite(startAt) && age <= 3_000 && age >= -1_000 &&
    !samples.some((sample) => !Number.isInteger(sample) || sample < 0 || sample > 4095 || sample === 0 || sample === 4095) &&
    !samples.every((sample) => sample === samples[0]);
}

export default function EcgMonitor({ batches, feedError = false }) {
  const canvasRef = useRef(null);
  const batchesRef = useRef(batches);
  const [mode, setMode] = useState("sweep");
  const [, setClock] = useState(0);
  batchesRef.current = batches;

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    let width = 0;
    let height = 0;
    let frame = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      width = Math.max(1, rect.width);
      height = Math.max(200, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    resize();

    const draw = () => {
      frame = requestAnimationFrame(draw);
      ctx.fillStyle = "#fffafa";
      ctx.fillRect(0, 0, width, height);
      const small = width * 0.04 / DISPLAY_MS;
      ctx.beginPath();
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = "#f7dede";
      for (let x = 0; x <= width; x += small) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      for (let y = 0; y <= height; y += height / 25) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
      ctx.stroke();
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#e9b1b1";
      for (let x = 0; x <= width; x += small * 5) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      for (let y = 0; y <= height; y += height / 5) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
      ctx.stroke();

      const now = Date.now();
      const playhead = now - DISPLAY_DELAY_MS;
      const currentBatches = batchesRef.current;
      if (batchIsUsable(currentBatches.at(-1), now)) {
        const points = [];
        const from = playhead - DISPLAY_MS;
        for (const batch of currentBatches) {
          if (batch.lead_off_positive || batch.lead_off_negative || batch.signal_saturated || !Array.isArray(batch.samples)) continue;
          const batchValues = batch.samples.map(Number);
          if (batchValues.some((value) => value === 0 || value === 4095) ||
            batchValues.every((value) => value === batchValues[0])) continue;
          const start = new Date(batch.batch_started_at || batch.recorded_at).getTime();
          if (!Number.isFinite(start)) continue;
          const rate = Number(batch.sample_rate_hz) || 250;
          for (let i = 0; i < batch.samples.length; i += 1) {
            const time = start + i * 1000 / rate;
            const value = Number(batch.samples[i]);
            if (time >= from && time <= playhead) points.push({ time, value });
          }
        }
        if (points.length > 1) {
          let min = Infinity;
          let max = -Infinity;
          let sum = 0;
          for (const point of points) { min = Math.min(min, point.value); max = Math.max(max, point.value); sum += point.value; }
          const dcOffset = sum / points.length;
          const amplitude = Math.max(1, max - min);
          const scale = height * 0.82 / (amplitude * 1.24);
          const cycleOrigin = Math.floor(now / DISPLAY_MS) * DISPLAY_MS;
          ctx.beginPath();
          ctx.strokeStyle = "#087f63";
          ctx.lineWidth = 1.7;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          let open = false;
          let previous = null;
          for (const point of points) {
            const x = mode === "scroll"
              ? width - ((playhead - point.time) / DISPLAY_MS) * width
              : ((((point.time - cycleOrigin) % DISPLAY_MS) + DISPLAY_MS) % DISPLAY_MS) / DISPLAY_MS * width;
            const y = height / 2 - (point.value - dcOffset) * scale;
            const gap = previous && point.time - previous.time > 1.5 * 1000 / 250;
            const wrap = mode === "sweep" && previous && x < previous.x;
            if (x < 0 || x > width || gap || wrap) { ctx.stroke(); ctx.beginPath(); open = false; }
            if (open) ctx.lineTo(x, y);
            else { ctx.moveTo(x, y); open = true; }
            previous = { time: point.time, x };
          }
          ctx.stroke();
          if (mode === "sweep") {
            const cursorX = (now % DISPLAY_MS) / DISPLAY_MS * width;
            ctx.fillStyle = "rgba(255,250,250,.92)";
            ctx.fillRect(cursorX, 0, Math.max(4, small * 3), height);
            ctx.strokeStyle = "#c62828";
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(cursorX, 0);
            ctx.lineTo(cursorX, height);
            ctx.stroke();
          }
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [mode]);

  const latest = batches.at(-1);
  const signalPresent = batchIsUsable(latest, Date.now());
  return <article className="panel-card device-health-panel ecg-trend-card">
    <div className="device-health-section-heading">
      <div><h3>Heart electrical activity · live raw samples</h3><p>250 samples/second · 25 mm/s · 40 ms small boxes · 200 ms large boxes</p></div>
      <span className="ecg-live-indicator" role="status"><i aria-hidden="true" />Live · refreshes every second</span>
      <span className={`ecg-signal-state${signalPresent ? " is-usable" : ""}`}>{signalPresent ? "Signal present" : "No usable current signal"}</span>
      <button type="button" className="btn btn-secondary ecg-mode-button" onClick={() => setMode((value) => value === "sweep" ? "scroll" : "sweep")}>Display: {mode === "sweep" ? "Sweep" : "Scroll"}</button>
    </div>
    <div className="ecg-canvas-wrap">
      <canvas ref={canvasRef} className="ecg-monitor-canvas" aria-label="Raw ECG monitor trace. Educational prototype only." />
      {!signalPresent && <div className="ecg-invalid-overlay" role="status">NO VALID ECG SIGNAL · CHECK LEADS</div>}
    </div>
    <div className="ecg-trend-times"><span>25 mm/s</span><span>250 Hz · display delay 1.5 s</span><span>{latest?.recorded_at ? new Date(latest.recorded_at).toLocaleTimeString() : "Awaiting raw samples"}</span></div>
    {feedError && <small className="clinical-error">Raw ECG batch feed is unavailable. Apply the ECG batch migration and redeploy device-ingest.</small>}
    <small className="ecg-disclaimer">Monitor-style trend, not a clinical ECG waveform or diagnostic display.</small>
  </article>;
}
