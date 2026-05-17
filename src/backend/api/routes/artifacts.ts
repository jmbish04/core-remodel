import { Hono } from "hono";

const artifactsRouter = new Hono<{ Bindings: Env }>();

function parseArtifactKey(rawPath: string): string | null {
  const withoutLeadingSlash = rawPath.replace(/^\/+/, "");
  if (!withoutLeadingSlash) {
    return null;
  }
  if (
    withoutLeadingSlash.includes("..") ||
    withoutLeadingSlash.includes("\\") ||
    withoutLeadingSlash.includes("//")
  ) {
    return null;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9/_\-.]*$/.test(withoutLeadingSlash)) {
    return null;
  }
  return withoutLeadingSlash;
}

artifactsRouter.get("/*", async (c) => {
  try {
    const path = c.req.path.replace(/^\/api\/artifacts\//, "");
    const decodedPath = decodeURIComponent(path);
    const key = parseArtifactKey(decodedPath);
    if (!key) {
      return c.json({ error: "Invalid artifact key" }, 400);
    }
    const object = await c.env.ARTIFACTS_BUCKET.get(key);
    if (!object) {
      return c.json({ error: "Artifact not found" }, 404);
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    return new Response(object.body, {
      headers,
      status: 200,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load artifact",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { artifactsRouter };
