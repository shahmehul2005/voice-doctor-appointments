import { useCallback, useEffect, useRef, useState } from "react";
import { PipecatClient, type BotOutputData, type Transport, type UserInputData } from "@pipecat-ai/client-js";
import { API_URL, TRANSPORT } from "./api";

// Transports are loaded on first call so the dashboard itself stays light.
const makeTransport = async (): Promise<Transport> =>
  TRANSPORT === "websocket"
    ? new (await import("@pipecat-ai/websocket-transport")).WebSocketTransport()
    : new (await import("@pipecat-ai/small-webrtc-transport")).SmallWebRTCTransport();
import { connectedBlip, hangupTone, ringback } from "./sounds";

export type CallStatus = "idle" | "dialing" | "connected" | "ended";

export type Segment = { id: string; text: string; spoken: string; cut?: boolean };
export type Turn =
  | { key: string; role: "user"; text: string; interim: string }
  | { key: string; role: "agent"; segments: Segment[] }
  | { key: string; role: "tool"; callId: string; name: string; done: boolean }
  | { key: string; role: "booked" | "cancelled"; appointment: BookingSummary };

export type BookingSummary = {
  appointment_id: string;
  doctor_id: string;
  doctor: string;
  speciality: string;
  when: string;
  date: string;
  time: string;
  patient_name: string;
  room?: string;
};

export type ServerEvent =
  | { type: "availability_checked"; doctor_ids: string[]; date: string | null }
  | { type: "appointment_booked"; appointment: BookingSummary }
  | { type: "appointment_cancelled"; appointment: BookingSummary };

const MIN_RING_MS = 2600; // let it ring at least once, like a real call
let keySeq = 0;
const nextKey = () => `t${++keySeq}`;

