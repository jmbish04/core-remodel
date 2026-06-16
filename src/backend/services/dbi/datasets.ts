/**
 * Registry of SF DBI datasets used by the permits pipeline, grouped by trade,
 * plus the per-dataset field mappings the contractor matcher relies on. The
 * contact datasets in particular have inconsistent column names
 * (`firm_name` vs `company_name`, single vs split address), so those are mapped
 * explicitly here rather than resolved fuzzily.
 *
 * Dataset IDs (Socrata 4x4):
 *  - Building Permits ............. i98e-djp9
 *  - Electrical Permits .......... ftty-kx6y
 *  - Plumbing Permits ............ a6aw-rudh
 *  - Building Permit Contacts .... 3pee-9qhc
 *  - Electrical Permit Contacts .. fdm7-jqqf
 *  - Plumbing Permit Contacts .... k6kv-9kix
 *  - Building Inspections ........ vckc-dh2h
 *  - Plumbing Inspections ........ fuas-yurr
 *  - Building Addenda ............ 87xy-gk8d
 */

export type Trade = "building" | "electrical" | "plumbing";

export const TRADES: Trade[] = ["building", "electrical", "plumbing"];

/** Permit datasets carrying status/dates/block/lot/location, keyed by trade. */
export const PERMIT_DATASETS: Record<Trade, { id: string; label: string }> = {
  building: { id: "i98e-djp9", label: "Building Permits" },
  electrical: { id: "ftty-kx6y", label: "Electrical Permits" },
  plumbing: { id: "a6aw-rudh", label: "Plumbing Permits" },
};

/**
 * Per-dataset field mapping used to (a) read a contact's identity off an anchor
 * permit and (b) build the cross-trade matching `$where` clauses.
 */
export type ContactDatasetConfig = {
  id: string;
  label: string;
  trade: Trade;
  /** Column linking a contact row to its permit. */
  idField: string;
  /** Column(s) holding the firm/company name (token + exact matching target). */
  firmNameField: string;
  /** Person-name columns, if any (only the building dataset has these). */
  personNameFields: string[];
  /** CSLB license column(s). */
  licenseFields: string[];
  /** SF business license column. */
  sfBizField: string;
  /**
   * Column(s) holding the firm address. A single column ("firm_address" /
   * "address") is matched as `col LIKE %tokₙ%`; a two-column split
   * (electrical: street_number + street) maps token-1 → first column,
   * token-2 → second column.
   */
  firmAddressFields: string[];
};

export const CONTACT_DATASETS: Record<Trade, ContactDatasetConfig> = {
  building: {
    id: "3pee-9qhc",
    label: "Building Permit Contacts",
    trade: "building",
    idField: "permit_number",
    firmNameField: "firm_name",
    personNameFields: ["first_name", "last_name"],
    licenseFields: ["license1", "license2"],
    sfBizField: "sf_business_license_number",
    firmAddressFields: ["firm_address"],
  },
  electrical: {
    id: "fdm7-jqqf",
    label: "Electrical Permit Contacts",
    trade: "electrical",
    idField: "permit_number",
    firmNameField: "company_name",
    personNameFields: [],
    licenseFields: ["license_number"],
    sfBizField: "sf_business_license_number",
    firmAddressFields: ["street_number", "street"],
  },
  plumbing: {
    id: "k6kv-9kix",
    label: "Plumbing Permit Contacts",
    trade: "plumbing",
    idField: "permit_number",
    firmNameField: "firm_name",
    personNameFields: [],
    licenseFields: ["license_number"],
    sfBizField: "sf_business_license_number",
    firmAddressFields: ["address"],
  },
};

/**
 * Inspection datasets, keyed by trade. Inspections join to a permit via
 * `reference_number = <permit#> AND reference_number_type = 'permit'` and are
 * the strongest "actively on site" activity signal. No electrical inspections
 * dataset is published, so electrical activity falls back to permit dates.
 */
export const INSPECTION_DATASETS: Partial<Record<Trade, { id: string; label: string }>> = {
  building: { id: "vckc-dh2h", label: "Building Inspections" },
  plumbing: { id: "fuas-yurr", label: "Plumbing Inspections" },
};

/** Building addenda dataset — joins by `application_number`. */
export const ADDENDA_DATASET = { id: "87xy-gk8d", label: "Building Addenda" };
