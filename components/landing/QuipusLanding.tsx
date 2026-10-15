"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { QuipusMark } from "@/components/brand/QuipusMark";
import { useQuipusMotion } from "@/components/experience/QuipusExperience";
import { useDismissiblePanel } from "@/components/ui/useDismissiblePanel";
import { TabList } from "@/components/ui/TabList";
import { CITY_DESTINATIONS, type CityDestination, type ProductFeature } from "./city";
import { DeviceSimulation } from "./DeviceSimulation";
import { MenuButton, MenuLink } from "./MenuButton";
import styles from "./landing.module.css";
import cityBuildingLibrary from "@/public/landing/city-buildings.json";

const Scene = dynamic(() => import("./QuipusScene"), { ssr: false });
const navigationEvent = "quipus:city-navigation";
type InformationDestination = "about" | "privacy" | "terms";
function isInformationDestination(id: CityDestination): id is InformationDestination {
  return id === "about" || id === "privacy" || id === "terms";
}

function readDestination(): CityDestination | null {
  const hash = window.location.hash.slice(1);
  return CITY_DESTINATIONS.find(item => item.id === hash)?.id ?? null;
}
function subscribeNavigation(notify: () => void) {
  window.addEventListener("hashchange", notify);
  window.addEventListener("popstate", notify);
  window.addEventListener(navigationEvent, notify);
  return () => {
    window.removeEventListener("hashchange", notify);
    window.removeEventListener("popstate", notify);
    window.removeEventListener(navigationEvent, notify);
  };
}
const serverDestination = () => null;
function notifyNavigation() { window.dispatchEvent(new Event(navigationEvent)); }
function destinationUrl(id: CityDestination | null) {
  return window.location.pathname + window.location.search + (id ? "#" + id : "");
}
function chooseDestination(id: CityDestination) {
  const current = readDestination();
  if (current === id) return;
  if (current) window.history.replaceState(window.history.state, "", destinationUrl(id));
  else window.history.pushState({ ...window.history.state, quipusCityPanel: true }, "", destinationUrl(id));
  notifyNavigation();
}
function closeDestination() {
  if (!readDestination()) return;
  if (window.history.state?.quipusCityPanel) window.history.back();
  else {
    window.history.replaceState(window.history.state, "", destinationUrl(null));
    notifyNavigation();
  }
}

const descriptions: Record<CityDestination, string> = {
  device: "A small companion for real conversations. Keep the details that help you understand the person in front of you.",
  capture: "Give someone your attention. Keep their priorities and concerns close, even after the meeting ends.",
  understand: "See their goals, concerns and commitments clearly. Return to the original words whenever you need context.",
  "follow-up": "Continue with something useful. Review the next step, then approve a follow-up when you are ready.",
  history: "Remember the person behind each meeting. Bring their earlier priorities, questions and commitments into the next conversation.",
  about: "A simple idea: stay present without losing what matters.",
  privacy: "How the prototype handles the information you choose to share.",
  terms: "Consented conversations. Reviewed actions. Clear responsibilities.",
};
const featureDescriptions: Record<ProductFeature, { label: string; description: string }> = {
  microphone: { label: "Top microphone", description: "An open path to the built-in microphone keeps the conversation close." },
  screen: { label: "Touchscreen", description: "Start a session, check the connection and choose a meeting report." },
  speaker: { label: "Side speaker", description: "Hear prompts and spoken meeting reports from the side of the device." },
  storage: { label: "SD-card storage", description: "Keep complete recordings locally, then upload when saved Wi-Fi is available." },
  charging: { label: "USB-C", description: "Power and set up the current prototype through its USB-C connection." },
};

