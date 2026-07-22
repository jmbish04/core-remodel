/**
 * @fileoverview Health check barrel.
 *
 * Importing a check module is what REGISTERS it — `registerHealthCheck` runs at
 * module load. A check nobody imports silently never appears on the health
 * page, so every check file must be re-exported here.
 */

export * from "./registry";
export * from "./checks/brands";
