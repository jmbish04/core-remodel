export type UploadProcessingStatus = "queued" | "processing" | "processed" | "failed";

export type TrackedUploadStatus = "idle" | "uploading" | UploadProcessingStatus;

export interface UploadApiImageRecord {
  id: string;
  displayName?: string | null;
  processingStatus?: UploadProcessingStatus | null;
  workflowInstanceId?: string | null;
  processingError?: string | null;
  processedAt?: string | number | Date | null;
}

export interface UploadApiResult {
  success?: boolean;
  imageId?: string;
  error?: string;
  workflowInstanceId?: string;
  processingStatus?: UploadProcessingStatus;
  image?: UploadApiImageRecord | null;
}

export interface UploadApiResponse {
  success?: boolean;
  error?: string;
  message?: string;
  results?: UploadApiResult[];
}

export interface TrackedUploadState {
  status: TrackedUploadStatus;
  message: string;
  imageId?: string;
  workflowInstanceId?: string | null;
  processingError?: string | null;
  processedAt?: string | number | Date | null;
  displayName?: string | null;
  photoCategory?: string;
  progress?: number;
  stepName?: string;
}

export function getTrackedUploadMessage(
  status: TrackedUploadStatus,
  processingError?: string | null,
): string {
  switch (status) {
    case "idle":
      return "Ready to upload";
    case "uploading":
      return "Uploading original file to Cloudflare";
    case "queued":
      return "Uploaded. Waiting for background processing.";
    case "processing":
      return "Workers AI and workflow processing are running.";
    case "processed":
      return "Background processing complete.";
    case "failed":
      return processingError?.trim() || "Background processing failed.";
    default:
      return "Ready to upload";
  }
}

export function getTrackedUploadTone(
  status: TrackedUploadStatus,
): "neutral" | "info" | "success" | "error" {
  switch (status) {
    case "uploading":
    case "queued":
    case "processing":
      return "info";
    case "processed":
      return "success";
    case "failed":
      return "error";
    default:
      return "neutral";
  }
}

export function getTrackedUploadLabel(status: TrackedUploadStatus): string {
  switch (status) {
    case "idle":
      return "Ready";
    case "uploading":
      return "Uploading";
    case "queued":
      return "Queued";
    case "processing":
      return "Processing";
    case "processed":
      return "Processed";
    case "failed":
      return "Failed";
    default:
      return "Ready";
  }
}

export function createTrackedUploadStateFromResult(
  result: UploadApiResult | undefined,
  photoCategory?: string,
): TrackedUploadState {
  const fallbackError = result?.error?.trim() || "Upload failed";
  if (!result?.success) {
    return {
      status: "failed",
      message: fallbackError,
      imageId: result?.imageId,
      workflowInstanceId: result?.workflowInstanceId ?? null,
      processingError: fallbackError,
      displayName: result?.image?.displayName ?? null,
      photoCategory,
    };
  }

  const status = result.processingStatus ?? "queued";
  return {
    status,
    message: getTrackedUploadMessage(status),
    imageId: result.imageId,
    workflowInstanceId: result.workflowInstanceId ?? null,
    processingError: null,
    processedAt: result.image?.processedAt ?? null,
    displayName: result.image?.displayName ?? null,
    photoCategory,
  };
}

export function mergeTrackedUploadState(
  current: TrackedUploadState | undefined,
  image: UploadApiImageRecord,
): TrackedUploadState {
  const nextStatus = image.processingStatus ?? current?.status ?? "queued";
  const processingError = image.processingError ?? current?.processingError ?? null;
  return {
    status: nextStatus,
    message: getTrackedUploadMessage(nextStatus, processingError),
    imageId: image.id,
    workflowInstanceId: image.workflowInstanceId ?? current?.workflowInstanceId ?? null,
    processingError,
    processedAt: image.processedAt ?? current?.processedAt ?? null,
    displayName: image.displayName ?? current?.displayName ?? null,
    photoCategory: current?.photoCategory,
  };
}

export function hasTrackedUploadsInFlight(
  states: Record<string, TrackedUploadState>,
): boolean {
  return Object.values(states).some(
    (state) =>
      state.status === "uploading" ||
      state.status === "queued" ||
      state.status === "processing",
  );
}

export function buildImageStatusUrl(
  photoCategory: string,
  imageIds: string[],
): string {
  const query = new URLSearchParams({
    photoCategory,
    ids: imageIds.join(","),
  });
  return `/api/images?${query.toString()}`;
}
