// Call sounds synthesised with WebAudio, so there are no audio files to ship.

let ctx: AudioContext | null = null;
const ac = () => {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
};

function tone(freqs: number[], start: number, dur: number, gain = 0.05, type: OscillatorType = "sine") {
  const c = ac();
  const g = c.createGain();
  g.connect(c.destination);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.015);
  g.gain.setValueAtTime(gain, start + dur - 0.03);
  g.gain.linearRampToValueAtTime(0, start + dur);
  for (const f of freqs) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.connect(g);
    o.start(start);
    o.stop(start + dur + 0.02);
  }
}

/** Indian-style ringback (double ring). Returns a stop function. */
export function ringback(): () => void {
  const c = ac();
  let stopped = false;
  let timer = 0;
  const cycle = () => {
    if (stopped) return;
    const t = c.currentTime + 0.02;
    tone([400, 450], t, 0.4, 0.035);
    tone([400, 450], t + 0.6, 0.4, 0.035);
    timer = window.setTimeout(cycle, 3000);
  };
  cycle();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

export function connectedBlip() {
  const t = ac().currentTime + 0.01;
  tone([880], t, 0.08, 0.03);
}

export function hangupTone() {
  const t = ac().currentTime + 0.02;
  tone([620], t, 0.16, 0.04, "triangle");
  tone([480], t + 0.2, 0.16, 0.04, "triangle");
  tone([360], t + 0.4, 0.24, 0.04, "triangle");
}

export function bookedChime() {
  const t = ac().currentTime + 0.02;
  tone([659.25], t, 0.18, 0.035);
  tone([987.77], t + 0.12, 0.35, 0.03);
}

export function cancelledChime() {
  const t = ac().currentTime + 0.02;
  tone([587.33], t, 0.16, 0.03);
  tone([440], t + 0.12, 0.3, 0.03);
}
