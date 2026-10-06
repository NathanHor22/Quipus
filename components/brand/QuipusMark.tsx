type QuipusMarkProps = { className?: string; label?: string };

/** The supplied profile, woven Q and tassels, cropped from the original logo. */
export function QuipusMark({ className, label }: QuipusMarkProps) {
  return (
    <svg viewBox="0 0 128 128" className={className}
      aria-hidden={label ? undefined : true} aria-label={label}
      role={label ? "img" : undefined} xmlns="http://www.w3.org/2000/svg">
      <rect width="128" height="128" rx="16" fill="#F5F3ED" />
      <image href="/quipus-emblem.png" x="10" y="7" width="108" height="114" />
    </svg>
  );
}