function CityPoster() {
  return <div className={styles.poster} aria-hidden="true">
    <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" fill="none">
      <defs><linearGradient id="city-poster-red" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#FE0000" /><stop offset="1" stopColor="#9B0000" /></linearGradient></defs>
      <path d="m480 480 500-285 580 320-500 300Z" fill="#ededed" />
      {Array.from({ length: 36 }, (_, i) => {
        const row = Math.floor(i / 6), column = i % 6;
        const x = 545 + column * 90 + row * 36, y = 455 + row * 44 - column * 31;
        const height = 30 + (i * 19 % 80);
        return <g key={i} opacity={0.45 + row * 0.065}>
          <path d={"m" + x + " " + y + " 46-26 40 23-46 27Z"} fill="#fff" />
          <path d={"m" + x + " " + y + " 40 24v" + height + "l-40-23Z"} fill="#d6d6d6" />
          <path d={"m" + (x + 40) + " " + (y + 24) + " 46-27v" + height + "l-46 27Z"} fill={i % 11 === 0 ? "url(#city-poster-red)" : "#eeeeee"} />
        </g>;
      })}
      <path d="m692 559 18-10 5 19Z" fill="#c40000" opacity=".7" />
      <path d="m1048 610 23-14-3 22Z" fill="#e52028" opacity=".6" />
      <path d="m1234 449 12-8 9 16Z" fill="#9b0000" opacity=".55" />
    </svg>
  </div>;
}

