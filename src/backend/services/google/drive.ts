/**
 * @fileoverview Drive REST client types and API wrapper.
 *
 * The REST client implementation (fetching files, exporting, auth) lands in a
 * later task. This file carries only the types shared with the diff classifier
 * and other consuming services.
 */

export type DriveSharing =
  | "ANYONE"
  | "ANYONE_WITH_LINK"
  | "DOMAIN"
  | "DOMAIN_WITH_LINK"
  | "PRIVATE";

export interface DriveNode {
  driveId: string;
  name: string;
  mimeType: string;
  parentDriveId: string | null;
  sizeBytes: number | null;
  md5Checksum: string | null;
  webViewUrl: string;
  sharing: DriveSharing;
  modifiedAt: Date | null;
  createdAt: Date | null;
  isFolder: boolean;
}
