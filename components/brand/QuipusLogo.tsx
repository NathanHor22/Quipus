import Image from "next/image";

type QuipusLogoProps = { className?: string };

/** Full brand lockup supplied by the owner, with canvas padding cropped. */
export function QuipusLogo({ className }: QuipusLogoProps) {
  return (
    <Image
      className={className}
      src="/quipus-logo.png"
      alt="Quipus"
      width={780}
      height={832}
      sizes="(max-width: 640px) 140px, 170px"
      loading="eager"
    />
  );
}
