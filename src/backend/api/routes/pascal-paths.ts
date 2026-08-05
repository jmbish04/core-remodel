/** Canonical mount used by both the API router and its generated OpenAPI document. */
export const PASCAL_API_MOUNT_PATH = "/api/pascal/v1";

/** The OpenAPI server is already rooted at `/api`, so paths omit that prefix. */
export const PASCAL_OPENAPI_PATH_PREFIX = PASCAL_API_MOUNT_PATH.slice("/api".length);
