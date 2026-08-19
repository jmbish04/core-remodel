/**
 * @fileoverview Showroom hero building blocks — category chips (editable),
 * social icon links, and the office-hours mini-card + full hours/contact/map
 * modal. Consumed by StoreViewportApp's enriched hero header.
 */

export { CategoryChipsEditor, type StoreCategoryChip } from "./CategoryChipsEditor";
export { TypeEditor } from "./TypeEditor";
export {
  SocialLinks,
  SOCIAL_LINK_TYPES,
  handleFromUrl,
  type SocialLinkType,
  type StoreLink,
} from "./SocialLinks";
export { HoursMiniCard } from "./HoursMiniCard";
export { HeroLinkButtons } from "./HeroLinkButtons";
export { UploadPhotoModal } from "./UploadPhotoModal";
export { TOUCH_DIALOG_BODY_CLASS, TOUCH_DIALOG_CLASS } from "./touch-dialog";
export { HoursContactModal, type HoursContactStore } from "./HoursContactModal";
export {
  EditHoursModal,
  EditAddressModal,
  ManageLinksModal,
  type EditableAddress,
} from "./StoreEditModals";
