"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { Meeting, TranscriptSegment } from "@/lib/types";
import {
  activeTranscriptIndex,
  clampPlaybackTime,
  formatAudioTime,
} from "@/lib/workspace/playback";
import styles from "./replay.module.css";
import { playbackRenewalDelay } from "@/lib/workspace/playback-expiry";
import { recordingDurationLabel } from "@/lib/workspace/recording-progress";
import {
  playbackSources,
  playbackSourceLabels,
  readPlaybackSources,
  type PlaybackSource,
} from "@/lib/workspace/playback-sources";

export interface PlaybackProgress {
  position: number;
  speed: number;
}

export type ConversationReplayView = "all" | "audio" | "transcript" | "hidden";
type ReplayPanel = { id: string; labelledBy: string };

type ReplayProps = {
  conversation: Meeting;
  initialProgress?: PlaybackProgress;
  onProgress?: (progress: PlaybackProgress) => void;
  view?: ConversationReplayView;
  panels?: { audio: ReplayPanel; transcript: ReplayPanel };
};

type SourceControls = {
  selectedSource: PlaybackSource;
  availableSources: PlaybackSource[];
  onSourceChange: (source: PlaybackSource) => void;
  onSourcesResolved: (sources: PlaybackSource[]) => void;
};

type AudioResolution = {
  source: PlaybackSource;
  recordingId: string;
  providedUrl: string | null;
  attempt: number;
  url: string | null;
  expiresAt: string | null;
  error: string | null;
};

type MediaSnapshot = {
  key: string;
  ready: boolean;
  playing: boolean;
  duration: number | undefined;
  error: string | null;
};

const emptyTranscript: TranscriptSegment[] = [];
const emptyMedia: MediaSnapshot = {
  key: "",
  ready: false,
  playing: false,
  duration: undefined,
  error: null,
};

/** Only plays captured audio. Transcript imports never become synthetic audio. */
export function ConversationReplay(props: ReplayProps) {
  return (
    <ConversationReplaySources
      key={JSON.stringify([props.conversation.id, props.conversation.recordingId ?? null])}
      {...props}
    />
  );
}

function ConversationReplaySources(props: ReplayProps) {
  const [selectedSource, setSelectedSource] = useState<PlaybackSource>("combined");
  const [availableSources, setAvailableSources] = useState<PlaybackSource[]>([]);
  const receiveSources = useCallback(
    (sources: PlaybackSource[]) => setAvailableSources(sources),
    [],
  );
  const [savedProgress, setSavedProgress] = useState<
    Partial<Record<PlaybackSource, PlaybackProgress>>
  >({});
  const { onProgress } = props;
  // Transcript-only playback always uses the consolidated timeline.
  const effectiveSource = props.view === "transcript" ? "combined" : selectedSource;
  const saveProgress = useCallback(
    (value: PlaybackProgress) => {
      setSavedProgress((current) => ({ ...current, [effectiveSource]: value }));
      if (effectiveSource === "combined") onProgress?.(value);
    },
    [effectiveSource, onProgress],
  );
  return (
    <ConversationReplaySession
      key={effectiveSource}
      {...props}
      initialProgress={
        savedProgress[effectiveSource] ??
        (effectiveSource === "combined" ? props.initialProgress : undefined)
      }
      onProgress={saveProgress}
      selectedSource={effectiveSource}
      availableSources={availableSources}
      onSourceChange={setSelectedSource}
      onSourcesResolved={receiveSources}
    />
  );
}

