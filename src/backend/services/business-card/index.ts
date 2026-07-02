/**
 * @fileoverview Business Card Service barrel
 *
 * Re-exports the BusinessCardService class, the pre-constructed singleton
 * (`businessCardService`), and the ExtractedContact type for use in route
 * handlers and any future service consumers.
 */
export { BusinessCardService, businessCardService } from "./service";
export type { ExtractedContact } from "./service";
