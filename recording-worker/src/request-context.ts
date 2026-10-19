/** Build-time adapter: a queue job must always provide its trusted client and owner. */
export function getServerSupabase(): never {
  throw new Error("The recording worker requires explicit persistence client injection.");
}

export async function resolveWorkspaceUserId(): Promise<never> {
  throw new Error("A background job cannot resolve a browser session; provide its owner.");
}
