import { useEffect, useRef, useState } from "react";

const DISPLAY_MS = 2_500;
const SMALL_BOX_MS = 10;
const DISPLAY_DELAY_MS = 200;
const MAX_SIGNAL_AGE_MS = 2_000;
const SAMPLE_RATE_HZ = 250;
const SAMPLE_MS = 1000 / SAMPLE_RATE_HZ;

function samplesUsable(packet) {
  if (!packet || packet.lead_off_positive || packet.lead_off_negative ||
    !Array.isArray(packet.samples) || packet.samples.length < 2) return false;
  // Ignore isolated ADC rail hits so one bad conversion doesn't erase an
  // otherwise usable 80 ms packet. Flat or fully saturated packets stay blank.
  const samples = packet.samples.map(Number).filter((sample) =>
    Number.isInteger(sample) && sample > 0 && sample < 4095);
  return samples.length >= 2 && Math.max(...samples) - Math.min(...samples) >= 2;
}

function packetStart(packet) {
  const timestamp = Date.parse(packet?.captured_at || "");
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function packetIsFresh(packet, now) {
  if (!samplesUsable(packet)) return false;
  const end = packetStart(packet) + (packet.samples.length - 1) * SAMPLE_MS;
  return Number.isFinite(end) && now - end <= MAX_SIGNAL_AGE_MS && now - end >= -1_000;
}

export default function EcgMonitor({ livePackets = [], batches = [], feedError = false }) {
  const canvasRef = useRef(null);
  const packetsRef = useRef(livePackets);
  const batchesRef = useRef(batches);
  const [mode, setMode] = useState("scroll");
  const [signalPresent, setSignalPresent] = useState(false);
  const [lastPacketAt, setLastPacketAt] = useState(null);
  const [signalReason, setSignalReason] = useState("Waiting for live ECG packets");

  useEffect(() => { packetsRef.current = livePackets; }, [livePackets]);
  useEffect(() => { batchesRef.current = batches; }, [batches]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const packets = packetsRef.current;
      const newest = packets.reduce((latest, packet) =>
        Number.isFinite(packetStart(packet)) && (!latest || packetStart(packet) > packetStart(latest)) ? packet : latest, null);
      const fresh = newest && packetIsFresh(newest, now);
      setSignalPresent(Boolean(fresh));
      setLastPacketAt(newest ? packetStart(newest) : null);
      setSignalReason(!newest ? "Waiting for live ECG packets"
        : !fresh && now - (packetStart(newest) + (newest.samples?.length - 1) * SAMPLE_MS) > MAX_SIGNAL_AGE_MS ? "Live packets are stale"
          : newest.lead_off_positive || newest.lead_off_negative ? "Lead-off detected in latest packet"
            : !samplesUsable(newest) ? "Latest packet is flat or saturated"
              : "Live signal received");
    }, 100);
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
      ctx.fillStyle = "#07110f";
      ctx.fillRect(0, 0, width, height);
      const small = width * SMALL_BOX_MS / DISPLAY_MS;
      ctx.beginPath();
      ctx.lineWidth = 0.55;
      ctx.strokeStyle = "#102a24";
      for (let x = 0; x <= width; x += small) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      for (let y = 0; y <= height; y += height / 25) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
      ctx.stroke();
      ctx.beginPath();
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = "#1c493d";
      for (let x = 0; x <= width; x += small * 5) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      for (let y = 0; y <= height; y += height / 5) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
      ctx.stroke();

      // Stable horizontal zero-reference for the display-only DC-centered
      // raw ADC trace; time remains the x-axis and signal amplitude the y-axis.
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(84, 133, 114, 0.48)";
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      const now = Date.now();
      const newest = packetsRef.current.reduce((latest, packet) =>
        Number.isFinite(packetStart(packet)) && (!latest || packetStart(packet) > packetStart(latest)) ? packet : latest, null);
      if (newest && packetIsFresh(newest, now)) {
        const newestSampleTime = packetStart(newest) + (newest.samples.length - 1) * SAMPLE_MS;
        const playhead = Math.min(now - DISPLAY_DELAY_MS, newestSampleTime);
        const from = playhead - DISPLAY_MS;
        const points = [];
        const ordered = [...packetsRef.current].sort((a, b) => packetStart(a) - packetStart(b));
        for (const packet of ordered) {
          const start = packetStart(packet);
          if (!Number.isFinite(start)) continue;
          if (!samplesUsable(packet)) {
            const packetEnd = start + (packet.samples?.length - 1) * SAMPLE_MS;
            if (packetEnd >= from && start <= playhead) points.push({ break: true });
            continue;
          }
          for (let i = 0; i < packet.samples.length; i += 1) {
            const time = start + i * SAMPLE_MS;
            const value = Number(packet.samples[i]);
            if (time >= from && time <= playhead && value > 0 && value < 4095) points.push({ time, value });
          }
        }
        const realPoints = points.filter((point) => !point.break);
        if (realPoints.length > 1) {
          const values = realPoints.map((point) => point.value);
          const min = Math.min(...values);
          const max = Math.max(...values);
          const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
          const scale = height * 0.82 / Math.max(30, (max - min) * 1.25);
          ctx.beginPath();
          ctx.strokeStyle = "#55ff9a";
          ctx.shadowColor = "rgba(85, 255, 154, 0.55)";
          ctx.shadowBlur = 5;
          ctx.lineWidth = 2;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          let open = false;
          let previous = null;
          const sweepOrigin = Math.floor(playhead / DISPLAY_MS) * DISPLAY_MS;
          for (const point of points) {
            if (point.break) {
              ctx.stroke();
              ctx.beginPath();
              open = false;
              previous = null;
              continue;
            }
            const x = mode === "scroll"
              ? width - ((playhead - point.time) / DISPLAY_MS) * width
              : ((point.time - sweepOrigin) / DISPLAY_MS) * width;
            const y = height / 2 - (point.value - mean) * scale;
            const gap = previous && point.time - previous.time > SAMPLE_MS * 1.5;
            const wrap = mode === "sweep" && previous && x < previous.x;
            // Leave transport gaps visibly blank so connecting segments cannot
            // obscure the actual received waveform samples.
            if (gap || wrap || x < 0 || x > width) { ctx.stroke(); ctx.beginPath(); open = false; }
            if (open) ctx.lineTo(x, y);
            else { ctx.moveTo(x, y); open = true; }
            previous = { ...point, x };
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
          if (mode === "sweep") {
            const cursorX = (playhead - sweepOrigin) / DISPLAY_MS * width;
            ctx.fillStyle = "rgba(7,17,15,.9)";
            ctx.fillRect(cursorX, 0, Math.max(3, small * 2), height);
            ctx.strokeStyle = "#b9ffcf";
            ctx.lineWidth = 1.2;
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

  const latestBatch = batches.at(-1);
  return <article className="panel-card device-health-panel ecg-trend-card">
    <div className="device-health-section-heading">
      <div><h3>Heart electrical activity · live raw samples</h3><p>2.5-second zoom · 250 samples/second · 100 mm/s · 10 ms small boxes · 50 ms large boxes</p></div>
      <span className="ecg-live-indicator" role="status"><i aria-hidden="true" />Live stream · 80 ms packets · ~200 ms display delay</span>
      <span className={`ecg-signal-state${signalPresent ? " is-usable" : ""}`}>{signalPresent ? "Signal present" : "No usable current signal"}</span>
      <button type="button" className="btn btn-secondary ecg-mode-button" onClick={() => setMode((value) => value === "sweep" ? "scroll" : "sweep")}>Display: {mode === "sweep" ? "Sweep" : "Scroll"}</button>
    </div>
    <div className="ecg-canvas-wrap">
      <canvas ref={canvasRef} className="ecg-monitor-canvas" aria-label="Raw ECG monitor trace. Educational prototype only." />
      {!signalPresent && <div className="ecg-invalid-overlay" role="status"><div>NO VALID ECG SIGNAL · CHECK LEADS<small>{signalReason} · {livePackets.length} live packets received</small></div></div>}
    </div>
    <div className="ecg-trend-times"><span>100 mm/s</span><span>250 Hz · {livePackets.length} live packets · {signalReason}</span><span>{lastPacketAt ? new Date(lastPacketAt).toLocaleTimeString() : latestBatch?.recorded_at ? new Date(latestBatch.recorded_at).toLocaleTimeString() : "Awaiting live ECG packets"}</span></div>
    {feedError && <small className="clinical-error">Live ECG channel is disconnected. Check Realtime channel authorization and device-ingest deployment.</small>}
    <small className="ecg-disclaimer">Monitor-style trend, not a clinical ECG waveform or diagnostic display.</small>
  </article>;
}
