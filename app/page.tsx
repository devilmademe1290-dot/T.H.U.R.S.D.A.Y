"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Activity, Zap, Radio, Mic, MicOff, Minimize2, Maximize2, X } from "lucide-react";
import { useUser } from "@clerk/nextjs";

/* ------------------------------------------------------------------ */
/*  HANDS-FREE TUNING (tweak these if claps / voice are missed)        */
/* ------------------------------------------------------------------ */
const CLAP_PEAK = 0.4;           // how loud a clap must spike (0..1). Lower = more sensitive
const CLAP_RATIO = 8;            // clap must be this many times louder than the room noise
const CLAP_HF_RATIO = 0.2;       // share of energy above 2.5 kHz (claps are "hissy", voices are not)
const CLAP_COOLDOWN_MS = 1000;   // ignore repeat claps for this long
const VOICE_START_MIN = 0.025;   // min mic level that counts as "you started speaking"
const VOICE_KEEP_MIN = 0.015;    // min level that counts as "still speaking"
const HF_SILENCE_MS = 1400;      // silence after speech before the AI processes your words
const HF_MIN_VOICED_MS = 300;    // shorter blips (coughs, clicks) are discarded
const HF_MAX_RECORD_MS = 30000;  // safety cap for one utterance
const HF_RECORD_GAIN = 2;        // boost sent to the AI (mic AGC is off so claps aren't squashed)
const AUTO_SLEEP_MS = 120000;    // go back to standby after this much inactivity (clap wakes again)

const makeBuf = (n: number) => new Float32Array(n);

/* ------------------------------------------------------------------ */
/*  HOLOGRAPHIC GOLD ORB (visual only - no logic lives in here)        */
/* ------------------------------------------------------------------ */
type OrbMode = "standby" | "idle" | "active" | "speaking";
type OrbPoint = { x: number; y: number; z: number; s: number; b: number; ph: number; d: number };

const vNorm = (v: number[]) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const vCross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const randDir = () => {
  const z = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), z, r * Math.sin(t)];
};

