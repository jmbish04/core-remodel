import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createHash } from "node:crypto";
import { images } from "@backend/db";

export interface ImageUploadFingerprint {
  sourceFilename: string;
  sourceFilenameNormalized: string;
  sourceFileSize: number;
  sourceFileMd5: string;
}

function normalizeUploadFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) {
    return "unnamed-image";
  }

  const fileSegment = trimmed.split(/[\\/]+/).pop() || trimmed;
  const normalized = fileSegment.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized || "unnamed-image";
}

function normalizeStoredFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) {
    return "unnamed-image";
  }
  return trimmed.slice(0, 255);
}

export async function buildImageUploadFingerprint(file: File): Promise<ImageUploadFingerprint> {
  const bytes = await file.arrayBuffer();
  return buildImageUploadFingerprintFromBytes({
    filename: file.name || "unnamed-image",
    sourceFileSize:
      Number.isFinite(file.size) && file.size > 0 ? Math.trunc(file.size) : bytes.byteLength,
    bytes,
  });
}

export function buildImageUploadFingerprintFromBytes(params: {
  filename: string;
  sourceFileSize: number;
  bytes: ArrayBuffer;
}): ImageUploadFingerprint {
  const { filename, sourceFileSize, bytes } = params;
  const md5 = createHash("md5").update(new Uint8Array(bytes)).digest("hex");
  const sourceFilename = normalizeStoredFilename(filename);
  return {
    sourceFilename,
    sourceFilenameNormalized: normalizeUploadFilename(sourceFilename),
    sourceFileSize,
    sourceFileMd5: md5,
  };
}

export function buildUploadFingerprintKey(fingerprint: ImageUploadFingerprint): string {
  return `${fingerprint.sourceFileMd5}:${fingerprint.sourceFilenameNormalized}:${fingerprint.sourceFileSize}`;
}

export async function findDuplicateImageByFingerprint(
  db: ReturnType<typeof drizzle>,
  fingerprint: ImageUploadFingerprint,
): Promise<typeof images.$inferSelect | null> {
  const md5Match = await db
    .select()
    .from(images)
    .where(eq(images.sourceFileMd5, fingerprint.sourceFileMd5))
    .get();

  if (md5Match) {
    return md5Match;
  }

  if (fingerprint.sourceFileSize <= 0) {
    return null;
  }

  return (
    (await db
      .select()
      .from(images)
      .where(
        and(
          eq(images.sourceFilenameNormalized, fingerprint.sourceFilenameNormalized),
          eq(images.sourceFileSize, fingerprint.sourceFileSize),
        ),
      )
      .get()) ?? null
  );
}
