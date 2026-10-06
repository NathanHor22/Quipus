"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import type { Meeting } from "@/lib/types";
import {
  activeTranscriptIndex,
  clampPlaybackTime,
  formatAudioTime,
} from "@/lib/workspace/playback";
import styles from "./replay.module.css";
import { recordingDurationLabel } from "@/lib/workspace/recording-progress";

export interface PlaybackProgress {
  position: number;
  speed: number;
}

export type ConversationReplayView = "all" | "audio" | "transcript" | "hidden";
type ReplayPanel = { id: string; labelledBy: string };

/** Only plays captured audio. Transcript imports never become synthetic audio. */
export function ConversationReplay({
  conversation,
  initialProgress,
  onProgress,
  view = "all",
  panels,
}: {
  conversation: Meeting;
  initialProgress?: PlaybackProgress;
  onProgress: (progress: PlaybackProgress) => void;
  view?: ConversationReplayView;
  panels?: { audio: ReplayPanel; transcript: ReplayPanel };
}) {
  const sample = conversation.id.startsWith("sample:");
  const recordingId = !sample ? conversation.recordingId : null;
  const [source, setSource] = useState({
    url: !sample ? conversation.recordingUrl || null : null,
    revision: 0,
  });
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(initialProgress?.position || 0);
  const [duration, setDuration] = useState<number>();
  const [speed, setSpeed] = useState(initialProgress?.speed || 1);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const pendingPosition = useRef(initialProgress?.position || 0);
  const progress = useRef({
    position: initialProgress?.position || 0,
    speed: initialProgress?.speed || 1,
  });
  const saveProgress = useRef(onProgress);
  const request = useRef<AbortController | null>(null);
  const activeLine = useRef<HTMLElement>(null);
  const transcript = conversation.transcript || [];
  const speakerTones = useMemo(() => {
    const tones = new Map<string, number>();
    for (const segment of transcript) {
      const speaker = segment.speaker.trim();
      if (speaker && !tones.has(speaker)) tones.set(speaker, tones.size + 1);
    }
    return tones;
  }, [transcript]);
  const activeIndex = ready ? activeTranscriptIndex(transcript, position) : -1;
  const normalizedSearch = search.trim().toLowerCase();
  const visibleSegments = useMemo(
    () =>
      transcript
        .map((segment, index) => ({ segment, index }))
        .filter(({ segment }) =>
          `${segment.speaker} ${segment.text}`
            .toLowerCase()
            .includes(normalizedSearch),
        ),
    [transcript, normalizedSearch],
  );

  const refreshAudio = useCallback(async () => {
    if (!recordingId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    pendingPosition.current = progress.current.position;
    audio.current?.pause();
    setLoading(true);
    setReady(false);
    setError(null);
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(
        `/api/recordings/${encodeURIComponent(recordingId)}/playback`,
        { cache: "no-store", signal: controller.signal },
      );
      const payload = await response.json();
      if (!response.ok || typeof payload.url !== "string")
        throw new Error(payload.error || "The recording could not be opened.");
      const url = new URL(payload.url);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("The recording could not be opened.");
      if (request.current !== controller) return;
      setSource((current) => ({
        url: url.href,
        revision: current.revision + 1,
      }));
    } catch (cause) {
      if (request.current !== controller) return;
      setError(
        controller.signal.aborted
          ? "The recording took too long to load. Please retry."
          : cause instanceof Error
            ? cause.message
            : "The recording could not be opened.",
      );
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }, [recordingId]);

  useEffect(() => {
    if (!conversation.recordingUrl && recordingId) void refreshAudio();
    return () => {
      const current = request.current;
      request.current = null;
      current?.abort();
    };
  }, [conversation.recordingUrl, recordingId, refreshAudio]);

  useEffect(() => {
    const player = audio.current;
    // React's development effect replay can clean up without removing the DOM.
    if (player && source.url && player.getAttribute("src") !== source.url) {
      player.src = source.url;
      player.load();
    }
    return () => {
      // Removing the panel also stops playback and releases the media download.
      saveProgress.current({ ...progress.current });
      player?.pause();
      player?.removeAttribute("src");
      player?.load();
    };
  }, [source.url, source.revision]);

  const seek = (seconds: number) => {
    const player = audio.current;
    if (!player || !ready) return false;
    try {
      player.currentTime = clampPlaybackTime(seconds, player.duration);
      pendingPosition.current = 0;
      setPosition(player.currentTime);
      progress.current.position = player.currentTime;
      setError(null);
      return true;
    } catch {
      setError(
        "This part of the recording is not ready yet. Try playing the audio first.",
      );
      return false;
    }
  };

  const jumpToLine = (seconds: number) => {
    if (!seek(seconds)) return;
    const player = audio.current;
    if (player && ready)
      void player
        .play()
        .catch(() =>
          setError("Press Play on the recording to continue listening."),
        );
  };

  const togglePlayback = () => {
    const player = audio.current;
    if (!player || !ready) return;
    if (!player.paused) player.pause();
    else void player.play().catch(() => setError("The recording could not start. Please try again."));
  };

  useEffect(() => {
    if (view === "hidden") audio.current?.pause();
  }, [view]);

  const restorePosition = (player: HTMLAudioElement) => {
    player.playbackRate = progress.current.speed;
    if (pendingPosition.current <= 0) return;
    try {
      player.currentTime = clampPlaybackTime(
        pendingPosition.current,
        player.duration,
      );
      progress.current.position = player.currentTime;
      setPosition(player.currentTime);
      pendingPosition.current = 0;
    } catch {
      /* Keep the target until the browser can seek into the recording. */
    }
  };

  const jumpToCurrent = () => {
    if (normalizedSearch) setSearch("");
    window.requestAnimationFrame(() =>
      activeLine.current?.scrollIntoView({
        block: "nearest",
        behavior: "auto",
      }),
    );
  };

  return (
    <section className={styles.replay} aria-label="Conversation replay" hidden={view === "hidden"}>
      <div
        className={styles.playerCard}
        role={panels ? "tabpanel" : undefined}
        id={panels?.audio.id}
        aria-labelledby={panels?.audio.labelledBy}
        tabIndex={panels ? 0 : undefined}
        hidden={view === "transcript" || view === "hidden"}
      >
        <header className={styles.playerHeader}>
          <div>
            <span className={styles.eyebrow}>ORIGINAL RECORDING</span>
            <h3>Original audio</h3>
            <p>{conversation.title}</p>
            <p className={styles.duration}>Duration · {recordingDurationLabel(conversation)}</p>
          </div>
        </header>
        <p className={styles.intro}>
          Listen to the original recording and revisit the details.
        </p>
        {source.url && (
          <>
            <audio
              key={`${source.url}:${source.revision}`}
              ref={audio}
              controls
              preload="metadata"
              src={source.url}
              className={styles.audio}
              aria-label={`Original recording of ${conversation.title}`}
              onLoadedMetadata={(event) => {
                const player = event.currentTarget;
                restorePosition(player);
                setDuration(
                  Number.isFinite(player.duration) && player.duration > 0
                    ? player.duration
                    : undefined,
                );
                setReady(true);
                setError(null);
              }}
              onDurationChange={(event) => {
                const value = event.currentTarget.duration;
                setDuration(
                  Number.isFinite(value) && value > 0 ? value : undefined,
                );
              }}
              onCanPlay={(event) => restorePosition(event.currentTarget)}
              onTimeUpdate={(event) => {
                if (pendingPosition.current > 0) return;
                progress.current.position = event.currentTarget.currentTime;
                setPosition(event.currentTarget.currentTime);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => {
                setReady(false);
                setPlaying(false);
                setError(
                  "The recording could not be played. Its link may have expired, or the audio may be unavailable.",
                );
              }}
            >
              Your browser does not support audio playback.
            </audio>
            <div className={styles.controls}>
              <div className={styles.skipControls}>
                <button
                  type="button"
                  disabled={!ready || loading}
                  onClick={() => seek(position - 15)}
                  aria-label="Back 15 seconds"
                >
                  <RotateCcw />
                  <span>15s</span>
                </button>
                <button
                  type="button"
                  disabled={!ready || loading}
                  onClick={() => seek(position + 15)}
                  aria-label="Forward 15 seconds"
                >
                  <RotateCw />
                  <span>15s</span>
                </button>
              </div>
              <label className={styles.speed}>
                Speed
                <select
                  aria-label="Playback speed"
                  value={speed}
                  disabled={!ready || loading}
                  onChange={(event) => {
                    const rate = Number(event.target.value);
                    setSpeed(rate);
                    progress.current.speed = rate;
                    if (audio.current) audio.current.playbackRate = rate;
                  }}
                >
                  {[0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}×
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className={styles.playbackStatus}>
              {playing ? "Listening" : "Paused"} at {formatAudioTime(position)}
              {duration ? ` of ${formatAudioTime(duration)}` : ""}
            </p>
          </>
        )}
        {loading && (
          <p className={styles.loading} role="status">
            <LoaderCircle />
            Opening your recording…
          </p>
        )}
        {!source.url && !recordingId && (
          <div className={styles.noAudio}>
            <strong>
              {sample
                ? "This sample has no audio recording"
                : "No original audio was saved"}
            </strong>
            <p>
              {sample
                ? "You can explore the transcript excerpts. Add a recording in your live workspace to try playback."
                : "Any saved transcript remains available. Playback needs the original recording from this conversation."}
            </p>
          </div>
        )}
        {error && (
          <div className={styles.error} role="alert">
            <p>{error}</p>
            {recordingId && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void refreshAudio()}
              >
                <RotateCcw />
                Reload recording
              </button>
            )}
          </div>
        )}
      </div>

      <div
        className={styles.transcriptSection}
        role={panels ? "tabpanel" : undefined}
        id={panels?.transcript.id}
        aria-labelledby={panels?.transcript.labelledBy}
        tabIndex={panels ? 0 : undefined}
        hidden={view === "audio" || view === "hidden"}
      >
        {view === "transcript" && error && (
          <div className={styles.error} role="alert">
            <p>{error}</p>
            {recordingId && <button type="button" disabled={loading} onClick={() => void refreshAudio()}><RotateCcw /> Reload recording</button>}
          </div>
        )}
        <div className={styles.transcriptHeader}>
          <div>
            <h3>Transcript</h3>
            <p>
              {source.url
                ? `${speakerTones.size} speaker${speakerTones.size === 1 ? "" : "s"} detected · Select a timestamp to listen from that point.`
                : "The original transcript, in the words captured."}
            </p>
          </div>
          {view === "transcript" && source.url && (
            <button type="button" disabled={!ready || loading} onClick={togglePlayback} aria-label={playing ? "Pause recording" : "Play recording"}>
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              {playing ? "Pause" : "Play"} · {formatAudioTime(position)}
            </button>
          )}
          {activeIndex >= 0 && (
            <button type="button" onClick={jumpToCurrent}>
              Current line
            </button>
          )}
        </div>
        {transcript.length > 0 && (
          <label className={styles.search}>
            <input
              aria-label="Search transcript"
              placeholder="Find a name, phrase, or detail"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                aria-label="Clear transcript search"
                onClick={() => setSearch("")}
              >
                <X aria-hidden="true" />
              </button>
            )}
          </label>
        )}
        <div className={styles.transcript}>
          {visibleSegments.map(({ segment, index }) => {
            const timed =
              segment.startSeconds !== undefined &&
              Number.isFinite(segment.startSeconds) &&
              segment.startSeconds >= 0;
            const active = index === activeIndex;
            return (
              <article
                key={segment.id || index}
                ref={active ? activeLine : undefined}
                className={active ? styles.activeLine : undefined}
                data-speaker-tone={Math.min(speakerTones.get(segment.speaker.trim()) || 1, 4)}
                aria-current={active ? "true" : undefined}
              >
                <header>
                  <strong>{segment.speaker}</strong>
                  {timed &&
                    (source.url ? (
                      <button
                        type="button"
                        className={styles.timestamp}
                        disabled={!ready || loading}
                        onClick={() => jumpToLine(segment.startSeconds!)}
                        aria-label={`Listen to ${segment.speaker} at ${formatAudioTime(segment.startSeconds!)}`}
                      >
                        {formatAudioTime(segment.startSeconds!)}
                      </button>
                    ) : (
                      <span className={styles.timestampLabel}>
                        {formatAudioTime(segment.startSeconds!)}
                      </span>
                    ))}
                </header>
                <p>{segment.text}</p>
              </article>
            );
          })}
          {!visibleSegments.length && (
            <p className={styles.empty}>
              {normalizedSearch
                ? "No matching words. Try another name or phrase."
                : "There is no transcript for this conversation yet."}
            </p>
          )}
        </div>
        <p className={styles.transcriptNote}>
          The transcript may contain mistakes. The original audio is your
          reference.
        </p>
      </div>
    </section>
  );
}
