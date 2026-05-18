import {
  clearAccessCookie,
  isRequestAuthenticated,
  setAccessCookie,
  validatePasswordAgainstWorkerKey,
} from "@backend/utils/access";
import { Hono } from "hono";

const accessRouter = new Hono<{ Bindings: Env }>();

accessRouter.get("/status", async (c) => {
  const authenticated = await isRequestAuthenticated(c.req.raw, c.env);
  return c.json({ success: true, authenticated });
});

accessRouter.post("/login", async (c) => {
  try {
    const body = (await c.req.json()) as { password?: string };
    const password = body.password?.trim() || "";

    const valid = await validatePasswordAgainstWorkerKey(password, c.env);
    if (!valid) {
      return c.json({ error: "Invalid password" }, 401);
    }

    await setAccessCookie(c);

    return c.json({
      success: true,
      authenticated: true,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to authenticate",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

accessRouter.post("/logout", (c) => {
  clearAccessCookie(c);
  return c.json({ success: true, authenticated: false });
});

export { accessRouter };
