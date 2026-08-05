/**
 * room-geometry — on-the-fly geometry calculators for rooms.
 *
 * One module per calculation type (area, linear feet), all sharing the
 * `dimensions` primitives. Import from here: `@backend/services/room-geometry`.
 * 0043 removed stored geometry columns — everything is derived from dimensions.
 */
export * from "./dimensions";
export * from "./area";
export * from "./linear-feet";
