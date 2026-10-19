export interface RecordingWorkerConfig {
  supabaseUrl: string;
  supabaseKey: string;
  redisUrl?: string;
  concurrency: number;
  pollIntervalMs: number;
  shutdownGraceMs: number;
  host: string;
  port: number;
}

function integer(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(environment[key] || fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  return value;
}

export function loadRecordingWorkerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RecordingWorkerConfig {
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseKey)
    throw new Error("Recording worker requires Supabase URL and a server-only Supabase key.");
  const endpoint = new URL(supabaseUrl);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be the HTTPS project origin.");
  }
  if (!environment.OPENAI_API_KEY?.trim())
    throw new Error("Recording worker requires OPENAI_API_KEY.");
  let redisUrl: string | undefined;
  if (environment.UPSTASH_REDIS_URL?.trim()) {
    const redis = new URL(environment.UPSTASH_REDIS_URL.trim());
    if (redis.protocol !== "rediss:" || redis.hash)
      throw new Error("UPSTASH_REDIS_URL must use encrypted rediss://.");
    redisUrl = redis.toString();
  }
  return {
    supabaseUrl: endpoint.origin,
    supabaseKey,
    redisUrl,
    concurrency: integer(environment, "RECORDING_WORKER_CONCURRENCY", 1, 1, 4),
    pollIntervalMs: integer(environment, "RECORDING_WORKER_POLL_MS", 10000, 1000, 60000),
    shutdownGraceMs: integer(environment, "RECORDING_WORKER_SHUTDOWN_MS", 30000, 1000, 300000),
    host: environment.HOST?.trim() || "0.0.0.0",
    port: integer(environment, "PORT", 3002, 1, 65535),
  };
}