function buildOrb() {
  const pts: OrbPoint[] = [];
  const lines: { a: number[]; b: number[]; w: number }[] = [];
  const core: { a: number; r: number; s: number; b: number }[] = [];
  const add = (x: number, y: number, z: number, s: number, b: number, d = 1) =>
    pts.push({ x, y, z, s, b, ph: Math.random() * Math.PI * 2, d });

  // loose dust on / inside the shell
  for (let i = 0; i < 300; i++) {
    const v = randDir();
    const r = Math.random() < 0.15 ? 0.55 + Math.random() * 0.45 : 1 + (Math.random() - 0.5) * 0.08;
    add(v[0] * r, v[1] * r, v[2] * r, 0.5 + Math.random(), Math.random() ** 2 * 0.55, 1.2);
  }

  // glittering clusters on the shell
  for (let c = 0; c < 26; c++) {
    const cen = randDir();
    const spread = 0.08 + Math.random() * 0.2;
    const n = 20 + Math.floor(Math.random() * 40);
    for (let i = 0; i < n; i++) {
      const v = vNorm([
        cen[0] + (Math.random() - 0.5) * spread * 2,
        cen[1] + (Math.random() - 0.5) * spread * 2,
        cen[2] + (Math.random() - 0.5) * spread * 2,
      ]);
      const r = 1 + (Math.random() - 0.5) * 0.05;
      add(v[0] * r, v[1] * r, v[2] * r, 0.6 + Math.random() * 1.3, 0.35 + Math.random() * 0.6, 1.2);
    }
  }

  // broken circular arcs (the fragmented golden "wire" look)
  const arc = (axis: number[], h: number, a0: number, len: number, rr: number, step: number, gap: number, bMin: number, dashed: boolean) => {
    const n = vNorm(axis);
    const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = vNorm(vCross(n, helper));
    const v = vCross(n, u);
    const rad = Math.sqrt(Math.max(0, 1 - h * h));
    const steps = Math.max(2, Math.floor(len / step));
    const dashK = 3 + Math.random() * 9;
    const dashPh = Math.random() * 6;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + i * step;
      if (Math.random() < gap) continue;
      if (dashed && Math.sin(a * dashK + dashPh) > 0.55) continue;
      const jr = rr + (Math.random() - 0.5) * 0.03;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = (n[0] * h + (u[0] * c + v[0] * s) * rad) * jr;
      const y = (n[1] * h + (u[1] * c + v[1] * s) * rad) * jr;
      const z = (n[2] * h + (u[2] * c + v[2] * s) * rad) * jr;
      const big = Math.random() < 0.03;
      add(x, y, z, big ? 3 + Math.random() * 2.5 : 0.7 + Math.random() * 1.1, big ? 0.92 : bMin + Math.random() * (1 - bMin), 0.8);
    }
  };

  const axes = [[0.25, 1, 0.1], [1, 0.15, 0.35], [0.5, 0.3, 1]];
  axes.forEach((ax) => {
    arc(ax, 0, Math.random() * 6, Math.PI * 2 * 0.92, 1, 0.03, 0.06, 0.45, true);
    arc(ax, 0, Math.random() * 6, Math.PI * 2 * 0.92, 0.985, 0.03, 0.1, 0.4, true);
  });
  arc(axes[0], 0.55, 0, Math.PI * 2, 1, 0.03, 0.08, 0.4, true);
  arc(axes[1], -0.45, 1, Math.PI * 2, 1, 0.03, 0.08, 0.4, true);
  for (let i = 0; i < 18; i++) {
    arc(randDir(), (Math.random() - 0.5) * 1.6, Math.random() * 6, 0.3 + Math.random() * 1.6, 0.96 + Math.random() * 0.06, 0.02, 0.1, 0.5, false);
  }
  for (let i = 0; i < 8; i++) {
    arc(randDir(), (Math.random() - 0.5) * 1.2, Math.random() * 6, 0.4 + Math.random() * 1.2, 0.55 + Math.random() * 0.3, 0.025, 0.12, 0.45, false);
  }

  // radial spokes shooting through the centre
  for (let i = 0; i < 11; i++) {
    const d = randDir();
    const through = i < 6;
    const t0 = through ? -1 : 0.12;
    const t1 = through ? 1 : 0.8 + Math.random() * 0.2;
    let t = t0;
    while (t < t1) {
      const e = Math.min(t1, t + 0.15 + Math.random() * 0.5);
      lines.push({
        a: [d[0] * t, d[1] * t, d[2] * t],
        b: [d[0] * e, d[1] * e, d[2] * e],
        w: 0.3 + Math.random() * 0.5,
      });
      for (let q = t; q < e; q += 0.025) {
        if (Math.abs(q) < 0.14) continue;
        const j = () => (Math.random() - 0.5) * 0.012;
        add(d[0] * q + j(), d[1] * q + j(), d[2] * q + j(), 0.5 + Math.random() * 0.9, 0.5 + Math.random() * 0.5, 0.5);
      }
      t = e + 0.04 + Math.random() * 0.25;
    }
  }

  // bright core rings
  const ringDots = (r: number, n: number, sMin: number, sMax: number, b: number) => {
    for (let i = 0; i < n; i++) {
      core.push({ a: (i / n) * Math.PI * 2 + Math.random() * 0.03, r: r + (Math.random() - 0.5) * 0.012, s: sMin + Math.random() * (sMax - sMin), b });
    }
  };
  ringDots(0.17, 120, 1.0, 2.4, 0.95);
  ringDots(0.2, 80, 0.8, 1.8, 0.7);
  ringDots(0.115, 60, 0.8, 1.6, 0.6);
  ringDots(0.27, 60, 0.6, 1.3, 0.45);

  return { pts, lines, core };
}

function makeSprite(stops: [number, string][]) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return c;
}

