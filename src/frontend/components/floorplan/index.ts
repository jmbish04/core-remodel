/**
 * @fileoverview floorplan/index.ts
 *
 * Barrel for the floor-plan page submodules (feature 0005, Phase 2). Keeps the
 * feature folder importable as a single unit and avoids a flat components dump.
 */

export { FloorplanDot } from "./FloorplanDot";
export type { FloorplanDotProps } from "./FloorplanDot";
export { LevelSidebar } from "./LevelSidebar";
export type { LevelSidebarProps } from "./LevelSidebar";
export { RoomCardBody, RoomHoverCard } from "./RoomHoverCard";
export type { RoomHoverCardProps } from "./RoomHoverCard";
export * from "./types";