export function useCall(onServerEvent: (e: ServerEvent) => void) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [agentSpeaking, setAgentSpeaking] = useState(false);

  const clientRef = useRef<PipecatClient | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopRingRef = useRef<(() => void) | null>(null);
  const statusRef = useRef<CallStatus>("idle");
  const levels = useRef({ local: 0, remote: 0 });
  const eventRef = useRef(onServerEvent);
  eventRef.current = onServerEvent;

  const setStat = (s: CallStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  const stopRing = () => {
    stopRingRef.current?.();
    stopRingRef.current = null;
  };

  const finish = useCallback((reason?: string) => {
    if (statusRef.current === "ended" || statusRef.current === "idle") return;
    stopRing();
    if (statusRef.current === "connected") hangupTone();
    if (reason) setError(reason);
    setEndedAt(Date.now());
    setAgentSpeaking(false);
    levels.current = { local: 0, remote: 0 };
    setStat("ended");
    const c = clientRef.current;
    clientRef.current = null;
    void c?.disconnect().catch(() => {});
  }, []);

  // ---- transcript reducers ----
  const onUserInput = (d: UserInputData) => {
    if (!d.text?.trim()) return;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "user") {
        const updated = d.final
          ? { ...last, text: [last.text, d.text].filter(Boolean).join(" "), interim: "" }
          : { ...last, interim: d.text };
        return [...prev.slice(0, -1), updated];
      }
      return [...prev, { key: nextKey(), role: "user", text: d.final ? d.text : "", interim: d.final ? "" : d.text }];
    });
  };

  const onBotOutput = (d: BotOutputData) => {
    if (!d.text?.trim() && !d.spoken_progress) return;
    const id = String(d.segment_id ?? nextKey());
    const full = d.spoken_progress
      ? d.spoken_progress.accumulated_text + d.spoken_progress.remaining_text
      : d.text;
    // Older protocol / no word timestamps: treat the text as spoken.
    const spoken =
      d.spoken_progress?.accumulated_text ??
      (d.spoken_status === "new" && d.will_be_spoken ? "" : full);
    const done = d.spoken_status === "completed";
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      const seg: Segment = { id, text: full, spoken: done ? full : spoken };
      if (last?.role === "agent") {
        const i = last.segments.findIndex((s) => s.id === id);
        const segments =
          i === -1
            ? [...last.segments, seg]
            : last.segments.map((s, j) => (j === i ? { ...s, text: full || s.text, spoken: done ? full || s.text : spoken || s.spoken } : s));
        return [...prev.slice(0, -1), { ...last, segments }];
      }
      return [...prev, { key: nextKey(), role: "agent", segments: [seg] }];
    });
  };

  const markInterrupted = () =>
    setTurns((prev) =>
      prev.map((t) =>
        t.role === "agent" ? { ...t, segments: t.segments.map((s) => (s.spoken.length < s.text.length ? { ...s, cut: true } : s)) } : t,
      ),
    );

  const start = useCallback(async () => {
    if (statusRef.current === "dialing" || statusRef.current === "connected") return;
    setTurns([]);
    setError(null);
    setMuted(false);
    setStartedAt(null);
    setEndedAt(null);
    setStat("dialing");
    stopRingRef.current = ringback();
    const dialAt = Date.now();

    const transport = await makeTransport();
    const client = new PipecatClient({
      transport,
      enableMic: true,
      enableCam: false,
      callbacks: {
        onBotReady: () => {
          const wait = Math.max(0, MIN_RING_MS - (Date.now() - dialAt));
          window.setTimeout(() => {
            if (statusRef.current !== "dialing") return;
            stopRing();
            connectedBlip();
            setStartedAt(Date.now());
            setStat("connected");
          }, wait);
        },
        onDisconnected: () => finish(),
        onBotDisconnected: () => finish(),
        onError: (m) => {
          // Shown on the ended screen, e.g. a bad API key or an exhausted quota.
          const detail = (m?.data as { error?: string } | undefined)?.error;
          if (detail) setError(`Agent error: ${detail.replace(/^Error:\s*/, "").slice(0, 120)}`);
        },
        onTrackStarted: (track, participant) => {
          if (participant?.local || track.kind !== "audio" || !audioRef.current) return;
          audioRef.current.srcObject = new MediaStream([track]);
          void audioRef.current.play().catch(() => {});
        },
        onLocalAudioLevel: (l) => (levels.current.local = l),
        onRemoteAudioLevel: (l) => (levels.current.remote = l),
        onBotStartedSpeaking: () => setAgentSpeaking(true),
        onBotStoppedSpeaking: () => setAgentSpeaking(false),
        onBotInterrupted: markInterrupted,
        onUserInput,
        onBotOutput,
        onLLMFunctionCallInProgress: (d) =>
          setTurns((p) => [...p, { key: nextKey(), role: "tool", callId: d.tool_call_id, name: d.function_name ?? "", done: false }]),
        onLLMFunctionCallStopped: (d) =>
          setTurns((p) => p.map((t) => (t.role === "tool" && t.callId === d.tool_call_id ? { ...t, done: true } : t))),
        onServerMessage: (data: ServerEvent) => {
          if (data?.type === "appointment_booked" || data?.type === "appointment_cancelled") {
            const role = data.type === "appointment_booked" ? "booked" : "cancelled";
            setTurns((p) => [...p, { key: nextKey(), role, appointment: data.appointment }]);
          }
          eventRef.current(data);
        },
      },
    });
    clientRef.current = client;

    try {
      if (TRANSPORT === "websocket") {
        await client.connect({ wsUrl: API_URL.replace(/^http/, "ws") + "/ws" });
      } else {
        await client.connect({ webrtcRequestParams: { endpoint: `${API_URL}/api/offer` } });
      }
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      finish(
        /permission|NotAllowed/i.test(msg)
          ? "Microphone access was blocked."
          : /429|busy/i.test(msg)
            ? "All lines are busy. Try again in a minute."
            : /503|configured/i.test(msg)
              ? "The agent isn't configured on the server yet."
              : "Couldn't reach the front desk.",
      );
    }
  }, [finish]);

  const hangUp = useCallback(() => finish(), [finish]);

  const toggleMute = useCallback(() => {
    const c = clientRef.current;
    if (!c) return;
    const next = !muted;
    c.enableMic(!next);
    setMuted(next);
  }, [muted]);

  const reset = useCallback(() => {
    if (statusRef.current === "ended") setStat("idle");
  }, []);

  useEffect(() => () => finish(), [finish]);

  return { status, turns, muted, error, startedAt, endedAt, agentSpeaking, levels, audioRef, start, hangUp, toggleMute, reset };
}
