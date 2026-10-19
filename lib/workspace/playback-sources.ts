/** Public source labels only; private storage paths never enter client metadata. */
export const playbackSources = ["combined", "onboard", "phone"] as const;
export type PlaybackSource = (typeof playbackSources)[number];
export const playbackSourceLabels: Record<PlaybackSource, string> = {
  combined: "Combined",
  onboard: "Onboard mic",
  phone: "Phone mic",
};
export function readPlaybackSources(value: unknown): PlaybackSource[] {
  if (!Array.isArray(value)) return [];
  return playbackSources.filter((source) => value.includes(source));
}
