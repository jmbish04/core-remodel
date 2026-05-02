/**
 * @fileoverview Database schema definitions using drizzle-orm.
 *
 * This file defines the database schema using drizzle-orm for the complete application.
 * It includes tables for authentication, dashboard metrics, AI threads, and system health.
 */

import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

/**
 * Users table for authentication
 */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Sessions table for managing user sessions
 */
export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Dashboard metrics table
 */
export const dashboardMetrics = sqliteTable("dashboard_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  metricName: text("metric_name").notNull(),
  metricValue: real("metric_value").notNull(),
  metricType: text("metric_type").notNull(), // 'count', 'percentage', 'currency', 'time'
  category: text("category").notNull(), // 'users', 'revenue', 'performance', 'system'
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * AI Thread table for assistant conversations
 */
export const threads = sqliteTable("threads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Messages table for thread conversations
 */
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  threadId: integer("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user', 'assistant', 'system'
  content: text("content").notNull(),
  metadata: text("metadata"), // JSON string for attachments, tool calls, etc.
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * System health checks table
 */
export const healthChecks = sqliteTable("health_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  serviceName: text("service_name").notNull(),
  status: text("status").notNull(), // 'healthy', 'degraded', 'down'
  responseTime: integer("response_time"), // in milliseconds
  errorMessage: text("error_message"),
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Notifications table for system alerts
 */
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'info', 'warning', 'error', 'success'
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * PlateJS documents table
 */
export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(), // JSON string of Slate nodes
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Images table for remodel mood board system
 */
export const images = sqliteTable("images", {
  id: text("id").primaryKey(), // UUID
  cfImageIdOriginal: text("cf_image_id_original").notNull(),
  cfImageIdOptimized: text("cf_image_id_optimized"),
  roomType: text("room_type"), // e.g., "kitchen", "bathroom", "living room"
  isInstagram: integer("is_instagram", { mode: "boolean" }).notNull().default(false),
  instagramAccount: text("instagram_account"),
  instagramCaption: text("instagram_caption"),
  metadata: text("metadata"), // JSON for keywords/structured AI response
  isListingPhoto: integer("is_listing_photo", { mode: "boolean" }).notNull().default(false),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Mood boards table
 */
export const moodBoards = sqliteTable("mood_boards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  backgroundColor: text("background_color").default("#ffffff"),
  layoutState: text("layout_state"), // JSON for positions/styles
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeLastModified: integer("datetime_last_modified", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Listing photos table - separate tracking for house stock photos
 */
export const listingPhotos = sqliteTable("listing_photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cfImageId: text("cf_image_id").notNull(),
  roomName: text("room_name").notNull(),
  description: text("description"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * AI edits table for tracking AI-generated image modifications
 */
export const aiEdits = sqliteTable("ai_edits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  originalListingId: integer("original_listing_id")
    .notNull()
    .references(() => listingPhotos.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  generatedCfImageId: text("generated_cf_image_id").notNull(),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Image reviews table for retrofitted python script functionality
 */
export const imageReviews = sqliteTable("image_reviews", {
  id: text("id").primaryKey(), // UUID
  path: text("path").notNull(), // S3/R2 object key
  filename: text("filename").notNull(),
  room: text("room").default("unassigned"),
  tags: text("tags", { mode: "json" }), // JSON array of strings
  note: text("note").default(""),
  sourceFile: text("source_file"),
  imageNumber: text("image_number"),
  igAccount: text("ig_account"),
  visibleCaption: text("visible_caption"),
  width: integer("width"),
  height: integer("height"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