function DestinationPreview({ destination }: { destination: "capture" | "understand" | "follow-up" | "history" }) {
  const [reportTab, setReportTab] = useState<"points" | "transcript">("points");
  const [approved, setApproved] = useState(false);
  const [history, setHistory] = useState(0);
  if (destination === "capture") return <div className={styles.preview}>
    <div className={styles.previewHeading}><span>THE CONVERSATION, KEPT</span><small>Example</small></div>
    <div className={styles.recordingIdentity}><i aria-hidden="true" /><span>Client discovery<strong>Original audio, kept in full.</strong></span></div>
    <div className={styles.waveform} aria-hidden="true">{[18, 30, 21, 49, 37, 64, 42, 22, 51, 76, 38, 57, 28, 69, 46, 31, 60, 78, 48, 23, 54, 36, 66, 41, 29, 51, 70, 39].map((height, i) => <i key={i} style={{ height: height + "%", animationDelay: (i * -0.07) + "s" }} />)}</div>
    <ul className={styles.captureSteps}><li><strong>Record</strong><span>Stay present</span></li><li><strong>Save locally</strong><span>Keep the details</span></li><li><strong>Upload later</strong><span>Return to it</span></li></ul>
    <p className={styles.finePrint}>Transcripts and AI reports are prepared after upload.</p>
  </div>;
  if (destination === "understand") return <div className={styles.preview}>
    <div className={styles.previewHeading}><span>CLIENT DISCOVERY</span><small>Sample report</small></div>
    <TabList aria-label="Sample meeting report" value={reportTab} onValueChange={setReportTab} className={styles.reportTabs}
      tabs={[{ value: "points", label: "Key points", id: "sample-points-tab", panelId: "sample-points" }, { value: "transcript", label: "Transcript", id: "sample-transcript-tab", panelId: "sample-transcript" }]} />
    <div id="sample-points" role="tabpanel" aria-labelledby="sample-points-tab" hidden={reportTab !== "points"} tabIndex={0}>
      <ul className={styles.points}><li>Aisyah wants a pilot before a wider rollout.</li><li>Her main concern is onboarding the team.</li><li>You agreed to send a revised scope before the next review.</li></ul>
    </div>
    <div id="sample-transcript" role="tabpanel" aria-labelledby="sample-transcript-tab" hidden={reportTab !== "transcript"} tabIndex={0}>
      <div className={styles.transcript}><p><strong>You</strong>What would make this a good fit for your team?</p><p><strong>Aisyah</strong>Clear onboarding. We would like to begin with a pilot before committing.</p></div>
      <p className={styles.finePrint}>Illustrative transcript. Speaker labels can be corrected.</p>
    </div>
  </div>;
  if (destination === "follow-up") return <div className={styles.preview}>
    <div className={styles.previewHeading}><span>A THOUGHTFUL FOLLOW-UP</span><small>Interactive sample</small></div>
    <h3 className={styles.previewTitle}>Pilot scope review</h3>
    <dl className={styles.invitation}><div><dt>With</dt><dd>Aisyah Rahman</dd></div><div><dt>When</dt><dd>Tuesday &middot; 2:00 PM MYT</dd></div><div><dt>Where</dt><dd>Google Meet</dd></div></dl>
    {approved && <p className={styles.success} role="status"><span aria-hidden="true">&#10003;</span>Sample next step approved.</p>}
    <MenuButton tone={approved ? "light" : "red"} onClick={() => setApproved(!approved)}>{approved ? "Reset sample" : "Approve sample invitation"}</MenuButton>
    <p className={styles.finePrint}>Sample data. No invitation is sent.</p>
  </div>;
  const items = [
    { title: "First conversation", tag: "Priorities", detail: "Aisyah wants confidence before committing to a wider rollout. A small pilot gives her team a way to learn." },
    { title: "Requirements review", tag: "Concerns", detail: "Onboarding and unclear ownership concern her most. Keep the scope simple and give every follow-up an owner." },
    { title: "The next step", tag: "Commitments", detail: "You agreed to share the revised scope and include the operations lead. Revisit those commitments before reaching out." },
  ];
  return <div className={styles.preview}>
    <div className={styles.previewHeading}><span>AISYAH / CLIENT HISTORY</span><small>Sample</small></div>
    <div className={styles.historyList}>{items.map((item, index) => <MenuButton key={item.title} selected={history === index} aria-pressed={history === index} onClick={() => setHistory(index)} className={styles.historyButton}><strong>{item.title}</strong><small>{item.tag}</small></MenuButton>)}</div>
    <p className={styles.historyDetail} aria-live="polite">{items[history].detail}</p>
  </div>;
}

function InformationContent({ destination }: { destination: InformationDestination }) {
  if (destination === "about") return <div className={styles.information}>
    <p className={styles.projectBy}>A project by Nathan Hor</p>
    <p>The early touchscreen prototype helped test recording, voice prompts and uploads. The 3D view explores the enclosure design.</p>
    <p>The goal is a portable recorder and workspace that help you remember the person, the context and the commitments.</p>
    <details className={styles.prototypeDetails} data-city-credits>
      <summary>City model credits</summary>
      <p>Buildings by Fridqeir, adapted from &ldquo;{cityBuildingLibrary.source.title}&rdquo;. Models were selected, resized and recoloured for Quipus.</p>
      <div className={styles.creditActions}>
        <MenuLink href={cityBuildingLibrary.source.source} target="_blank" rel="noopener noreferrer">Original models</MenuLink>
        <MenuLink href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</MenuLink>
      </div>
    </details>
  </div>;
  if (destination === "privacy") return <>
    <ul className={styles.informationPoints}>
      <li><strong>Your workspace</strong><span>Account details, recordings, transcripts and meeting notes are used to run your workspace.</span></li>
      <li><strong>Connected services</strong><span>Service providers help process conversations. Recordings are kept in private storage with short-lived playback links.</span></li>
      <li><strong>Your choices</strong><span>Calendar access is optional. Revoke it in Google or request access, correction, export or deletion of your data.</span></li>
    </ul>
    <MenuLink href="/privacy" tone="navy" className={styles.panelAction}>Read the full privacy policy</MenuLink>
  </>;
  return <>
    <ul className={styles.informationPoints}>
      <li><strong>Ask first</strong><span>Tell participants before recording and obtain the consent required for your situation.</span></li>
      <li><strong>Review before acting</strong><span>Check transcripts, names, dates and invitation details before approving an action.</span></li>
      <li><strong>Keep a backup</strong><span>Quipus is an early prototype. Features may change or become unavailable; keep another copy of important recordings.</span></li>
    </ul>
    <MenuLink href="/terms" tone="navy" className={styles.panelAction}>Read the full terms</MenuLink>
  </>;
}

function CityPanel({ destination, feature, sceneUnavailable, onClose, onResetModel }: {
  destination: CityDestination; feature: ProductFeature; sceneUnavailable: boolean;
  onClose: () => void; onResetModel: () => void;
}) {
  const item = CITY_DESTINATIONS.find(value => value.id === destination)!;
  const detail = featureDescriptions[feature];
  const { panelRef, closePanel, onKeyDown } = useDismissiblePanel<HTMLElement>({ sessionKey: destination, onClose });
  return <section ref={panelRef} tabIndex={-1} onKeyDown={onKeyDown} className={styles.panel} aria-labelledby="city-panel-title" data-destination-panel={destination}>
    <div className={styles.panelControls}><MenuButton onClick={closePanel} className={styles.backButton}>Back to city</MenuButton><MenuButton onClick={closePanel} aria-label="Close section" className={styles.closeButton}><span aria-hidden="true">&#215;</span></MenuButton></div>
    <p className={styles.kicker}>EXPLORE QUIPUS</p>
    <h2 id="city-panel-title" className={styles.panelTitle}>{item.label}</h2>
    <p className={styles.panelDescription}>{descriptions[destination]}</p>
    {destination === "device" ? <>
      {sceneUnavailable ? <p className={styles.featureDescription}><strong>Built for the conversation</strong><span>A top microphone, touchscreen controls and a side speaker. SD-card storage keeps recordings; USB-C powers the prototype.</span></p>
        : <p className={styles.featureDescription} role="status" aria-atomic="true"><strong>{detail.label}</strong><span>{detail.description}</span></p>}
      {!sceneUnavailable && <div className={styles.modelControls}><MenuButton onClick={onResetModel}>Reset model</MenuButton></div>}
      <details className={styles.prototypeDetails}><summary>Where it started</summary><p>A simple idea: stay present without losing what matters. Our early touchscreen prototype helped us test recording, voice prompts and uploading. The 3D model shows the enclosure design; this photo shows the earlier hardware.</p><Image src="/landing/prototype-in-use.webp" alt="The early Quipus touchscreen prototype alongside its battery and speaker" width={1200} height={675} sizes="(max-width: 680px) 90vw, 350px" /></details>
      <details className={styles.demoDetails}><summary>Try a sample session</summary><DeviceSimulation /></details>
    </> : isInformationDestination(destination) ? <InformationContent destination={destination} /> : <><DestinationPreview destination={destination} /><MenuLink href={"/demo?view=" + (destination === "follow-up" ? "calendar" : destination === "capture" ? "overview" : "conversations")} tone="navy" className={styles.panelAction}>Explore the sample workspace</MenuLink></>}
  </section>;
}

export default function QuipusLanding() {
  const { enabled, setScene } = useQuipusMotion();
  const destination = useSyncExternalStore(subscribeNavigation, readDestination, serverDestination);
  const overviewButton = useRef<HTMLButtonElement>(null);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const destinationMenu = useRef<HTMLDivElement>(null);
  const previousDestination = useRef(destination);
  const [feature, setFeature] = useState<ProductFeature>("microphone");
  const [sceneStatus, setSceneStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetSequence, setResetSequence] = useState(0);
  const [rotationCommand, setRotationCommand] = useState<{ direction: "reset"; sequence: number }>();
  const select = useCallback((id: CityDestination) => { setMenuOpen(false); chooseDestination(id); }, []);
  const ready = useCallback(() => setSceneStatus("ready"), []);
  const unavailable = useCallback(() => setSceneStatus("unavailable"), []);
  const resetModel = () => setRotationCommand(previous => ({ direction: "reset", sequence: (previous?.sequence ?? 0) + 1 }));
  const focusCityControls = useCallback(() => {
    const opener = menuToggle.current;
    (opener?.getClientRects().length ? opener : overviewButton.current)?.focus({ preventScroll: true });
  }, []);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    focusCityControls();
  }, [focusCityControls]);
  const reset = () => {
    if (readDestination()) {
      window.history.replaceState({ ...window.history.state, quipusCityPanel: false }, "", destinationUrl(null));
      notifyNavigation();
    }
    setMenuOpen(false);
    setResetSequence(value => value + 1);
  };
  useEffect(() => { setScene("landing"); return () => setScene("overview"); }, [setScene]);
  useEffect(() => {
    if (previousDestination.current && !destination) {
      const active = document.activeElement;
      if (active === document.body || active === document.documentElement || active?.closest("[data-destination-panel]")) {
        focusCityControls();
      }
    }
    previousDestination.current = destination;
  }, [destination, focusCityControls]);
  useEffect(() => {
    if (menuOpen) destinationMenu.current?.querySelector<HTMLButtonElement>("[data-city-destination]")?.focus({ preventScroll: true });
  }, [menuOpen]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Embedded panels own Escape. React and native listeners can share document.
      if (event.target instanceof Element && event.target.closest("[data-destination-panel]")) return;
      if (menuOpen) closeMenu();
      else if (destination) closeDestination();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [closeMenu, destination, menuOpen]);

  return <main className={styles.landing} data-motion={enabled ? "on" : "off"} data-city-section={destination ?? "overview"} data-scene-status={sceneStatus}>
    <a href="#city-content" className={styles.skipLink} onClick={event => {
      event.preventDefault();
      document.getElementById("city-content")?.focus({ preventScroll: true });
    }}>Skip to product information</a>
    <div className={styles.stage}><CityPoster /><Scene destination={destination} onDestinationChange={select} reducedMotion={!enabled} feature={feature} onFeatureChange={setFeature} resetSequence={resetSequence} rotationCommand={rotationCommand} onReady={ready} onUnavailable={unavailable} /></div>
    <div className={styles.readingVeil} aria-hidden="true" />
    <button ref={overviewButton} type="button" className={styles.brand} onClick={reset} aria-label="Quipus city overview"><QuipusMark /><Image src="/quipus-wordmark.png" alt="Quipus" width={780} height={194} priority /></button>
    <MenuLink href="/login?next=/dashboard" tone="navy" className={styles.signIn}>Sign in</MenuLink>
    <MenuButton ref={menuToggle} className={styles.menuToggle} aria-controls="city-destinations" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>Explore city</MenuButton>

    {!destination && <div className={styles.homePanel} id="city-content" tabIndex={-1}>
      <section aria-labelledby="city-title" data-city-introduction>
        <h1 id="city-title" className={styles.title}><span>Be present.</span><span>Know what</span><em>matters.</em></h1>
        <p className={styles.description}>Record conversations. Understand the person.<br className={styles.desktopBreak} /> Follow up with context.</p>
        <div className={styles.heroActions}><MenuLink href="/demo" tone="red">Try the sample</MenuLink></div>
        <p className={styles.companion}>With you, wherever business takes you.</p>
      </section>
    </div>}
    <div ref={destinationMenu} className={styles.destinations} id="city-destinations" data-open={menuOpen} role="group" aria-label="Explore Quipus sections">
      <div className={styles.menuControls}><MenuButton className={styles.menuClose} aria-label="Close destinations" onClick={closeMenu}>Close</MenuButton></div>
      {CITY_DESTINATIONS.map(item => <MenuButton key={item.id} data-city-destination={item.id} onClick={() => select(item.id)} className={styles.destinationButton}>{item.label}</MenuButton>)}
    </div>
    {destination && <div id="city-content" tabIndex={-1}><CityPanel key={destination} destination={destination} feature={feature} sceneUnavailable={sceneStatus === "unavailable"} onClose={closeDestination} onResetModel={resetModel} /></div>}

  </main>;
}
