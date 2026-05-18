export async function publishRealtimeEvent(
  env: Env,
  room: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const roomKey = room.trim().length > 0 ? room.trim() : "global";
  const id = env.ESTIMATE_COLLAB.idFromName(roomKey);
  const stub = env.ESTIMATE_COLLAB.get(id);
  await stub.fetch("https://realtime.internal/emit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
