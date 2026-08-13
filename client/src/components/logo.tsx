/**
 * Mosc-tools mark — a cue bar crossed by a sync loop.
 * Geometric, monochrome, works at 24px and 200px.
 */
export function Logo({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-label="Mosc-tools — Ontime Show Flow Sync"
      role="img"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="6" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      {/* cue bar / timing mark */}
      <path d="M16 6.5v19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* sync loop */}
      <path
        d="M9 12.2a8 8 0 0 1 13.2-1.1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M22.6 6.6v4.6h-4.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M23 19.8a8 8 0 0 1-13.2 1.1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M9.4 25.4v-4.6H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Favicon() {
  return null;
}
