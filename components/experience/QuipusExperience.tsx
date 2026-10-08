"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
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
const MotionContext = createContext<MotionContext | null>(null);
type SceneStyle = CSSProperties & { "--scene-x": string; "--scene-y": string };

/** Architectural depth stays at the edges so reports remain quiet and readable. */
function ArchitectureBackdrop({ active, scene }: { active: boolean; scene: string }) {
  const backdrop = useRef<HTMLDivElement>(null);
  const gradientId = useId();
  const scenes = ["overview", "conversations", "calendar", "people", "device", "settings"];
  const position = Math.max(0, scenes.indexOf(scene));
  const sceneStyle: SceneStyle = {
    "--scene-x": position * -5 + "px",
    "--scene-y": (position % 2 === 0 ? 0 : 8) + "px",
  };

  useEffect(() => {
    const element = backdrop.current;
    if (!active || !element) return;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let animationFrame = 0;
    let targetX = 0;
    let targetY = 0;
    const update = () => {
      animationFrame = 0;
      element.style.setProperty("--pointer-x", `${targetX.toFixed(2)}px`);
      element.style.setProperty("--pointer-y", `${targetY.toFixed(2)}px`);
    };
    const reset = () => {
      targetX = 0;
      targetY = 0;
      if (!animationFrame) animationFrame = window.requestAnimationFrame(update);
    };
    const onMove = (event: PointerEvent) => {
      if (!finePointer.matches || event.pointerType === "touch") return;
      targetX = (event.clientX / Math.max(1, window.innerWidth) - .5) * 16;
      targetY = (event.clientY / Math.max(1, window.innerHeight) - .5) * 10;
      if (!animationFrame) animationFrame = window.requestAnimationFrame(update);
    };
    const onExit = (event: PointerEvent) => { if (event.relatedTarget === null) reset(); };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerout", onExit, { passive: true });
    window.addEventListener("blur", reset);
    finePointer.addEventListener("change", reset);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onExit);
      window.removeEventListener("blur", reset);
      finePointer.removeEventListener("change", reset);
      element.style.setProperty("--pointer-x", "0px");
      element.style.setProperty("--pointer-y", "0px");
    };
  }, [active]);

  return (
    <div ref={backdrop} className={styles.backdrop} aria-hidden="true" data-active={active} style={sceneStyle}>
      <div className={styles.architecturalField}>
        <svg className={styles.architecture} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" fill="none" focusable="false">
          <defs>
            <linearGradient id={`${gradientId}-crimson`} x1="1320" y1="0" x2="1600" y2="760" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FE0000" stopOpacity=".68" />
              <stop offset=".56" stopColor="#C40000" stopOpacity=".78" />
              <stop offset="1" stopColor="#9B0000" stopOpacity=".83" />
            </linearGradient>
            <linearGradient id={`${gradientId}-paper`} x1="950" y1="-80" x2="1400" y2="300" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFFFFF" /><stop offset="1" stopColor="#E8ECF1" />
            </linearGradient>
          </defs>
          <g className={styles.upperPlanes}>
            <path d="M920-100h760v210l-218 131H920Z" fill="#DFE5EC" fillOpacity=".64" />
            <path d="M920-120h760v210l-218 131H920Z" fill={`url(#${gradientId}-paper)`} />
            <path d="m1462 221 218-131v20l-218 131Z" fill="#D5DCE6" />
            <path d="M1090-115h495v150l-139 81h-356Z" fill="#FFF" fillOpacity=".9" />
            <path d="m1446 116 139-81v13l-139 81Z" fill="#E2E7EE" />
            <path d="M920 221h370m-310-23h311m-200-18h131" stroke="#CAD2DD" strokeOpacity=".36" />
          </g>
          <g className={styles.lowerPlanes}>
            <path d="M-180 725h465l222 142v185H-180Z" fill="#DDE4EC" fillOpacity=".56" />
            <path d="M-180 704h465l222 142v185H-180Z" fill="#FDFEFF" />
            <path d="m285 704 222 142v21L285 725Z" fill="#DCE3EC" />
            <path d="M-100 810h264l128 80v156H-100Z" fill="#FFF" />
            <path d="m164 810 128 80v13l-128-80Z" fill="#E4E9F0" />
            <path d="M-160 704h390m-330 18h230" stroke="#D1D9E3" strokeOpacity=".48" />
          </g>
          <g className={styles.redPosition}>
            <g className={styles.redPlanes}>
              <path d="m1519-145 203 16-202 325 125 281-70 42-151-325Z" fill="#C4CCD8" fillOpacity=".2" transform="translate(16 16)" />
              <path d="m1498-145 203 16-202 325 125 281-70 42-151-325Z" fill={`url(#${gradientId}-crimson)`} />
              <path d="m1499 196 125 281-70 42-13-28 48-27-121-267Z" fill="#9B0000" fillOpacity=".58" />
              <path d="m1498-145 203 16-26 20-175-12-196 326-1-11Z" fill="#FF8989" fillOpacity=".48" />
              <path d="m1552-105 186 32-157 276 127 222-34 19-142-242Z" fill="#D53842" fillOpacity=".26" />
              <g className={styles.contourLines} stroke="#790C21" strokeOpacity=".18">
                <path d="m1530-50-95 190 109 248m18-408-93 179 109 248m18-408-92 179 109 248m18-408-93 179 110 248" />
                <path d="m1540-20-91 165 85 191m28-339-85 164 88 192" />
              </g>
            </g>
          </g>
          <g stroke="#D1636B" strokeWidth="1" strokeOpacity=".34">
            <path className={styles.connectionOne} d="m1320 65 68 66 71-45 77 61" />
            <path className={styles.connectionTwo} d="m119 680 81 44 101-35 77 59" />
            <path className={styles.connectionThree} d="m1363 799 47-64 85 27 99-88" />
          </g>
          <g>
            <g className={`${styles.fragment} ${styles.fragmentOne}`}><path d="m1305 54 43 15-34 15Z" fill="#C40000" fillOpacity=".68" /><path d="m1314 84 34-15-21 27Z" fill="#9B0000" fillOpacity=".78" /></g>
            <g className={`${styles.fragment} ${styles.fragmentTwo}`}><path d="m1448 611 42 20-31 17Z" fill="#FE0000" fillOpacity=".71" /><path d="m1459 648 31-17-13 31Z" fill="#B1202F" fillOpacity=".78" /></g>
            <g className={`${styles.fragment} ${styles.fragmentThree}`}><path d="m1397 777 39-21-8 44Z" fill="#C40000" fillOpacity=".44" /><path d="m1428 800 8-44 13 25Z" fill="#DE656C" fillOpacity=".56" /></g>
            <g className={`${styles.fragment} ${styles.fragmentFour}`}><path d="m167 702 34 19-39 11Z" fill="#C40000" fillOpacity=".44" /><path d="m162 732 39-11-19 24Z" fill="#9B0000" fillOpacity=".6" /></g>
            <g className={`${styles.fragment} ${styles.fragmentFive}`}><path d="m75 842 28-17 4 35Z" fill="#DD6971" fillOpacity=".65" /><path d="m107 860-4-35 12 17Z" fill="#B21B2E" fillOpacity=".68" /></g>
            <g className={`${styles.fragment} ${styles.fragmentSix}`}><path d="m1518 902 30-18-2 37Z" fill="#9B0000" fillOpacity=".56" /><path d="m1546 921 2-37 11 20Z" fill="#E24F5A" fillOpacity=".62" /></g>
          </g>
        </svg>
        <svg className={styles.mobileArchitecture} viewBox="0 0 390 900" preserveAspectRatio="xMaxYMin slice" fill="none" focusable="false">
          <g className={styles.upperPlanes}>
            <path d="M256-70h195v160l-68 40H256Z" fill="#E1E7EF" /><path d="M256-82h195V78l-68 40H256Z" fill="#FCFDFF" />
            <path d="M293-70h134v88l-42 25h-92Z" fill="#FFF" /><path d="m385 43 42-25v10l-42 25Z" fill="#E0E6EF" />
          </g>
          <g className={styles.lowerPlanes}>
            <path d="M-90 757H29l97 57v150H-90Z" fill="#DCE3EC" /><path d="M-90 742H29l97 57v150H-90Z" fill="#FBFCFE" />
          </g>
          <g className={styles.redPosition}><g className={styles.redPlanes}>
            <path d="m377-89 73 9-68 189 47 102-27 16-55-121Z" fill="#C40000" fillOpacity=".71" />
            <path d="m382 109 47 102-27 16-6-14 17-10-45-92Z" fill="#9B0000" fillOpacity=".64" />
            <path d="m377-89 73 9-12 9-60-4-63 181-8-1Z" fill="#FF7979" fillOpacity=".5" />
            <path className={styles.contourLines} d="m385-40-45 148 42 93m10-227-43 136 39 91" stroke="#790C21" strokeOpacity=".22" />
          </g></g>
          <path className={styles.connectionOne} d="m20 739 43 30 26-18 39 41" stroke="#D1636B" strokeOpacity=".32" />
          <g className={`${styles.fragment} ${styles.fragmentOne}`}><path d="m307 68 24 8-18 11Z" fill="#C40000" fillOpacity=".58" /><path d="m313 87 18-11-8 20Z" fill="#9B0000" fillOpacity=".68" /></g>
          <g className={`${styles.fragment} ${styles.fragmentFour}`}><path d="m17 758 25 15-29 7Z" fill="#D6535E" fillOpacity=".62" /><path d="m13 780 29-7-14 18Z" fill="#9B0000" fillOpacity=".54" /></g>
        </svg>
      </div>
      <div className={styles.readingWash} />
    </div>
  );
}

