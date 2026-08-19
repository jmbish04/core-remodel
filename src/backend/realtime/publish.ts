export async function publishRealtimeEvent(
  env: Env,
  room: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const roomKey = room.trim().length > 0 ? room.trim() : "global";
  const stub = env.ESTIMATE_COLLAB.getByName(roomKey);
  await stub.fetch("https://realtime.internal/emit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

/**
 * Fan a discovery-finder event out to everyone viewing a search slug (0032 D2).
 * The finder engine calls this after a write (status change, revision added,
 * results ready) so an open `/finder/<slug>` page updates live. Best-effort:
 * a failure to publish must never break the underlying search write, so callers
 * run it off `waitUntil` / swallow errors.
 */
export async function publishDiscoveryEvent(
  env: Env,
  slug: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const roomKey = `search:${slug.trim() || "global"}`;
  const stub = env.DISCOVERY_HUB.getByName(roomKey);
  await stub.fetch("https://realtime.internal/emit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
