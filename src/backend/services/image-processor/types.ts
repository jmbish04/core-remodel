export interface ImageAnalysisResult {
  roomType: string;
  keywords: string[];
  suggestedDisplayName: string;
  styleTheme: string;
  materials: string[];
  visibleElements: string[];
  isInstagram: boolean;
  instagramAccount?: string;
  instagramCaption?: string;
  needsCrop?: boolean;
}

export interface PhotoReviewAnalysis {
  room: string;
  tags: string[];
}

export interface CloudflareImagesResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: {
    id: string;
    filename?: string;
    uploaded?: string;
    requireSignedURLs?: boolean;
    variants?: string[];
  };
}

export interface CloudflareImagesUploadRequestOptions {
  endpoint?: string;
  authTokenOverride?: string;
  maxAttempts?: number;
}

export interface ImageRoomAssignmentOptions {
  roomId?: number | null;
  roomType?: string | null;
}

export interface ImageNamingHints {
  roomLabels?: string[];
  existingDisplayNames?: string[];
  referenceMetadata?: string[];
}

export interface ImageAnalysisContext {
  photoCategory?: string;
  roomHint?: string | null;
  roomLabels?: string[];
  existingDisplayNames?: string[];
  referenceMetadata?: string[];
}

export interface BuildImageMetadataOptions {
  displayName: string;
  assignedRoomType: string;
  assignedRoomId?: number | null;
  deliveryUrl?: string | null;
  deliveryToken?: string | null;
}

export interface ProcessImageResult {
  success: boolean;
  imageId: string;
  deliveryUrl?: string;
  analysis?: ImageAnalysisResult;
  error?: string;
}

export type PhotoCategory = "inspirational" | "listing" | "ai_render";
