import { useEffect, useRef } from "react";

type Levels = { current: { local: number; remote: number } };

/**
 * Scrolling level meter. Each bar is one ~50ms sample; colour shows who was
 * louder at that moment (caller vs agent). Reads levels from a ref so the
 * call UI doesn't re-render 60 times a second.
 */
export function Waveform({ levels, active, bars = 44 }: { levels: Levels; active: boolean; bars?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const history: { v: number; who: "agent" | "caller" }[] = Array.from({ length: bars }, () => ({ v: 0, who: "agent" }));
    let raf = 0;
    let last = 0;
    let smooth = 0;

    const resize = () => {
      el.width = el.clientWidth * dpr;
      el.height = el.clientHeight * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const { local, remote } = levels.current;
      const who = remote >= local ? "agent" : "caller";
      const target = active ? Math.min(1, Math.max(local, remote) * 2.4) : 0;
      smooth += (target - smooth) * 0.35;
      if (t - last > 55) {
        last = t;
        history.shift();
        history.push({ v: smooth, who });
      }
      const w = el.width;
      const h = el.height;
      ctx.clearRect(0, 0, w, h);
      const gap = w / bars;
      const bw = Math.max(2 * dpr, gap * 0.42);
      history.forEach((b, i) => {
        // idle "breathing" so the line never looks dead
        const idle = active ? 0.06 + 0.03 * Math.sin(t / 380 + i * 0.5) : 0.04;
        const amp = Math.max(idle, b.v);
        const bh = Math.max(bw, amp * h * 0.92);
        const x = i * gap + (gap - bw) / 2;
        const y = (h - bh) / 2;
        const fade = 0.25 + 0.75 * (i / bars);
        ctx.globalAlpha = fade;
        ctx.fillStyle = b.v < 0.05 ? "rgba(242,239,230,0.35)" : b.who === "agent" ? "#7fd1a4" : "#f2efe6";
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, bw / 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [levels, active, bars]);

  return <canvas ref={canvas} className="waveform" aria-hidden />;
}
