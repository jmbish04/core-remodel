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