function ConversationReplaySession({
  conversation,
  initialProgress,
  onProgress,
  view = "all",
  panels,
  selectedSource,
  availableSources,
  onSourceChange,
  onSourcesResolved,
}: ReplayProps & SourceControls) {
  const sample = conversation.id.startsWith("sample:");
  const recordingId = !sample ? conversation.recordingId : null;
  const providedUrl =
    !sample && selectedSource === "combined" ? conversation.recordingUrl || null : null;
  const [refreshRequest, setRefreshRequest] = useState({ providedUrl, attempt: 0 });
  const attempt = refreshRequest.providedUrl === providedUrl ? refreshRequest.attempt : 0;
  const [resolution, setResolution] = useState<AudioResolution | null>(null);
  const settled =
    resolution !== null &&
    resolution.recordingId === recordingId &&
    resolution.providedUrl === providedUrl &&
    resolution.attempt === attempt;
  const source = {
    url: settled ? resolution.url : providedUrl,
    revision: settled ? resolution.attempt : 0,
  };
  const sourceKey = JSON.stringify([source.url, source.revision]);
  const visible = view !== "hidden";
  const needsUrl = Boolean(recordingId && (!providedUrl || attempt > 0));
  const loading = visible && needsUrl && !settled;
  const [media, setMedia] = useState<MediaSnapshot>(emptyMedia);
  const currentMedia = media.key === sourceKey ? media : emptyMedia;
  const { ready, playing, duration } = currentMedia;
  const error = currentMedia.error || (settled ? resolution.error : null);
  const [position, setPosition] = useState(initialProgress?.position || 0);
  const [speed, setSpeed] = useState(initialProgress?.speed || 1);
  const [search, setSearch] = useState("");
  const updateMedia = (changes: Partial<Omit<MediaSnapshot, "key">>) => {
    setMedia((current) => ({
      ...(current.key === sourceKey ? current : emptyMedia),
      key: sourceKey,
      ...changes,
    }));
  };
  const setReady = (value: boolean) => updateMedia({ ready: value });
  const setPlaying = (value: boolean) => updateMedia({ playing: value });
  const setDuration = (value: number | undefined) => updateMedia({ duration: value });
  const setError = (value: string | null) => updateMedia({ error: value });
  const audio = useRef<HTMLAudioElement>(null);
  const resumeAfterRenewal = useRef(false);
  const pendingPosition = useRef(initialProgress?.position || 0);
  const progress = useRef({
    position: initialProgress?.position || 0,
    speed: initialProgress?.speed || 1,
  });
  const activeLine = useRef<HTMLElement>(null);
  const transcript = conversation.transcript || emptyTranscript;
  const speakerTones = useMemo(() => {
    const tones = new Map<string, number>();
    for (const segment of transcript) {
      const speaker = segment.speaker.trim();
      if (speaker && !tones.has(speaker)) tones.set(speaker, tones.size + 1);
    }
    return tones;
  }, [transcript]);
  const transcriptTimingAvailable = selectedSource !== "phone";
  const activeIndex =
    ready && transcriptTimingAvailable ? activeTranscriptIndex(transcript, position) : -1;
  const normalizedSearch = search.trim().toLowerCase();
  const visibleSegments = useMemo(
    () =>
      transcript
        .map((segment, index) => ({ segment, index }))
        .filter(({ segment }) =>
          `${segment.speaker} ${segment.text}`.toLowerCase().includes(normalizedSearch),
        ),
    [transcript, normalizedSearch],
  );

  // Read the latest committed callback only when a media session is released.
  const reportProgress = useEffectEvent(() => onProgress?.({ ...progress.current }));

  const refreshAudio = (resume = false) => {
    resumeAfterRenewal.current = resume && Boolean(audio.current && !audio.current.paused);
    if (!recordingId) return;
    pendingPosition.current = progress.current.position;
    audio.current?.pause();
    setReady(false);
    setError(null);
    setRefreshRequest((current) => ({
      providedUrl,
      attempt: (current.providedUrl === providedUrl ? current.attempt : 0) + 1,
    }));
  };

  useEffect(() => {
    if (!visible || !needsUrl || settled || !recordingId) return;
    const requestedId = recordingId;
    const controller = new AbortController();
    let disposed = false;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15_000);
    const load = async () => {
      try {
        const response = await fetch(
          `/api/recordings/${encodeURIComponent(requestedId)}/playback?source=${selectedSource}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = await response.json();
        if (!response.ok || typeof payload.url !== "string")
          throw new Error(payload.error || "The recording could not be opened.");
        const url = new URL(payload.url);
        if (!["http:", "https:"].includes(url.protocol))
          throw new Error("The recording could not be opened.");
        if (!disposed) {
          const sources = readPlaybackSources(payload.availableSources);
          onSourcesResolved(sources);
          setResolution({
            source: playbackSources.includes(payload.source) ? payload.source : selectedSource,
            recordingId: requestedId,
            providedUrl,
            attempt,
            url: url.href,
            expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null,
            error: null,
          });
        }
      } catch (cause) {
        if (!disposed)
          setResolution((current) => ({
            source: selectedSource,
            recordingId: requestedId,
            providedUrl,
            attempt,
            url:
              current?.recordingId === requestedId && current.providedUrl === providedUrl
                ? current.url
                : providedUrl,
            expiresAt: null,
            error: timedOut
              ? "The recording took too long to load. Please retry."
              : cause instanceof Error
                ? cause.message
                : "The recording could not be opened.",
          }));
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void load();
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [
    visible,
    needsUrl,
    settled,
    recordingId,
    providedUrl,
    attempt,
    selectedSource,
    onSourcesResolved,
  ]);

  const renewPlayback = useEffectEvent(() => refreshAudio(true));
  useEffect(() => {
    if (!visible || !settled || !resolution?.url) return;
    const delay = playbackRenewalDelay(resolution.expiresAt);
    if (delay === null) return;
    const timer = window.setTimeout(() => renewPlayback(), delay);
    return () => window.clearTimeout(timer);
  }, [visible, settled, resolution]);

  useEffect(() => {
    const player = audio.current;
    const playbackProgress = progress.current;
    // React's development effect replay can clean up without removing the DOM.
    if (player && source.url && player.getAttribute("src") !== source.url) {
      player.src = source.url;
      player.load();
    }
    return () => {
      // Save the actual media position before replacing a source or closing it.
      if (player && player.readyState >= 1 && Number.isFinite(player.currentTime)) {
        playbackProgress.position = player.currentTime;
      }
      pendingPosition.current = playbackProgress.position;
      reportProgress();
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
      setError("This part of the recording is not ready yet. Try playing the audio first.");
      return false;
    }
  };

  const jumpToLine = (seconds: number) => {
    if (!seek(seconds)) return;
    const player = audio.current;
    if (player && ready)
      void player
        .play()
        .catch(() => setError("Press Play on the recording to continue listening."));
  };

  const togglePlayback = () => {
    const player = audio.current;
    if (!player || !ready) return;
    if (!player.paused) player.pause();
    else
      void player.play().catch(() => setError("The recording could not start. Please try again."));
  };

  useEffect(() => {
    if (view === "hidden") audio.current?.pause();
  }, [view]);

  const restorePosition = (player: HTMLAudioElement) => {
    player.playbackRate = progress.current.speed;
    if (pendingPosition.current <= 0) return;
    try {
      player.currentTime = clampPlaybackTime(pendingPosition.current, player.duration);
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
            <span className={styles.eyebrow}>RECORDING</span>
            <h3>
              {settled && resolution.source === "combined"
                ? "Combined audio"
                : selectedSource === "phone"
                  ? "Phone audio"
                  : "Original audio"}
            </h3>
            <p className={styles.duration}>
              Duration ·{" "}
              {duration ? formatAudioTime(duration) : recordingDurationLabel(conversation)}
            </p>
          </div>
        </header>
        {availableSources.length > 1 && (
          <div className={styles.sourceSelector} role="group" aria-label="Recording source">
            {availableSources.map((option) => (
              <button
                type="button"
                key={option}
                aria-pressed={option === (settled ? resolution.source : selectedSource)}
                onClick={() => onSourceChange(option)}
              >
                {playbackSourceLabels[option]}
              </button>
            ))}
          </div>
        )}
        <p className={styles.intro}>
          {selectedSource === "phone"
            ? "The preserved phone microphone recording. Transcript timestamps follow the combined audio."
            : "Listen back and revisit the details."}
        </p>
        {source.url && (
          <>
            <audio
              key={`${source.url}:${source.revision}`}
              ref={audio}
              controls
              preload={view === "hidden" ? "none" : "metadata"}
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
                setDuration(Number.isFinite(value) && value > 0 ? value : undefined);
              }}
              onCanPlay={(event) => {
                restorePosition(event.currentTarget);
                if (resumeAfterRenewal.current) {
                  resumeAfterRenewal.current = false;
                  void event.currentTarget
                    .play()
                    .catch(() => setError("Press Play to continue listening."));
                }
              }}
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
                  <span>Back 15 s</span>
                </button>
                <button
                  type="button"
                  disabled={!ready || loading}
                  onClick={() => seek(position + 15)}
                  aria-label="Forward 15 seconds"
                >
                  <span>Forward 15 s</span>
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
            <span className={styles.loadingPulse} aria-hidden="true" />
            Opening your recording…
          </p>
        )}
        {!source.url && !recordingId && (
          <div className={styles.noAudio}>
            <strong>
              {sample ? "This sample has no audio recording" : "No original audio was saved"}
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
              <button type="button" disabled={loading} onClick={() => void refreshAudio()}>
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
            {recordingId && (
              <button type="button" disabled={loading} onClick={() => void refreshAudio()}>
                Reload recording
              </button>
            )}
          </div>
        )}
        <div className={styles.transcriptHeader}>
          <div>
            <h3>Transcript</h3>
            <p>
              {speakerTones.size > 0
                ? `${speakerTones.size} speaker label${speakerTones.size === 1 ? "" : "s"}. `
                : ""}
              {source.url && transcriptTimingAvailable
                ? "Select a timestamp to listen from that point."
                : selectedSource === "phone"
                  ? "Choose Combined audio to listen by transcript timestamp."
                  : "The transcript, in the words captured."}
            </p>
          </div>
          {view === "transcript" && source.url && (
            <button
              type="button"
              disabled={!ready || loading}
              onClick={togglePlayback}
              aria-label={playing ? "Pause recording" : "Play recording"}
            >
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
                Clear
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
                    (source.url && transcriptTimingAvailable ? (
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
          The transcript may contain mistakes. The original audio is your reference.
        </p>
      </div>
    </section>
  );
}