export function QuipusExperience({ children }: { children: ReactNode }) {
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
    setReady(true);
    media.addEventListener("change", updateMedia);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      media.removeEventListener("change", updateMedia);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  const enabled = ready && !reducedMotion;
  // Preserve the context contract for existing consumers; the OS now owns this preference.
  const setPreference = useCallback((_next: QuipusMotionPreference) => {}, []);
  const toggle = useCallback(() => {}, []);
  const setScene = useCallback((next: string) => setSceneState((previous) => previous === next ? previous : next), []);
  const value = useMemo<MotionContext>(
    () => ({ enabled, preference: "system", setPreference, toggle, setScene, ready, visible }),
    [enabled, setPreference, toggle, setScene, ready, visible],
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

/** Only a narrow band scrambles; the accessible text always remains final. */
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
  // Text changes from polling/profile loading do not restart a page entrance.
  const identity = replayKey === undefined ? "initial" : `page:${replayKey}`;

  useEffect(() => {
    if (!ready) return;
    if (!enabled || !visible || revealedIdentity.current === identity) {
      revealedIdentity.current = identity;
      setRevealing(false);
      setDisplayText(text);
      return;
    }
    revealedIdentity.current = identity;
    setRevealing(true);
    setDisplayText(text);
    let animationFrame = 0;
    let start: number | null = null;
    let lastFrame = -1;
    const duration = 220;
    const tick = (time: number) => {
      start ??= time;
      const elapsed = time - start;
      const progress = Math.min(1, elapsed / duration);
      const frame = Math.floor(elapsed / 36);
      if (frame !== lastFrame) {
        lastFrame = frame;
        setDisplayText(scrambledText(text, progress, frame));
      }
      if (progress < 1) animationFrame = window.requestAnimationFrame(tick);
      else {
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
