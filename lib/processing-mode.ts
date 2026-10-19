/** Explicit migration switch: deploy the dedicated worker before selecting dedicated. */
export function usesDedicatedRecordingWorker(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const mode = environment.QUIPUS_PROCESSING_MODE || "inline";
  if (mode !== "inline" && mode !== "dedicated") {
    throw new Error("QUIPUS_PROCESSING_MODE must be inline or dedicated.");
  }
  return mode === "dedicated";
}
