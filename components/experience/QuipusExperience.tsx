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
  setScene: (scene: string) => void;
};

type MotionContext = QuipusMotion & { ready: boolean; visible: boolean };

const STORAGE_KEY = "quipus-motion";
const MotionContext = createContext<MotionContext | null>(null);

type SceneStyle = CSSProperties & { "--scene-x": string; "--scene-y": string };

/** Broad architectural planes, with one red ribbon at the page edge. */
function ArchitectureBackdrop({ active, scene }: { active: boolean; scene: string }) {
  const scenes = ["overview", "conversations", "calendar", "people", "device", "settings"];
  const position = Math.max(0, scenes.indexOf(scene));
  const sceneStyle: SceneStyle = {
    "--scene-x": position * -9 + "px",
    "--scene-y": (position % 2 === 0 ? 0 : 15) + "px",
  };

  return (
    <div className={styles.backdrop} aria-hidden="true" data-active={active} style={sceneStyle}>
      <svg className={styles.architecture} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" fill="none">
        <g className={styles.upperPlanes}>
          <path d="M960-90h680v265L1390 313H960Z" fill="#E8EBEE" />
          <path d="M960-110h680v265l-250 138H960Z" fill="#F6F7F9" />
          <path d="m1390 293 250-138v20l-250 138Z" fill="#DCE0E5" />
          <path d="M1050-95h490v190l-145 80h-345Z" fill="#FFF" />
          <path d="m1395 175 145-80v15l-145 80Z" fill="#E3E6EA" />
        </g>
        <g className={styles.lowerPlanes}>
          <path d="M-180 715h500l210 132v190H-180Z" fill="#EEF0F3" />
          <path d="M-180 690h500l210 132v190H-180Z" fill="#FAFBFC" />
          <path d="M320 690v25l210 132v-25Z" fill="#DDE2E7" />
          <path d="M-120 786h312l119 76v175h-431Z" fill="#FFF" />
          <path d="M192 786v19l119 76v-19Z" fill="#E4E8EC" />
        </g>
        <g className={styles.redRibbon}>
          <path d="m1535-150 185 9-242 439 157 308-60 37-190-346Z" fill="#929AA6" fillOpacity=".15" transform="translate(19 25)" />
          <path d="m1518-150 175 9-244 439 158 308-60 37-189-345Z" fill="#F0162F" />
          <path d="m1449 298 158 308-60 37-14-26 45-27-154-301Z" fill="#A70820" />
          <path d="m1518-150 175 9-24 18-150-7-245 434-16-6Z" fill="#FF3A4B" />
        </g>
      </svg>
      <svg className={styles.mobileArchitecture} viewBox="0 0 390 900" preserveAspectRatio="xMaxYMin slice" fill="none">
        <g className={styles.upperPlanes}>
          <path d="M236-80h210v209l-81 43H236Z" fill="#E9EDF1" />
          <path d="M236-94h210v209l-81 43H236Z" fill="#F8F9FB" />
          <path d="M278-70h132V58l-47 25h-85Z" fill="#FFF" />
          <path d="m363 83 47-25v13l-47 25Z" fill="#E0E5EB" />
        </g>
        <g className={styles.lowerPlanes}>
          <path d="M-85 734H49l85 54v160H-85Z" fill="#E9EDF1" />
          <path d="M-85 718H49l85 54v160H-85Z" fill="#FAFBFC" />
          <path d="m49 718 85 54v16l-85-54Z" fill="#DEE3E9" />
        </g>
        <g className={styles.redRibbon}><g transform="translate(38 -70)">
          <path d="m373-88 70 2-99 270 68 129-26 16-80-142Z" fill="#939CAA" fillOpacity=".15" transform="translate(8 12)" />
          <path d="m368-88 70 2-99 270 68 129-26 16-80-142Z" fill="#F0162F" />
          <path d="m339 184 68 129-26 16-9-16 20-12-65-118Z" fill="#A70820" />
        </g></g>
      </svg>
    </div>
  );
}

export function QuipusExperience({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<QuipusMotionPreference>("system");
  const [reducedMotion, setReducedMotion] = useState(true);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [scene, setSceneState] = useState("overview");

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
      // The operating-system preference still works without local storage.
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
      // Keep the preference for this visit if local storage is unavailable.
    }
  }, []);
  const toggle = useCallback(() => setPreference(enabled ? "off" : "on"), [enabled, setPreference]);
  const setScene = useCallback((next: string) => setSceneState((previous) => previous === next ? previous : next), []);
  const value = useMemo<MotionContext>(
    () => ({ enabled, preference, setPreference, toggle, setScene, ready, visible }),
    [enabled, preference, setPreference, toggle, setScene, ready, visible],
  );

  return (
    <MotionContext.Provider value={value}>
      <div className={styles.experience} data-quipus-motion={enabled ? "on" : "off"} data-quipus-visibility={visible ? "visible" : "hidden"}>
        <ArchitectureBackdrop active={enabled && visible} scene={scene} />
        <div className={styles.content}>{children}</div>
      </div>
    </MotionContext.Provider>
  );
}

export function useQuipusMotion(): QuipusMotion {
  const context = useContext(MotionContext);
  if (!context) throw new Error("useQuipusMotion must be used within QuipusExperience");
  const { enabled, preference, setPreference, toggle, setScene } = context;
  return { enabled, preference, setPreference, toggle, setScene };
}

/** Only a narrow band scrambles; settled and upcoming words stay readable. */
function scrambledText(text: string, progress: number, frame: number): string {
  const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const characters = Array.from(text);
  const cursor = progress * (characters.length + 3) - 2;
  return characters.map((character, index) => {
    if (!/[A-Za-z0-9]/.test(character) || index < cursor || index >= cursor + 3) return character;
    return glyphs[(character.charCodeAt(0) + index * 17 + frame * 7) % glyphs.length];
  }).join("");
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
  const identity = text + "\u0000" + (replayKey ?? "");

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
    setDisplayText(text);
    let animationFrame = 0;
    let start: number | null = null;
    let lastFrame = -1;
    const duration = 600;
    const tick = (time: number) => {
      start ??= time;
      const elapsed = time - start;
      const progress = Math.min(1, elapsed / duration);
      const frame = Math.floor(elapsed / 42);
      if (frame !== lastFrame) {
        lastFrame = frame;
        setDisplayText(scrambledText(text, progress, frame));
      }
      if (progress < 1) animationFrame = window.requestAnimationFrame(tick);
      else {
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
      </span>
    </Heading>
  );
}
