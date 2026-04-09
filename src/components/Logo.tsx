import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /**
   * When true, the logo renders without its dark rounded-square backing,
   * so it blends into whatever background it is placed on. Useful when
   * the icon sits on an already-dark panel and the nested square reads
   * as a frame-on-frame.
   */
  bare?: boolean;
}

/**
 * Belfry logo — a bell tower broadcasting concentric signal arcs.
 * Source of truth for the mark; docs/logo.svg and public/favicon.svg
 * should stay in sync with the geometry here.
 */
export function Logo({ className, bare = false }: LogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      role="img"
      aria-label="Belfry"
    >
      <title>Belfry</title>
      {!bare && <rect width="64" height="64" rx="14" fill="#09090b" />}
      {/* Signal arcs, broadest to narrowest */}
      <path
        d="M 8 40 A 24 24 0 0 1 56 40"
        stroke="#4ade80"
        strokeWidth="2.25"
        fill="none"
        strokeLinecap="round"
        opacity="0.4"
      />
      <path
        d="M 15 40 A 17 17 0 0 1 49 40"
        stroke="#4ade80"
        strokeWidth="2.25"
        fill="none"
        strokeLinecap="round"
        opacity="0.65"
      />
      <path
        d="M 22 40 A 10 10 0 0 1 42 40"
        stroke="#4ade80"
        strokeWidth="2.25"
        fill="none"
        strokeLinecap="round"
      />
      {/* Transmitter dot */}
      <circle cx="32" cy="40" r="3" fill="#4ade80" />
      {/* Tower shaft */}
      <line
        x1="32"
        y1="43"
        x2="32"
        y2="56"
        stroke="#4ade80"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Tower base (two crossbars) */}
      <line
        x1="27"
        y1="52"
        x2="37"
        y2="52"
        stroke="#4ade80"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="25"
        y1="56"
        x2="39"
        y2="56"
        stroke="#4ade80"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
