import type { RemodelTool } from "../../types";

import { listShowrooms } from "./list_showrooms";
import { getShowroom } from "./get_showroom";
import { createShowroom } from "./create_showroom";
import { updateShowroom } from "./update_showroom";
import { addShowroomNote } from "./add_showroom_note";
import { addShowroomPoc } from "./add_showroom_poc";
import { setShowroomHours } from "./set_showroom_hours";
import { setShowroomLinks } from "./set_showroom_links";
import { recordShowroomVisit } from "./record_showroom_visit";
import { searchShowrooms } from "./search_showrooms";
import { importShowroomFromPlace } from "./import_showroom_from_place";
import { checkShowroomIntakeStatus } from "./check_showroom_intake_status";
import { backfillShowroomGeo } from "./backfill_showroom_geo";
import { backfillShowroomMedia } from "./backfill_showroom_media";
import { findKnownShowrooms } from "./find_known_showrooms";
import { getUserLocation } from "./get_user_location";

export const showroomTools: RemodelTool[] = [
  listShowrooms,
  getShowroom,
  createShowroom,
  updateShowroom,
  addShowroomNote,
  addShowroomPoc,
  setShowroomHours,
  setShowroomLinks,
  recordShowroomVisit,
  searchShowrooms,
  importShowroomFromPlace,
  checkShowroomIntakeStatus,
  backfillShowroomGeo,
  backfillShowroomMedia,
  findKnownShowrooms,
  getUserLocation,
];
