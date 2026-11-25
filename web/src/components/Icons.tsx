type P = { size?: number; className?: string };
const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const PhoneIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
  </svg>
);

export const EndIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className} style={{ transform: "rotate(135deg)" }}>
    <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" fill="currentColor" stroke="none" />
  </svg>
);

export const MicIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export const MicOffIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1M5 11a7 7 0 0 0 11.7 5.2M19 11a7 7 0 0 1-.5 2.6M12 18v3M4 4l16 16" />
  </svg>
);

export const CheckIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const XIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const ArrowIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const StatusBar = ({ time }: { time: string }) => (
  <div className="statusbar">
    <span>{time}</span>
    <span className="statusbar-icons" aria-hidden>
      <svg width="17" height="11" viewBox="0 0 17 11">
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={i * 4.4} y={8 - i * 2.6} width="3" height={3 + i * 2.6} rx="0.8" fill="currentColor" />
        ))}
      </svg>
      <svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor">
        <path d="M7.5 2.2c2.2 0 4.2.8 5.7 2.2l1.1-1.1A9.6 9.6 0 0 0 7.5.6 9.6 9.6 0 0 0 .7 3.3l1.1 1.1a8.1 8.1 0 0 1 5.7-2.2Zm0 3.1c1.3 0 2.5.5 3.4 1.3l1.1-1.1a6.4 6.4 0 0 0-9 0l1.1 1.1c.9-.8 2.1-1.3 3.4-1.3Zm0 3.1c-.5 0-.9.2-1.2.5l1.2 1.2 1.2-1.2c-.3-.3-.7-.5-1.2-.5Z" />
      </svg>
      <svg width="25" height="12" viewBox="0 0 25 12">
        <rect x="0.5" y="0.5" width="21" height="11" rx="3.2" fill="none" stroke="currentColor" opacity="0.4" />
        <rect x="2" y="2" width="15" height="8" rx="2" fill="currentColor" />
        <path d="M23 4v4c.8-.3 1.3-1.1 1.3-2S23.8 4.3 23 4Z" fill="currentColor" opacity="0.4" />
      </svg>
    </span>
  </div>
);

export const CalendarIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

export const ListIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  </svg>
);

export const HeadsetIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <rect x="3.5" y="13.5" width="4" height="6" rx="1.5" />
    <rect x="16.5" y="13.5" width="4" height="6" rx="1.5" />
    <path d="M20 19.5a3 3 0 0 1-3 2.5h-3" />
  </svg>
);

export const ChevronLeft = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m15 6-6 6 6 6" />
  </svg>
);

export const ChevronRight = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const ActivityIcon = ({ size, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
  </svg>
);

export const ClinicMark = ({ size = 28 }: P) => (
  <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
    <rect width="28" height="28" rx="7" fill="var(--brand)" />
    <path d="M11.5 7.5h5v4.5H21v5h-4.5v4.5h-5V17H7v-5h4.5z" fill="#fff" />
  </svg>
);
