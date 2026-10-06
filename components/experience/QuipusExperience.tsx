"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import styles from "./experience.module.css";

export type QuipusMotionPreference = "system" | "on" | "off";

export type QuipusMotion = {
  enabled: boolean;
  preference: QuipusMotionPreference;
  setPreference: (preference: QuipusMotionPreference) => void;
  toggle: () => void;
};

type MotionContext = QuipusMotion & {
  ready: boolean;
  visible: boolean;
};

const STORAGE_KEY = "quipus-motion";
const MotionContext = createContext<MotionContext | null>(null);

const fragments = [
  { x: 3, y: 19, size: 73, rotation: -22, drift: 22, duration: 27, delay: -9, shape: 0 },
  { x: 91, y: 13, size: 92, rotation: 18, drift: -28, duration: 31, delay: -17, shape: 1 },
  { x: 97, y: 42, size: 57, rotation: -38, drift: 16, duration: 24, delay: -3, shape: 2 },
  { x: 1, y: 54, size: 110, rotation: 34, drift: -23, duration: 35, delay: -21, shape: 1 },
  { x: 93, y: 78, size: 117, rotation: -16, drift: 29, duration: 33, delay: -11, shape: 0 },
  { x: 7, y: 89, size: 57, rotation: 42, drift: 18, duration: 29, delay: -24, shape: 2 },
  { x: 29, y: 5, size: 37, rotation: 12, drift: -12, duration: 23, delay: -13, shape: 2 },
  { x: 75, y: 6, size: 48, rotation: -36, drift: 17, duration: 32, delay: -6, shape: 0 },
  { x: 96, y: 94, size: 42, rotation: 26, drift: -15, duration: 25, delay: -19, shape: 2 },
  { x: 1, y: 5, size: 33, rotation: -8, drift: 13, duration: 30, delay: -15, shape: 0 },
] as const;

type FragmentStyle = CSSProperties & {
  "--rotation": string;
  "--drift": string;
  "--duration": string;
  "--delay": string;
};

