import type { SupabaseClient } from "@supabase/supabase-js";
import { directStorageEndpoint, validateTusLocation, TUS_CHUNK_BYTES } from "./device-upload";

/** Mint a path-scoped capability and recover a storage-confirmed offset. No audio crosses this API. */
export async function preparePrivateTusUpload(options: {
  client: SupabaseClient;
  supabaseUrl: string;
  path: string;
  bytes: number;
  previousUrl?: string | null;
  fetchImpl?: typeof fetch;
}) {
  const endpoint = directStorageEndpoint(options.supabaseUrl);
  const { data: signed, error } = await options.client.storage
    .from("recordings")
    .createSignedUploadUrl(options.path);
  if (error || !signed) throw new Error("Upload permission could not be created.");
  const headers = { "tus-resumable": "1.0.0", "x-signature": signed.token };
  const fetcher = options.fetchImpl ?? fetch;
  let location = options.previousUrl ? validateTusLocation(options.previousUrl, endpoint) : null;
  let offset = 0;
  if (location) {
    const response = await fetcher(location, {
      method: "HEAD",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404 || response.status === 410) location = null;
    else {
      if (!response.ok) throw new Error("Upload recovery is unavailable.");
      const value = response.headers.get("upload-offset");
      if (!value || !/^\d+$/u.test(value)) throw new Error("Storage returned an invalid offset.");
      offset = Number(value);
    }
  }
  if (!location) {
    const metadata = Object.entries({
      bucketName: "recordings",
      objectName: options.path,
      contentType: "audio/wav",
      cacheControl: "0",
    })
      .map(([key, value]) => key + " " + Buffer.from(value).toString("base64"))
      .join(",");
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "upload-length": String(options.bytes),
        "upload-metadata": metadata,
      },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const returned = response.headers.get("location");
    if (response.status !== 201 || !returned) throw new Error("Upload could not be started.");
    location = validateTusLocation(returned, endpoint);
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > options.bytes)
    throw new Error("Storage returned an invalid offset.");
  return {
    uploadUrl: location,
    token: signed.token,
    uploadedBytes: offset,
    chunkBytes: TUS_CHUNK_BYTES,
  };
}
