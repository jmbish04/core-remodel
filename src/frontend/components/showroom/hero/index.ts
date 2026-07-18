/**
 * @fileoverview Showroom hero building blocks — category chips (editable),
 * social icon links, and the office-hours mini-card + full hours/contact/map
 * modal. Consumed by StoreViewportApp's enriched hero header.
 */

export { CategoryChipsEditor, type StoreCategoryChip } from "./CategoryChipsEditor";
export {
  SocialLinks,
  SOCIAL_LINK_TYPES,
  handleFromUrl,
  type SocialLinkType,
  type StoreLink,
} from "./SocialLinks";
export { HoursMiniCard } from "./HoursMiniCard";
export { HoursContactModal, type HoursContactStore } from "./HoursContactModal";
export {
  EditHoursModal,
  EditAddressModal,
  ManageLinksModal,
  type EditableAddress,
} from "./StoreEditModals";
