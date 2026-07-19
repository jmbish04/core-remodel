import type { RemodelTool } from "../../types";

import { addShowroomNote } from "./add_showroom_note";
import { addShowroomPoc } from "./add_showroom_poc";
import { backfillShowroomGeo } from "./backfill_showroom_geo";
import { checkShowroomIntakeStatus } from "./check_showroom_intake_status";
import { createShowroom } from "./create_showroom";
import { getShowroom } from "./get_showroom";
import { getUserLocation } from "./get_user_location";
import { importShowroomFromPlace } from "./import_showroom_from_place";
import { listShowrooms } from "./list_showrooms";
import { recordShowroomVisit } from "./record_showroom_visit";
import { searchShowrooms } from "./search_showrooms";
import { setShowroomHours } from "./set_showroom_hours";
import { setShowroomLinks } from "./set_showroom_links";
import { updateShowroom } from "./update_showroom";

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
  getUserLocation,
];
