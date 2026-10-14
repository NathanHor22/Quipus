"use client";

import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

interface AudioPlayerProps { src?: string | null; }

function time(value: number) {
  if (!Number.isFinite(value)) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function AudioPlayer({ src }: AudioPlayerProps) {
  const [speed, setSpeed] = useState(1);
  return <AudioPlayback key={src ?? ""} src={src} speed={speed} onSpeedChange={setSpeed} />;
}

function AudioPlayback({ src, speed, onSpeedChange }: AudioPlayerProps & {
  speed: number;
  onSpeedChange: (speed: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (audio.paused) await audio.play(); else audio.pause();
  };

  const cycleSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    onSpeedChange(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  return (
    <div className={`audio-player${src ? "" : " is-disabled"}`}>
      {src ? <audio ref={audioRef} src={src} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { event.currentTarget.playbackRate = speed; setDuration(event.currentTarget.duration); }} onEnded={() => setPlaying(false)} /> : null}
      <button type="button" className="audio-player__play" onClick={toggle} disabled={!src} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause /> : <Play />}</button>
      <input type="range" min={0} max={duration || 1} step={0.1} value={current} disabled={!src} aria-label="Audio position" onChange={(event) => { const next = Number(event.target.value); setCurrent(next); if (audioRef.current) audioRef.current.currentTime = next; }} />
      <span className="audio-player__time">{time(current)} / {time(duration)}</span>
      <button type="button" className="audio-player__speed" onClick={cycleSpeed} disabled={!src}>{speed}×</button>
    </div>
  );
}