function PolygonFragment({ shape }: { shape: number }) {
  if (shape === 1) {
    return (
      <svg viewBox="0 0 120 120" fill="none" className={styles.fragmentSvg}>
        <path d="M10 72 103 14 73 103Z" fill="#B72D36" />
        <path d="m10 72 57-8 6 39Z" fill="#751B2B" />
        <path d="m67 64 36-50-30 89Z" fill="#D94349" />
        <path d="m10 72 57-8 36-50" stroke="#EEC1C3" strokeWidth=".7" />
      </svg>
    );
  }
  if (shape === 2) {
    return (
      <svg viewBox="0 0 120 120" fill="none" className={styles.fragmentSvg}>
        <path d="M13 30 102 53 42 101Z" fill="#EEC1C3" fillOpacity=".54" />
        <path d="m13 30 53 29-24 42Z" fill="#DB777C" fillOpacity=".64" />
        <path d="m13 30 89 23-60 48Z" stroke="#B72D36" strokeOpacity=".55" strokeWidth=".8" />
        <path d="m13 30 53 29 36-6M66 59l-24 42" stroke="#751B2B" strokeOpacity=".3" strokeWidth=".65" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 120" fill="none" className={styles.fragmentSvg}>
      <path d="M14 23 108 62 45 105 58 56Z" fill="#B72D36" />
      <path d="m14 23 44 33 50 6Z" fill="#D94349" />
      <path d="m58 56 50 6-63 43Z" fill="#751B2B" />
      <path d="m14 23 44 33-13 49" stroke="#DB777C" strokeWidth=".8" />
    </svg>
  );
}

function PolygonBackdrop({ active }: { active: boolean }) {
  return (
    <div className={styles.backdrop} aria-hidden="true" data-active={active}>
      <svg className={styles.network} viewBox="0 0 1600 1000" preserveAspectRatio="none" fill="none">
        <g className={styles.networkCluster}>
          <path d="M0 126 77 80 159 182 20 233 77 80M159 182l-60 99L20 233" />
          <circle cx="77" cy="80" r="2" />
          <circle cx="159" cy="182" r="2" />
          <circle cx="20" cy="233" r="1.5" />
          <circle cx="99" cy="281" r="1.5" />
        </g>
        <g className={styles.networkCluster}>
          <path d="m1410 10 105 91 85-58M1515 101l-52 91 137 84M1463 192l137-149" />
          <circle cx="1410" cy="10" r="1.5" />
          <circle cx="1515" cy="101" r="2" />
          <circle cx="1463" cy="192" r="1.5" />
        </g>
        <g className={styles.networkCluster}>
          <path d="m0 686 96 60-41 149L0 686m96 60 70 100-111 49 60 105" />
          <circle cx="96" cy="746" r="2" />
          <circle cx="55" cy="895" r="1.5" />
          <circle cx="166" cy="846" r="1.5" />
        </g>
        <g className={styles.networkCluster}>
          <path d="m1600 605-127 85 96 88 31-173m-127 85-58 145 154-57 31 140" />
          <circle cx="1473" cy="690" r="2" />
          <circle cx="1569" cy="778" r="1.5" />
          <circle cx="1415" cy="835" r="1.5" />
        </g>
        <g className={`${styles.networkCluster} ${styles.headerNetwork}`}>
          <path d="m438 0 75 44 122-32 65 44 87-56M513 44l122-32 65 44" />
          <circle cx="513" cy="44" r="1.5" />
          <circle cx="635" cy="12" r="1.5" />
          <circle cx="700" cy="56" r="1.5" />
        </g>
      </svg>
      <svg className={styles.streaks} viewBox="0 0 1600 1000" preserveAspectRatio="none" fill="none">
        <g className={styles.streakCluster}>
          <path d="M0 342h132l46-27h71" stroke="var(--q-red)" strokeWidth="1.3" />
          <path d="M0 348h104l-17 8H0Z" fill="var(--q-red-deep)" />
          <path d="m120 342 31-18h35l-18 10h-17" stroke="var(--q-red-bright)" strokeWidth=".65" />
        </g>
        <g className={styles.streakCluster}>
          <path d="M1600 651h-93l-66 37h-88" stroke="var(--q-red)" strokeWidth="1.2" />
          <path d="M1600 641h-68l-23 10h91Z" fill="var(--q-red)" />
          <path d="m1541 672-34 19h-65" stroke="var(--q-red-rose)" strokeWidth=".8" />
        </g>
        <g className={styles.streakCluster}>
          <path d="M351 75h116l18-10h55" stroke="var(--q-red)" strokeWidth=".7" />
          <path d="m360 82 27-13h30l-26 13Z" fill="var(--q-red-bright)" />
        </g>
      </svg>
      {fragments.map((fragment, index) => (
        <div
          key={index}
          className={styles.fragment}
          data-fragment={index}
          style={{
            left: `${fragment.x}%`,
            top: `${fragment.y}%`,
            width: fragment.size,
            height: fragment.size,
            "--rotation": `${fragment.rotation}deg`,
            "--drift": `${fragment.drift}px`,
            "--duration": `${fragment.duration}s`,
            "--delay": `${fragment.delay}s`,
          } as FragmentStyle}
        >
          <PolygonFragment shape={fragment.shape} />
        </div>
      ))}
    </div>
  );
}

export function QuipusExperience({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<QuipusMotionPreference>("system");
  const [reducedMotion, setReducedMotion] = useState(true);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMedia = () => setReducedMotion(media.matches);
    const updateVisibility = () => setVisible(document.visibilityState !== "hidden");
    updateMedia();
    updateVisibility();
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "on" || saved === "off" || saved === "system") setPreferenceState(saved);
    } catch {
      // Motion still works when browser storage is unavailable.
    }
    setReady(true);
    media.addEventListener("change", updateMedia);
    document.addEventListener("visibilitychange", updateVisibility);
    const updateStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = event.newValue;
      setPreferenceState(next === "on" || next === "off" ? next : "system");
    };
    window.addEventListener("storage", updateStorage);
    return () => {
      media.removeEventListener("change", updateMedia);
      document.removeEventListener("visibilitychange", updateVisibility);
      window.removeEventListener("storage", updateStorage);
    };
  }, []);

  const enabled = ready && !reducedMotion && preference !== "off";
  const setPreference = useCallback((next: QuipusMotionPreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Keep the chosen preference for this visit when storage is unavailable.
    }
  }, []);
  const toggle = useCallback(() => setPreference(enabled ? "off" : "on"), [enabled, setPreference]);
  const value = useMemo<MotionContext>(
    () => ({ enabled, preference, setPreference, toggle, ready, visible }),
    [enabled, preference, setPreference, toggle, ready, visible],
  );

  return (
    <MotionContext.Provider value={value}>
      <div
        className={styles.experience}
        data-quipus-motion={enabled ? "on" : "off"}
        data-quipus-visibility={visible ? "visible" : "hidden"}
      >
        <PolygonBackdrop active={enabled && visible} />
        <div className={styles.content}>{children}</div>
      </div>
    </MotionContext.Provider>
  );
}

