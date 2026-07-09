import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Google OAuth Tokens — long-lived refresh tokens for user-consented Google
 * integrations (3-legged OAuth).
 *
 * This project is single-user (the homeowner), so each provider has exactly one
 * row. The first integration is the Google Photos Picker API (`provider =
 * "photos"`), which needs a refresh token to mint short-lived access tokens for
 * creating picker sessions and downloading picked media bytes.
 *
 * Only the refresh token is persisted here — short-lived access tokens are
 * cached separately in the CACHE KV namespace and re-minted on expiry. See
 * `src/backend/services/google-photos/oauth.ts`.
 */
export const googleOauthTokens = sqliteTable("google_oauth_tokens", {
  /** Stable provider key, e.g. "photos". One row per provider. */
  provider: text("provider").primaryKey(),

  /** The OAuth refresh token (access_type=offline). */
  refreshToken: text("refresh_token").notNull(),

  /** Space-delimited scopes granted at consent time. */
  scope: text("scope"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type GoogleOauthToken = typeof googleOauthTokens.$inferSelect;
export type NewGoogleOauthToken = typeof googleOauthTokens.$inferInsert;
