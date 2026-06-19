import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";
import { showroomStoreProducts } from "./store_products";

/**
 * Similar Store Map — AI-discovered stores that serve similar niches.
 *
 * The ShowroomResearchAgent populates this by analyzing store descriptions,
 * categories, and price points to find comparable alternatives.
 */
export const storeSimilarMap = sqliteTable("store_similar_map", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** The anchor store from which similars are generated. */
  parentStoreId: integer("parent_store_id")
    .notNull()
    .references(() => showroomStores.id, { onDelete: "cascade" }),

  /** The similar store found as a comparable alternative. */
  similarStoreId: integer("similar_store_id")
    .notNull()
    .references(() => showroomStores.id, { onDelete: "cascade" }),

  similarStorePricePoint: text("similar_store_price_point"),

  /** AI-generated comparison analysis. */
  aiAnalysis: text("ai_analysis"),
  aiSimilarityReviewScore: integer("ai_similarity_review_score"),
  aiSimilarityReviewScoreRationale: text(
    "ai_similarity_review_score_rationale"
  ),

  /** User feedback on the similarity suggestion. */
  userFeedbackNotes: text("user_feedback_notes"),
  isLikedByUser: integer("is_liked_by_user", { mode: "boolean" }),
  userRatingOnSimilarity: integer("user_rating_on_similarity"), // 1-5
  isUserInterested: integer("is_user_interested", { mode: "boolean" }),
  userInterestNotes: text("user_interest_notes"),

  timestamp: integer("timestamp", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),
});

/**
 * Similar Product Model Map — AI-discovered products that are comparable.
 *
 * Used for price comparison, alternative sourcing, and cross-shopping.
 */
export const storeProductSimilarModelMap = sqliteTable(
  "store_product_similar_model_map",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** The anchor product from which similars are generated. */
    parentStoreProductId: integer("parent_store_product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    /** The similar product found as a comparable alternative. */
    similarStoreProductId: integer("similar_store_product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    similarModelPrice: text("similar_model_price"),
    similarModelPriceDiff: text("similar_model_price_diff"),

    /** AI-generated comparison analysis. */
    aiAnalysis: text("ai_analysis"),
    aiSimilarityReviewScore: integer("ai_similarity_review_score"),
    aiSimilarityReviewScoreRationale: text(
      "ai_similarity_review_score_rationale"
    ),

    /** User feedback on the similarity suggestion. */
    userFeedbackNotes: text("user_feedback_notes"),
    isLikedByUser: integer("is_liked_by_user", { mode: "boolean" }),
    userRatingOnSimilarity: integer("user_rating_on_similarity"), // 1-5
    isUserInterested: integer("is_user_interested", { mode: "boolean" }),
    userInterestNotes: text("user_interest_notes"),

    timestamp: integer("timestamp", { mode: "timestamp" }).default(
      sql`(unixepoch())`
    ),
  }
);

export type StoreSimilarMapType = typeof storeSimilarMap.$inferSelect;
export type StoreSimilarMapInsert = typeof storeSimilarMap.$inferInsert;
export type StoreProductSimilarModelMapType =
  typeof storeProductSimilarModelMap.$inferSelect;
export type StoreProductSimilarModelMapInsert =
  typeof storeProductSimilarModelMap.$inferInsert;