function HoloOrb({ mode, hovered, burstKey = 0 }: { mode: OrbMode; hovered: boolean; burstKey?: number }) {
  const burstKeyRef = useRef(burstKey);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef<OrbMode>(mode);
  const hoverRef = useRef(hovered);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { hoverRef.current = hovered; }, [hovered]);
  useEffect(() => { burstKeyRef.current = burstKey; }, [burstKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const geo = buildOrb();
    const sprites = [
      makeSprite([[0, "rgba(255,170,50,0.95)"], [0.3, "rgba(230,110,10,0.5)"], [1, "rgba(180,70,0,0)"]]),
      makeSprite([[0, "rgba(255,236,170,1)"], [0.18, "rgba(255,190,60,0.9)"], [0.5, "rgba(240,140,20,0.28)"], [1, "rgba(200,90,0,0)"]]),
      makeSprite([[0, "rgba(255,255,240,1)"], [0.2, "rgba(255,225,130,0.95)"], [0.55, "rgba(255,170,40,0.3)"], [1, "rgba(220,120,0,0)"]]),
    ];

    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    let spd = 0.14, amp = 0.012, freq = 0.8, disp = 0.004, bright = 0.9, voice = 0, hov = 0;
    let open = modeRef.current === "standby" ? 0.5 : 1, burst = 0, lastBurst = burstKeyRef.current;
    let yaw = Math.random() * 6, spin = 0, t = 0, last = performance.now(), raf = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;

      const m = modeRef.current;
      const T =
        m === "standby" ? { spd: 0.05, amp: 0.02, freq: 0.5, disp: 0.002, bright: 0.4, voice: 0, open: 0.5 }
        : m === "speaking" ? { spd: 0.32, amp: 0.008, freq: 1.2, disp: 0.022, bright: 1.15, voice: 1, open: 1 }
        : m === "active" ? { spd: 0.6, amp: 0.03, freq: 2.4, disp: 0.012, bright: 1.05, voice: 0, open: 1 }
        : { spd: 0.14, amp: 0.012, freq: 0.8, disp: 0.004, bright: 0.9, voice: 0, open: 1 };
      const k = 1 - Math.exp(-dt * 3);
      spd = lerp(spd, T.spd, k);
      amp = lerp(amp, T.amp, k);
      freq = lerp(freq, T.freq, k);
      disp = lerp(disp, T.disp, k);
      bright = lerp(bright, T.bright, k);
      voice = lerp(voice, T.voice, k);
      hov = lerp(hov, hoverRef.current ? 1 : 0, k);
      open = lerp(open, T.open, 1 - Math.exp(-dt * 2.4));
      if (burstKeyRef.current !== lastBurst) { lastBurst = burstKeyRef.current; burst = 1; }
      burst *= Math.exp(-dt * 2.5);

      yaw += dt * spd;
      spin += dt * (0.8 + spd * 2);
      const pulse = amp * Math.sin(t * freq * Math.PI * 2) + voice * 0.05 * Math.abs(Math.sin(t * 6.3) * Math.sin(t * 2.1 + 0.7));
      const kScale = (1 + pulse + hov * 0.025) * (open + burst * 0.12);
      const bl = bright * (1 + hov * 0.2) + burst * 0.8;

      const tiltX = 0.38 + 0.08 * Math.sin(t * 0.35);
      const cY = Math.cos(yaw), sY = Math.sin(yaw), cX = Math.cos(tiltX), sX = Math.sin(tiltX);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.43, sc = R / 180, F = 5;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      // faint volumetric shell haze
      const haze = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.08 * kScale);
      haze.addColorStop(0, `rgba(255,150,30,${0.07 * bl})`);
      haze.addColorStop(0.8, `rgba(255,150,30,${0.05 * bl})`);
      haze.addColorStop(0.95, `rgba(255,175,55,${0.12 * bl})`);
      haze.addColorStop(1, "rgba(255,175,55,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, w, h);

      // glow ring around the core
      const cg = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 0.5 * kScale);
      const cp = (0.8 + 0.2 * Math.sin(t * 2.2)) * bl;
      cg.addColorStop(0, "rgba(255,170,40,0)");
      cg.addColorStop(0.45, `rgba(255,190,70,${0.5 * cp})`);
      cg.addColorStop(0.7, `rgba(255,140,20,${0.18 * cp})`);
      cg.addColorStop(1, "rgba(255,140,20,0)");
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, w, h);

      // spokes (crisp streaks)
      ctx.lineCap = "round";
      for (const l of geo.lines) {
        const pa: number[] = [], pb: number[] = [];
        for (const [src, dst] of [[l.a, pa], [l.b, pb]] as [number[], number[]][]) {
          const x = src[0] * kScale, y = src[1] * kScale, z = src[2] * kScale;
          const x1 = x * cY + z * sY, z1 = -x * sY + z * cY;
          const y2 = y * cX - z1 * sX, z2 = y * sX + z1 * cX;
          const s = F / (F - z2);
          dst.push(cx + x1 * s * R, cy + y2 * 0.95 * s * R, z2);
        }
        const depth = Math.min(1, Math.max(0, ((pa[2] + pb[2]) / 2 + 1) / 2));
        ctx.strokeStyle = `rgba(255,196,90,${Math.min(1, (0.1 + 0.3 * depth) * bl)})`;
        ctx.lineWidth = Math.max(0.5, l.w * sc);
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.stroke();
      }

      // particles
      for (const p of geo.pts) {
        const kk = kScale + p.d * disp * Math.sin(t * (6 + p.ph) + p.ph * 3);
        const x = p.x * kk, y = p.y * kk, z = p.z * kk;
        const x1 = x * cY + z * sY, z1 = -x * sY + z * cY;
        const y2 = y * cX - z1 * sX, z2 = y * sX + z1 * cX;
        const depth = Math.min(1, Math.max(0, (z2 + 1) / 2));
        const tw = 0.7 + 0.3 * Math.sin(t * (1.5 + p.ph * 0.5) + p.ph * 5);
        const flick = Math.sin(t * 17 + p.ph * 11) > 0.985 ? 1.6 : 1;
        const a = Math.min(1, (0.3 + 0.7 * depth) * (0.3 + 0.7 * p.b) * tw * flick * bl);
        if (a < 0.02) continue;
        const s = F / (F - z2);
        const dia = Math.max(2, p.s * 5 * sc * s * (0.7 + 0.3 * depth));
        const sp = sprites[p.b > 0.78 ? 2 : p.b > 0.4 ? 1 : 0];
        ctx.globalAlpha = a;
        ctx.drawImage(sp, cx + x1 * s * R - dia / 2, cy + y2 * 0.95 * s * R - dia / 2, dia, dia);
      }

      // core rings (always facing the viewer, spinning)
      const tilt = 0.45 + 0.15 * Math.sin(t * 0.6);
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      for (const c of geo.core) {
        const ang = c.a + spin * (c.r > 0.2 ? -0.6 : 1);
        const x = Math.cos(ang) * c.r * kScale;
        const y0 = Math.sin(ang) * c.r * kScale;
        const z = y0 * st;
        const s = F / (F - z);
        const tw = 0.75 + 0.25 * Math.sin(t * 3 + c.a * 7);
        ctx.globalAlpha = Math.min(1, (0.35 + 0.65 * c.b) * tw * bl);
        const dia = Math.max(2, c.s * 5 * sc * s);
        ctx.drawImage(sprites[c.b > 0.8 ? 2 : 1], cx + x * s * R - dia / 2, cy + y0 * ct * s * R - dia / 2, dia, dia);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

export default function ThursdayMain() {
  const { user } = useUser();
  const userName = user?.firstName || user?.username || "Authorized User";

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isWidgetMode, setIsWidgetMode] = useState(false); // Widget mode state
  const [status, setStatus] = useState("NEURAL CORE ONLINE");
  const [inputMessage, setInputMessage] = useState("");
  const [response, setResponse] = useState(`T.H.U.R.S.D.A.Y. neural array synchronized. Welcome back, ${userName}.`);
  const [isLoading, setIsLoading] = useState(false);
  const [orbHover, setOrbHover] = useState(false); // visual hover glow only
  const [handsFree, setHandsFree] = useState(false);   // hands-free mode armed?
  const [isStandby, setIsStandby] = useState(false);   // asleep, waiting for a clap
  const [wakeBurst, setWakeBurst] = useState(0);       // bumps on every wake-up (orb flash)
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasSpokenRef = useRef(false);
  const isListeningRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);

  // ---- hands-free refs (separate from the manual-mic refs above) ----
  const handsFreeRef = useRef(false);
  const standbyRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isLoadingRef = useRef(false);
  const hfStreamRef = useRef<MediaStream | null>(null);
  const hfCtxRef = useRef<AudioContext | null>(null);
  const hfAnalyserRef = useRef<AnalyserNode | null>(null);
  const hfDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const hfTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hfTimeBufRef = useRef<ReturnType<typeof makeBuf> | null>(null);
  const hfFreqBufRef = useRef<ReturnType<typeof makeBuf> | null>(null);
  const hfRecRef = useRef<{ mr: MediaRecorder; send: boolean; startedAt: number; voicedMs: number; lastVoiceAt: number } | null>(null);
  const hfStateRef = useRef({ floor: 0.006, slowRms: 0.004, lastClapAt: 0, ignoreUntil: 0, lastActivity: 0, lastTick: 0 });
  const hfApiRef = useRef<{ tick: () => void; sendAudio: (b64: string) => void }>({ tick: () => {}, sendAudio: () => {} });

  // keep the always-on monitor in sync with what the AI is doing (so it never hears itself)
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
    const now = performance.now();
    hfStateRef.current.lastActivity = now;
    if (!isSpeaking) hfStateRef.current.ignoreUntil = now + 700;
  }, [isSpeaking]);
  useEffect(() => {
    isLoadingRef.current = isLoading;
    hfStateRef.current.lastActivity = performance.now();
  }, [isLoading]);

  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close().catch(console.error);
    };
  }, []);

  const speakResponse = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = 1.1;
    utterance.rate = 1.05;
    
    utterance.onstart = () => {
      setIsSpeaking(true);
      setStatus("TRANSMITTING");
    };
    
    utterance.onend = () => {
      setIsSpeaking(false);
      setStatus("AWAITING INPUT");
    };
    
    window.speechSynthesis.speak(utterance);
  };

  const processNeuralQuery = async (payload: any) => {
    setIsLoading(true);
    setStatus("PROCESSING...");
    setResponse("Synthesizing data...");
    
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      
      if (!res.ok || data.error) throw new Error(data.error || "API Connection Failed");
      
      if (data.response) {
        setResponse(data.response);
        speakResponse(data.response);
      }
    } catch (error: any) {
      const errorMsg = error.message || "Error establishing secure neural link.";
      setResponse(errorMsg);
      setStatus("SYSTEM FAULT");
      speakResponse(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTextQuery = async (queryText: string) => {
    if (!queryText.trim() || isLoading) return;
    await processNeuralQuery({ prompt: queryText, userName });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleTextQuery(inputMessage);
    setInputMessage("");
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
    isListeningRef.current = false;
    
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close().catch(console.error);
  };

  const toggleListening = async () => {
    if (isListeningRef.current) {
      stopListening();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      hasSpokenRef.current = false;
      isListeningRef.current = true;
      setIsListening(true);
      setStatus("MIC ACTIVE");
      window.speechSynthesis.cancel();

      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      
      if (audioContext.state === 'suspended') await audioContext.resume();
      
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const failsafeTimer = setTimeout(() => {
        if (!hasSpokenRef.current) {
          stopListening();
          setStatus("NO SPEECH DETECTED");
        }
      }, 7000);

      const monitorAudio = () => {
        if (!isListeningRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / bufferLength;

        if (average > 8) {
          hasSpokenRef.current = true;
          clearTimeout(failsafeTimer);
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else {
          if (hasSpokenRef.current && !silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => stopListening(), 2000);
          }
        }
        animationFrameRef.current = requestAnimationFrame(monitorAudio);
      };

      monitorAudio();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        if (audioChunksRef.current.length === 0) return;
        setStatus("ENCODING...");
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string).split(',')[1];
          await processNeuralQuery({ audio: base64Audio, userName });
          stream.getTracks().forEach(track => track.stop());
        };
      };

      mediaRecorder.start();
    } catch (err) {
      console.error("Mic error:", err);
      setStatus("MIC PERMISSION DENIED");
      setIsListening(false);
      isListeningRef.current = false;
    }
  };

  // ======================================================================
  //  HANDS-FREE MODE: clap to wake -> speak to talk -> silence = process
  // ======================================================================
  const wakeUp = () => {
    if (!standbyRef.current) return;
    standbyRef.current = false;
    setIsStandby(false);
    setWakeBurst((n) => n + 1);
    hfStateRef.current.lastActivity = performance.now();
    const msg = "All systems are online.";
    setResponse(msg);
    setStatus("ALL SYSTEMS ONLINE");
    speakResponse(msg);
  };

  const goStandby = () => {
    standbyRef.current = true;
    setIsStandby(true);
    setStatus("STANDBY · CLAP TO WAKE");
    setResponse("Standing by. Clap to wake me.");
  };

  const finishAutoRecord = (send: boolean) => {
    const rec = hfRecRef.current;
    if (!rec) return;
    hfRecRef.current = null;
    rec.send = send;
    if (rec.mr.state === "recording") rec.mr.stop();
    setIsListening(false);
    setStatus(send ? "ENCODING..." : "AWAITING INPUT");
    const now = performance.now();
    hfStateRef.current.ignoreUntil = now + 1000;
    hfStateRef.current.lastActivity = now;
  };

  const beginAutoRecord = (now: number) => {
    const dest = hfDestRef.current;
    if (!dest || hfRecRef.current) return;
    const mr = new MediaRecorder(dest.stream);
    const chunks: Blob[] = [];
    const rec = { mr, send: false, startedAt: now, voicedMs: 0, lastVoiceAt: now };

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mr.onstop = () => {
      if (!rec.send || chunks.length === 0) return;
      const blob = new Blob(chunks, { type: "audio/webm" });
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => {
        const base64Audio = (reader.result as string).split(",")[1];
        hfApiRef.current.sendAudio(base64Audio); // same payload as the manual mic
      };
    };

    mr.start();
    hfRecRef.current = rec;
    window.speechSynthesis?.cancel();
    setIsListening(true);
    setStatus("LISTENING");
  };

  const highFreqRatio = (analyser: AnalyserNode, ctx: AudioContext) => {
    const buf = hfFreqBufRef.current;
    if (!buf) return 1;
    analyser.getFloatFrequencyData(buf);
    const cutoff = Math.floor((2500 / (ctx.sampleRate / 2)) * buf.length);
    let lo = 0, hi = 0;
    for (let i = 0; i < buf.length; i++) {
      const p = Math.pow(10, buf[i] / 10);
      if (i < cutoff) lo += p; else hi += p;
    }
    return hi / (lo + hi || 1);
  };

  // runs every 25 ms while hands-free is armed
  const tick = () => {
    const analyser = hfAnalyserRef.current;
    const ctx = hfCtxRef.current;
    const buf = hfTimeBufRef.current;
    if (!analyser || !ctx || !buf) return;

    const now = performance.now();
    const S = hfStateRef.current;
    const dt = Math.min(100, now - (S.lastTick || now));
    S.lastTick = now;

    analyser.getFloatTimeDomainData(buf);
    let peak = 0, sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);

    // never react while the AI talks / thinks, or while the manual mic is in use
    if (isSpeakingRef.current || isLoadingRef.current || isListeningRef.current || now < S.ignoreUntil) return;

    // ---- STANDBY: only listen for a clap ----
    if (standbyRef.current) {
      const loud = peak > CLAP_PEAK && peak > S.slowRms * CLAP_RATIO && now - S.lastClapAt > CLAP_COOLDOWN_MS;
      if (loud && highFreqRatio(analyser, ctx) > CLAP_HF_RATIO) {
        S.lastClapAt = now;
        wakeUp();
        return;
      }
      S.slowRms = S.slowRms * 0.97 + rms * 0.03;
      return;
    }

    // ---- AWAKE: voice activity detection ----
    const rec = hfRecRef.current;
    if (!rec) {
      if (rms < S.floor * 2.5 + 0.002) S.floor = S.floor * 0.98 + rms * 0.02; // learn room noise
      if (rms > Math.max(VOICE_START_MIN, S.floor * 4)) {
        beginAutoRecord(now);
        if (hfRecRef.current) hfRecRef.current.voicedMs = dt;
      } else if (now - S.lastActivity > AUTO_SLEEP_MS) {
        goStandby();
      }
      return;
    }

    if (rms > Math.max(VOICE_KEEP_MIN, S.floor * 2.5)) {
      rec.voicedMs += dt;
      rec.lastVoiceAt = now;
    }
    const silentFor = now - rec.lastVoiceAt;
    if (rec.voicedMs >= HF_MIN_VOICED_MS && silentFor > HF_SILENCE_MS) finishAutoRecord(true);   // you stopped -> process
    else if (rec.voicedMs < HF_MIN_VOICED_MS && silentFor > 700) finishAutoRecord(false);        // just a blip -> discard
    else if (now - rec.startedAt > HF_MAX_RECORD_MS) finishAutoRecord(true);
  };

  // always point the interval at the freshest functions (no stale closures)
  hfApiRef.current = {
    tick,
    sendAudio: (b64: string) => { processNeuralQuery({ audio: b64, userName }); },
  };

  const teardownHandsFree = () => {
    if (hfTimerRef.current) clearInterval(hfTimerRef.current);
    hfTimerRef.current = null;
    const rec = hfRecRef.current;
    if (rec) {
      rec.send = false;
      if (rec.mr.state === "recording") rec.mr.stop();
      hfRecRef.current = null;
    }
    hfStreamRef.current?.getTracks().forEach((t) => t.stop());
    hfStreamRef.current = null;
    if (hfCtxRef.current && hfCtxRef.current.state !== "closed") hfCtxRef.current.close().catch(console.error);
    hfCtxRef.current = null;
    hfAnalyserRef.current = null;
    hfDestRef.current = null;
    handsFreeRef.current = false;
    standbyRef.current = false;
  };

  const startHandsFree = async () => {
    if (handsFreeRef.current) return;
    try {
      // AGC + noise suppression OFF so a clap is not squashed as "noise"
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      if (ctx.state === "suspended") await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      const gain = ctx.createGain();
      gain.gain.value = HF_RECORD_GAIN;
      const dest = ctx.createMediaStreamDestination();
      source.connect(analyser);
      source.connect(gain);
      gain.connect(dest);

      hfStreamRef.current = stream;
      hfCtxRef.current = ctx;
      hfAnalyserRef.current = analyser;
      hfDestRef.current = dest;
      hfTimeBufRef.current = makeBuf(analyser.fftSize);
      hfFreqBufRef.current = makeBuf(analyser.frequencyBinCount);
      hfStateRef.current = { floor: 0.006, slowRms: 0.004, lastClapAt: 0, ignoreUntil: performance.now() + 500, lastActivity: performance.now(), lastTick: 0 };

      // this click is the user gesture browsers need before speech can play later
      if ("speechSynthesis" in window) {
        const unlock = new SpeechSynthesisUtterance(" ");
        unlock.volume = 0;
        window.speechSynthesis.speak(unlock);
      }

      handsFreeRef.current = true;
      standbyRef.current = true;
      setHandsFree(true);
      setIsStandby(true);
      setStatus("STANDBY · CLAP TO WAKE");
      setResponse("Hands-free armed. Clap to wake me, then just start talking.");
      hfTimerRef.current = setInterval(() => hfApiRef.current.tick(), 25);
    } catch (err) {
      console.error("Hands-free mic error:", err);
      teardownHandsFree();
      setStatus("MIC PERMISSION DENIED");
    }
  };

  const stopHandsFree = () => {
    teardownHandsFree();
    setHandsFree(false);
    setIsStandby(false);
    setIsListening(false);
    setStatus("HANDS-FREE OFF");
  };

  const toggleHandsFree = () => {
    if (handsFreeRef.current) stopHandsFree();
    else startHandsFree();
  };

  // mic button / orb click: wakes from standby, ends an auto-recording early, else the original manual toggle
  const handleMicClick = () => {
    if (handsFreeRef.current) {
      if (standbyRef.current) { wakeUp(); return; }
      if (hfRecRef.current) { finishAutoRecord(true); return; }
    }
    toggleListening();
  };

  useEffect(() => () => teardownHandsFree(), []); // release the mic on unmount

  const closeApp = () => {
    if (typeof window !== "undefined") {
      window.close();
    }
  };

  return (
    // Dynamic background based on widget mode. Drag-region added so you can move the borderless window.
    <div 
      className={`relative flex flex-col items-center justify-between min-h-screen w-full font-mono p-6 overflow-hidden select-none transition-colors duration-500 ${isWidgetMode ? 'bg-transparent' : 'bg-[#030200]'}`}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} 
    >
      
      {/* Background gradients hidden in widget mode */}
      {!isWidgetMode && (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(245,158,11,0.15)_0%,_transparent_75%)] pointer-events-none" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#451a03_1px,transparent_1px),linear-gradient(to_bottom,#451a03_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-20 pointer-events-none" />
        </>
      )}

      {/* Header */}
      {!isWidgetMode && (
        <header className="relative z-10 w-full max-w-6xl flex items-center justify-between border-b border-amber-500/20 pb-4 backdrop-blur-md" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="flex items-center space-x-3">
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-widest text-amber-300 drop-shadow-[0_0_12px_rgba(245,158,11,0.8)]">
                T.H.U.R.S.D.A.Y.
              </h1>
              <p className="text-[10px] text-amber-500/70 uppercase tracking-wider">
                Technologically Hyper-Intelligent Unified Robotic System
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={toggleHandsFree}
              className={`flex items-center space-x-2 text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer ${handsFree ? 'text-amber-950 bg-amber-400 border-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.6)]' : 'text-amber-400/80 bg-amber-950/40 border-amber-500/30 hover:bg-amber-900/60'}`}
            >
              <Radio className={`w-3.5 h-3.5 ${handsFree ? 'animate-pulse' : ''}`} />
              <span className="text-[11px] tracking-widest uppercase">HANDS-FREE {handsFree ? 'ON' : 'OFF'}</span>
            </button>
            <button 
              onClick={() => setIsWidgetMode(true)}
              className="flex items-center space-x-2 text-xs text-amber-400/80 bg-amber-950/40 border border-amber-500/30 px-3 py-1.5 rounded-full hover:bg-amber-900/60 transition-colors cursor-pointer"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span className="text-[11px] tracking-widest uppercase">WIDGET MODE</span>
            </button>
            <button onClick={closeApp} className="text-red-500/80 hover:text-red-400">
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>
      )}

      {/* Widget Mode Controls (Shown only when in floating mode) */}
      {isWidgetMode && (
        <div className="absolute top-4 right-4 z-50 flex space-x-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={toggleHandsFree}
            className={`p-2 rounded-full border backdrop-blur-md cursor-pointer ${handsFree ? 'bg-amber-400 border-amber-300 text-amber-950' : 'bg-amber-950/60 border-amber-500/30 text-amber-400 hover:bg-amber-900/80'}`}
          >
            <Radio className={`w-4 h-4 ${handsFree ? 'animate-pulse' : ''}`} />
          </button>
          <button 
            onClick={() => setIsWidgetMode(false)}
            className="p-2 rounded-full bg-amber-950/60 border border-amber-500/30 text-amber-400 hover:bg-amber-900/80 backdrop-blur-md cursor-pointer"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button 
            onClick={closeApp}
            className="p-2 rounded-full bg-red-950/60 border border-red-500/30 text-red-400 hover:bg-red-900/80 backdrop-blur-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Neural Core (Always Visible) */}
      <main className="relative z-10 flex flex-col items-center justify-center my-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <motion.div
          animate={{
            scale: isSpeaking ? [1, 1.25, 1] : isLoading || isListening ? [1, 1.15, 1] : [1, 1.05, 1],
            opacity: isStandby ? [0.05, 0.12, 0.05] : isSpeaking ? [0.6, 0.9, 0.6] : isLoading || isListening ? [0.4, 0.7, 0.4] : [0.2, 0.4, 0.2],
          }}
          transition={{ duration: isSpeaking ? 0.8 : isLoading || isListening ? 0.5 : 3, repeat: Infinity, ease: "easeInOut" }}
          className="absolute w-64 h-64 sm:w-[28rem] sm:h-[28rem] rounded-full bg-amber-500/20 blur-3xl pointer-events-none"
        />

        <div className={`relative flex items-center justify-center transition-all duration-500 ${isWidgetMode ? 'w-48 h-48 sm:w-56 sm:h-56' : 'w-72 h-72 sm:w-[26rem] sm:h-[26rem]'}`}>
          <HoloOrb
            mode={isStandby ? "standby" : isSpeaking ? "speaking" : isLoading || isListening ? "active" : "idle"}
            hovered={orbHover}
            burstKey={wakeBurst}
          />
          {/* Click target - same toggleListening behaviour as before */}
          <div
            onClick={handleMicClick}
            onMouseEnter={() => setOrbHover(true)}
            onMouseLeave={() => setOrbHover(false)}
            className="absolute inset-[14%] rounded-full cursor-pointer z-20"
          />
        </div>

        {/* Status Badge */}
        <motion.div 
          key={status}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 px-4 py-1.5 rounded-full border border-amber-500/30 bg-amber-950/60 backdrop-blur-md text-xs tracking-widest text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.2)] flex items-center gap-2"
        >
          <Activity className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
          <span>{status}</span>
        </motion.div>
      </main>

      {/* Footer Text Interface */}
      {!isWidgetMode && (
        <footer className="relative z-10 w-full max-w-4xl flex flex-col gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <form onSubmit={handleSubmit} className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-500/20 bg-amber-950/20 backdrop-blur-md text-xs text-amber-400/80">
            <button 
              type="button" 
              onClick={handleMicClick}
              className={`p-2 rounded-full border transition-all duration-300 cursor-pointer ${isListening ? 'bg-red-500/20 border-red-500/50 text-red-400 animate-pulse' : 'bg-amber-500/10 border-amber-500/30 text-amber-500 hover:bg-amber-500/20'}`}
            >
              {isListening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>
            <span className="text-amber-500 font-semibold uppercase shrink-0 border-l border-amber-500/30 pl-3">USER:</span>
            <input 
              type="text"
              value={inputMessage}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputMessage(e.target.value)}
              disabled={isLoading || isListening}
              placeholder={isListening ? "Listening... (Will auto-send on silence)" : "Type or click mic to speak..."}
              className="w-full bg-transparent border-none outline-none text-amber-200/90 placeholder:text-amber-500/50 disabled:opacity-70"
            />
          </form>

          <div className="relative overflow-hidden rounded-xl border border-amber-400/40 bg-amber-950/30 p-5 backdrop-blur-xl shadow-[0_0_35px_rgba(245,158,11,0.18)] min-h-[100px]">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-amber-400 shadow-[0_0_12px_#f59e0b]" />
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-300" />
                <span className="text-xs font-bold tracking-wider text-amber-300 uppercase">T.H.U.R.S.D.A.Y. RESPONSE</span>
              </div>
              <span className="text-[10px] text-amber-500/70 font-mono">NEURAL SYNTHESIS</span>
            </div>
            <p className="text-sm leading-relaxed text-amber-100 font-sans tracking-wide whitespace-pre-wrap">{response}</p>
          </div>
        </footer>
      )}
    </div>
  );
}