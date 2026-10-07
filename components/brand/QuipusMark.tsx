type QuipusMarkProps = { className?: string; label?: string };

/** Original supplied artwork, including its transparent background. */
export function QuipusMark({ className, label }: QuipusMarkProps) {
  return (
    <svg viewBox="0 0 383 400" className={className}
      aria-hidden={label ? undefined : true} aria-label={label}
      role={label ? "img" : undefined} xmlns="http://www.w3.org/2000/svg">
      <image href="/quipus-emblem.png" width="383" height="400" />
    </svg>
  );
}
