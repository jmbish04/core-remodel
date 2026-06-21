/**
 * Barrel for the room viewport feature.
 *
 * The `RoomViewApp` orchestrator and any external consumer import section
 * components and the shared wire contract from here, so the feature presents a
 * single, stable surface. Round 3b can flesh out the stub components
 * (`BudgetSignals`, `RoomMediaModal`, `SupportingMaterials`, `MovePhotosModal`,
 * `ImageActions`) without changing these export paths.
 */
export { HeroHeader, type HeroHeaderProps } from "./HeroHeader";
export { RoomStatsRow, type RoomStatsRowProps } from "./RoomStatsRow";
export { RoomOverview, type RoomOverviewProps } from "./RoomOverview";
export { RoomOptions, type RoomOptionsProps } from "./RoomOptions";
export { BudgetSignals, type BudgetSignalsProps } from "./BudgetSignals";
export { RoomMediaModal, type RoomMediaModalProps } from "./RoomMediaModal";
export { SupportingMaterials, type SupportingMaterialsProps } from "./SupportingMaterials";
export { MovePhotosModal, type MovePhotosModalProps } from "./MovePhotosModal";
export { ImageActions, type ImageActionsProps } from "./ImageActions";

export * from "./types";