export function useQuipusMotion(): QuipusMotion {
  const context = useContext(MotionContext);
  if (!context) throw new Error("useQuipusMotion must be used within QuipusExperience");
  const { enabled, preference, setPreference, toggle } = context;
  return { enabled, preference, setPreference, toggle };
}

function scrambledText(text: string, progress: number, frame: number): string {
  const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const characters = Array.from(text);
  const settled = Math.max(0, Math.min(1, (progress - 0.24) / 0.6));
  return characters.map((character, index) => {
    if (!/[A-Za-z0-9]/.test(character) || index / characters.length < settled) return character;
    return glyphs[(character.charCodeAt(0) + index * 17 + frame * 7) % glyphs.length];
  }).join("");
}

function HeadingGeometry() {
  return (
    <svg className={styles.headingGeometry} viewBox="0 0 720 100" preserveAspectRatio="none" fill="none" aria-hidden="true">
      <g className={styles.headingLines}>
        <path d="m4 33 51-25 43 28L4 33l37 28 57-25 47-24" />
        <path d="m574 72 52-26 61 28-33 23-80-25m52-26 28 51 60-34" />
        <path d="m98 36 76-32M520 98l54-26" />
      </g>
      <g className={styles.headingFaces}>
        <path d="m4 33 51-25 43 28Z" fill="#B72D36" />
        <path d="m574 72 80 25-28-51Z" fill="#751B2B" />
      </g>
      <g className={styles.headingNodes}>
        <circle cx="4" cy="33" r="2" />
        <circle cx="55" cy="8" r="2" />
        <circle cx="98" cy="36" r="2" />
        <circle cx="41" cy="61" r="1.5" />
        <circle cx="574" cy="72" r="2" />
        <circle cx="626" cy="46" r="2" />
        <circle cx="687" cy="74" r="1.5" />
        <circle cx="654" cy="97" r="2" />
      </g>
    </svg>
  );
}

export type RevealHeadingProps = {
  as?: "h1" | "h2";
  text: string;
  className?: string;
  replayKey?: string | number;
};

export function RevealHeading({ as: Heading = "h1", text, className, replayKey }: RevealHeadingProps) {
  const context = useContext(MotionContext);
  const enabled = context?.enabled ?? false;
  const ready = context?.ready ?? true;
  const visible = context?.visible ?? true;
  const [revealing, setRevealing] = useState(false);
  const [displayText, setDisplayText] = useState(text);
  const revealedIdentity = useRef<string | null>(null);
  const identity = `${text}\u0000${replayKey ?? ""}`;

  useEffect(() => {
    if (!ready) return;
    if (!enabled || !visible) {
      revealedIdentity.current = identity;
      setRevealing(false);
      setDisplayText(text);
      return;
    }
    if (revealedIdentity.current === identity) return;
    setRevealing(true);
    setDisplayText(scrambledText(text, 0, 0));
    let animationFrame = 0;
    let start: number | null = null;
    let lastFrame = -1;
    const duration = 840;
    const tick = (time: number) => {
      start ??= time;
      const progress = Math.min(1, (time - start) / duration);
      const frame = Math.floor((time - start) / 48);
      if (frame !== lastFrame) {
        lastFrame = frame;
        setDisplayText(scrambledText(text, progress, frame));
      }
      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(tick);
      } else {
        revealedIdentity.current = identity;
        setDisplayText(text);
        setRevealing(false);
      }
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [enabled, ready, visible, identity, text]);

  return (
    <Heading className={[styles.heading, className].filter(Boolean).join(" ")} data-revealing={revealing}>
      <span className={styles.headingText}>
        <span className={styles.finalText}>{text}</span>
        {revealing && <span className={styles.scrambleText} aria-hidden="true">{displayText}</span>}
        {revealing && <HeadingGeometry />}
      </span>
    </Heading>
  );
}
