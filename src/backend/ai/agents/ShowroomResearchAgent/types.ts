export type ShowroomSweepTargetType = "product" | "store" | "category";

export type ShowroomSweepTriggerSource =
  | "manual"
  | "product-created"
  | "store-created"
  | "cron-category-gap"
  | "cron-rejection-loop";

export type ShowroomResearchMode = "quick" | "deep";

export interface DeepResearchOptions {
  researchMode?: ShowroomResearchMode;
  deepResearchWaitMs?: number;
  enableMcpBridge?: boolean;
  mcpServerUrl?: string | null;
}

export interface DeepSweepProductInput {
  productId: number;
  prompt?: string;
  maxSources?: number;
  negativeConstraints?: string[];
  triggerSource?: ShowroomSweepTriggerSource;
  researchMode?: ShowroomResearchMode;
  deepResearchWaitMs?: number;
  enableMcpBridge?: boolean;
  mcpServerUrl?: string | null;
}

export interface DeepSweepStoreInput {
  storeId: number;
  prompt?: string;
  maxSources?: number;
  negativeConstraints?: string[];
  triggerSource?: ShowroomSweepTriggerSource;
  researchMode?: ShowroomResearchMode;
  deepResearchWaitMs?: number;
  enableMcpBridge?: boolean;
  mcpServerUrl?: string | null;
}

export interface DeepSweepCategoryInput {
  categoryId: number;
  prompt?: string;
  maxSources?: number;
  negativeConstraints?: string[];
  triggerSource?: ShowroomSweepTriggerSource;
  researchMode?: ShowroomResearchMode;
  deepResearchWaitMs?: number;
  enableMcpBridge?: boolean;
  mcpServerUrl?: string | null;
}

export interface ShowroomSweepResult {
  success: boolean;
  targetType: ShowroomSweepTargetType;
  targetId: number;
  citationsFound: number;
  sourcesProcessed: number;
  findingsWritten: number;
  imagesWritten: number;
  specsWritten: number;
  vectorsWritten: number;
  warnings: string[];
}

export interface ShowroomCitationPlan {
  citationUrls: string[];
  searchQueries: string[];
  researchIntent: string;
}

export interface ExtractedImageCandidate {
  url: string;
  altText?: string;
  kind?: "product" | "lifestyle" | "spec" | "packaging" | "storefront" | "showroom" | "logo" | "map" | "unknown";
  width?: number;
  height?: number;
}

export interface ExtractedSpec {
  key: string;
  value: string;
  unit?: string;
  confidence?: number;
}

export interface ExtractedFinding {
  finding: string;
  sentiment?: "good" | "bad" | "neutral";
}

export interface ExtractedRating {
  source: string;
  rating: number;
  comment?: string;
  ratingCreated?: string;
}

export interface BrowserSourceExtraction {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  openGraphImage?: string;
  images?: ExtractedImageCandidate[];
  specs?: ExtractedSpec[];
  findings?: ExtractedFinding[];
  ratings?: ExtractedRating[];
  warrantyNotes?: string[];
  reviewSummary?: string;
  summary?: string;
}

export interface ProductPromptContext {
  product: {
    id: number;
    itemName: string;
    description: string | null;
    colors: string | null;
    preferredColor: string | null;
    sku: string | null;
    price: string | null;
    jsonDetails: string | null;
    notes: string | null;
    leadTime: string | null;
    possibleDiscounts: string | null;
    tradeDiscount: string | null;
  };
  store: {
    id: number;
    name: string;
    description: string | null;
    websiteUrl: string | null;
    locationAddress: string | null;
    inventoryFocus: string | null;
    targetDemographic: string | null;
    pricePoint: string | null;
  } | null;
  activeProductRatings: Array<{ rating: number; ratingNotes: string | null }>;
  activeStoreRatings: Array<{ rating: number; ratingNotes: string | null }>;
  researchFindings: Array<{ finding: string; findingUrl: string | null; sentiment: string | null; reviewStatus: string; reviewReason: string | null }>;
  specs: Array<{ specKey: string; specValue: string; unit: string | null; sourceUrl: string | null }>;
  images: Array<{ deliveryUrl: string; sourceUrl: string; imageKind: string; altText: string | null }>;
  negativeConstraints: string[];
}
