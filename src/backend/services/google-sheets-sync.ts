import { and, count, desc, eq, inArray, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  budgetExpenseEntries,
  budgetFundingAccounts,
  budgetProjectInfo,
  budgetTrackerItemRooms,
  budgetTrackerItems,
  contractClauseFindings,
  contractMonitoringEvents,
  contractPaymentMilestones,
  contractRevisions,
  contractStatuses,
  contractTimelineMilestones,
  contracts,
  estimateCompanies,
  estimateCompanyContacts,
  estimateLineItems,
  estimateRevisions,
  estimateStatuses,
  estimates,
  googleSheetSyncEvents,
  remodelScenarios,
  rooms,
  scenarioRoomPlans,
} from "@backend/db";

export type SheetColumn = {
  key: string;
  label: string;
  type:
    | "text"
    | "currency_cents"
    | "number"
    | "boolean"
    | "date"
    | "datetime"
    | "id"
    | "enum";
  writable: boolean;
  description?: string;
};

export type WorkbookTabDefinition = {
  tab: string;
  label: string;
  writable: boolean;
  columns: SheetColumn[];
};

export type WorkbookRow = Record<string, string | number | boolean | null>;
export type WorkbookTabsPayload = Record<string, WorkbookRow[]>;

export type WorkbookPayload = {
  meta: {
    generatedAt: string;
    cursor: string;
    syncHash: string;
    source: "d1";
  };
  tabs: WorkbookTabsPayload;
};

export const GOOGLE_SHEETS_WORKBOOK_TEMPLATE: WorkbookTabDefinition[] = [
  {
    tab: "Project_Information",
    label: "Project Information",
    writable: true,
    columns: [
      { key: "info_key", label: "Field Key", type: "text", writable: false },
      { key: "info_label", label: "Field", type: "text", writable: false },
      { key: "info_value", label: "Value", type: "text", writable: true },
      { key: "notes", label: "Notes", type: "text", writable: true },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Financial_Status",
    label: "Financial Status",
    writable: true,
    columns: [
      { key: "line_type", label: "Line Type", type: "enum", writable: false },
      { key: "account_key", label: "Account Key", type: "text", writable: false },
      { key: "label", label: "Label", type: "text", writable: true },
      { key: "amount_cents", label: "Amount (cents)", type: "currency_cents", writable: true },
      { key: "value_text", label: "Value Text", type: "text", writable: false },
      { key: "notes", label: "Notes", type: "text", writable: true },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Itemized_Expenses",
    label: "Itemized Expenses",
    writable: true,
    columns: [
      { key: "track_id", label: "Track ID", type: "id", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "revision_number", label: "Revision #", type: "number", writable: false },
      { key: "is_active", label: "Is Active", type: "boolean", writable: false },
      { key: "is_draft", label: "Is Draft", type: "boolean", writable: true },
      { key: "item", label: "Item", type: "text", writable: true },
      { key: "category", label: "Category", type: "text", writable: true },
      { key: "amount_cents", label: "Amount (cents)", type: "currency_cents", writable: true },
      { key: "vendor_name", label: "Vendor", type: "text", writable: true },
      { key: "scenario_id", label: "Scenario ID", type: "id", writable: true },
      { key: "option_group", label: "Option Group", type: "text", writable: true },
      { key: "option_key", label: "Option Key", type: "text", writable: true },
      { key: "source_type", label: "Source Type", type: "text", writable: true },
      { key: "source_ref", label: "Source Ref", type: "text", writable: true },
      { key: "date_incurred", label: "Date Incurred", type: "date", writable: true },
      { key: "notes", label: "Notes", type: "text", writable: true },
      { key: "row_hash", label: "Row Hash", type: "text", writable: false },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Category_Summary",
    label: "Category Summary",
    writable: false,
    columns: [
      { key: "category", label: "Category", type: "text", writable: false },
      { key: "item_count", label: "Item Count", type: "number", writable: false },
      { key: "total_amount_cents", label: "Total (cents)", type: "currency_cents", writable: false },
    ],
  },
  {
    tab: "Variance_Options",
    label: "Variance Options",
    writable: false,
    columns: [
      { key: "option_group", label: "Option Group", type: "text", writable: false },
      { key: "option_key", label: "Option Key", type: "text", writable: false },
      { key: "item_count", label: "Item Count", type: "number", writable: false },
      { key: "base_low_cents", label: "Base Low (cents)", type: "currency_cents", writable: false },
      { key: "base_high_cents", label: "Base High (cents)", type: "currency_cents", writable: false },
      { key: "low_sum_cents", label: "Low Sum (cents)", type: "currency_cents", writable: false },
      { key: "high_sum_cents", label: "High Sum (cents)", type: "currency_cents", writable: false },
      { key: "projected_total_low_cents", label: "Projected Low (cents)", type: "currency_cents", writable: false },
      { key: "projected_total_high_cents", label: "Projected High (cents)", type: "currency_cents", writable: false },
      { key: "expense_count", label: "Expenses Count", type: "number", writable: false },
      { key: "expense_total_cents", label: "Expenses Total (cents)", type: "currency_cents", writable: false },
      { key: "status_mix", label: "Status Mix", type: "text", writable: false },
    ],
  },
  {
    tab: "Budget_Items",
    label: "Budget Items",
    writable: true,
    columns: [
      { key: "track_id", label: "Track ID", type: "id", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "revision_number", label: "Revision #", type: "number", writable: false },
      { key: "is_active", label: "Is Active", type: "boolean", writable: false },
      { key: "is_draft", label: "Is Draft", type: "boolean", writable: true },
      { key: "item_type", label: "Item Type", type: "enum", writable: true },
      { key: "execution_class", label: "Execution Class", type: "enum", writable: true },
      { key: "option_group", label: "Option Group", type: "text", writable: true },
      { key: "option_key", label: "Option Key", type: "text", writable: true },
      { key: "status", label: "Status", type: "enum", writable: true },
      { key: "risk_level", label: "Risk Level", type: "enum", writable: true },
      { key: "is_bottleneck", label: "Bottleneck", type: "boolean", writable: true },
      { key: "bottleneck_reason", label: "Bottleneck Reason", type: "text", writable: true },
      { key: "title", label: "Title", type: "text", writable: true },
      { key: "description", label: "Description", type: "text", writable: true },
      { key: "scenario_id", label: "Scenario ID", type: "id", writable: true },
      { key: "room_ids", label: "Room IDs", type: "text", writable: true },
      { key: "estimated_low_cents", label: "Est. Low (cents)", type: "currency_cents", writable: true },
      { key: "estimated_high_cents", label: "Est. High (cents)", type: "currency_cents", writable: true },
      { key: "owner", label: "Owner", type: "text", writable: true },
      { key: "ai_rationale", label: "AI Rationale", type: "text", writable: true },
      { key: "change_source", label: "Change Source", type: "text", writable: true },
      { key: "changed_by", label: "Changed By", type: "text", writable: true },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
      { key: "row_hash", label: "Row Hash", type: "text", writable: false },
    ],
  },
  {
    tab: "Decision_Gates",
    label: "Decision Gates",
    writable: false,
    columns: [
      { key: "track_id", label: "Track ID", type: "id", writable: false },
      { key: "title", label: "Decision Gate", type: "text", writable: false },
      { key: "status", label: "Status", type: "enum", writable: false },
      { key: "risk_level", label: "Risk", type: "enum", writable: false },
      { key: "bottleneck_reason", label: "Why It Matters", type: "text", writable: false },
      { key: "estimated_low_cents", label: "Low (cents)", type: "currency_cents", writable: false },
      { key: "estimated_high_cents", label: "High (cents)", type: "currency_cents", writable: false },
    ],
  },
  {
    tab: "Scenario_Options",
    label: "Scenario Options",
    writable: false,
    columns: [
      { key: "scenario_id", label: "Scenario ID", type: "id", writable: false },
      { key: "scenario_name", label: "Scenario Name", type: "text", writable: false },
      { key: "status", label: "Status", type: "enum", writable: false },
      { key: "budget_low_cents", label: "Budget Low (cents)", type: "currency_cents", writable: false },
      { key: "budget_high_cents", label: "Budget High (cents)", type: "currency_cents", writable: false },
      { key: "room_plan_count", label: "Room Plan Count", type: "number", writable: false },
      { key: "decision_notes", label: "Decision Notes", type: "text", writable: false },
    ],
  },
  {
    tab: "Professional_Services",
    label: "Professional Services",
    writable: false,
    columns: [
      { key: "company_id", label: "Company ID", type: "id", writable: false },
      { key: "name", label: "Name", type: "text", writable: false },
      { key: "business_type", label: "Business Type", type: "text", writable: false },
      { key: "website", label: "Website", type: "text", writable: false },
      { key: "email", label: "Email", type: "text", writable: false },
      { key: "phone", label: "Phone", type: "text", writable: false },
      { key: "cslb_license_number", label: "CSLB", type: "text", writable: false },
      { key: "is_active", label: "Is Active", type: "boolean", writable: false },
    ],
  },
  {
    tab: "Estimates_Latest",
    label: "Estimates Latest",
    writable: false,
    columns: [
      { key: "estimate_id", label: "Estimate ID", type: "id", writable: false },
      { key: "company_id", label: "Company ID", type: "id", writable: false },
      { key: "scenario_id", label: "Scenario ID", type: "id", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "revision_number", label: "Revision #", type: "number", writable: false },
      { key: "is_draft", label: "Is Draft", type: "boolean", writable: false },
      { key: "is_latest", label: "Is Latest", type: "boolean", writable: false },
      { key: "status_notes", label: "Status Notes", type: "text", writable: false },
      { key: "total_amount_cents", label: "Total (cents)", type: "currency_cents", writable: false },
      { key: "total_tax_cents", label: "Tax (cents)", type: "currency_cents", writable: false },
      { key: "deposit_amount_cents", label: "Deposit (cents)", type: "currency_cents", writable: false },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Estimate_Line_Items",
    label: "Estimate Line Items",
    writable: false,
    columns: [
      { key: "line_item_id", label: "Line Item ID", type: "id", writable: false },
      { key: "estimate_id", label: "Estimate ID", type: "id", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "item_code", label: "Item Code", type: "text", writable: false },
      { key: "description", label: "Description", type: "text", writable: false },
      { key: "qty", label: "Qty", type: "number", writable: false },
      { key: "uom", label: "UOM", type: "text", writable: false },
      { key: "unit_cost_cents", label: "Unit Cost (cents)", type: "currency_cents", writable: false },
      { key: "line_total_cents", label: "Line Total (cents)", type: "currency_cents", writable: false },
      { key: "tax_cents", label: "Tax (cents)", type: "currency_cents", writable: false },
    ],
  },
  {
    tab: "Contracts_Latest",
    label: "Contracts Latest",
    writable: false,
    columns: [
      { key: "contract_id", label: "Contract ID", type: "id", writable: false },
      { key: "company_id", label: "Company ID", type: "id", writable: false },
      { key: "linked_estimate_id", label: "Linked Estimate ID", type: "id", writable: false },
      { key: "scenario_id", label: "Scenario ID", type: "id", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "revision_number", label: "Revision #", type: "number", writable: false },
      { key: "is_draft", label: "Is Draft", type: "boolean", writable: false },
      { key: "is_latest", label: "Is Latest", type: "boolean", writable: false },
      { key: "status_notes", label: "Status Notes", type: "text", writable: false },
      { key: "ai_rationale", label: "AI Rationale", type: "text", writable: false },
      { key: "contract_required", label: "Contract Required", type: "boolean", writable: false },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Estimate_Revisions_Log",
    label: "Estimate Revisions Log",
    writable: false,
    columns: [
      { key: "estimate_id", label: "Estimate ID", type: "id", writable: false },
      { key: "company_id", label: "Company ID", type: "id", writable: false },
      { key: "company_name", label: "Company", type: "text", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "revision_number", label: "Revision #", type: "number", writable: false },
      { key: "status_name", label: "Status", type: "text", writable: false },
      { key: "is_draft", label: "Is Draft", type: "boolean", writable: false },
      { key: "is_latest", label: "Is Latest", type: "boolean", writable: false },
      { key: "total_amount_cents", label: "Total (cents)", type: "currency_cents", writable: false },
      { key: "total_tax_cents", label: "Tax (cents)", type: "currency_cents", writable: false },
      { key: "deposit_amount_cents", label: "Deposit (cents)", type: "currency_cents", writable: false },
      { key: "change_source", label: "Change Source", type: "text", writable: false },
      { key: "created_by", label: "Created By", type: "text", writable: false },
      { key: "created_at", label: "Created At", type: "datetime", writable: false },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Contract_Revisions_Log",
    label: "Contract Revisions Log",
    writable: false,
    columns: [
      { key: "contract_id", label: "Contract ID", type: "id", writable: false },
      { key: "company_id", label: "Company ID", type: "id", writable: false },
      { key: "company_name", label: "Company", type: "text", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "revision_number", label: "Revision #", type: "number", writable: false },
      { key: "status_name", label: "Status", type: "text", writable: false },
      { key: "is_draft", label: "Is Draft", type: "boolean", writable: false },
      { key: "is_latest", label: "Is Latest", type: "boolean", writable: false },
      { key: "change_source", label: "Change Source", type: "text", writable: false },
      { key: "created_by", label: "Created By", type: "text", writable: false },
      { key: "status_notes", label: "Status Notes", type: "text", writable: false },
      { key: "ai_rationale", label: "AI Rationale", type: "text", writable: false },
      { key: "created_at", label: "Created At", type: "datetime", writable: false },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Budget_Item_Revisions",
    label: "Budget Item Revisions",
    writable: false,
    columns: [
      { key: "track_id", label: "Track ID", type: "id", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "revision_number", label: "Revision #", type: "number", writable: false },
      { key: "is_active", label: "Is Active", type: "boolean", writable: false },
      { key: "is_draft", label: "Is Draft", type: "boolean", writable: false },
      { key: "replaced_by_revision_id", label: "Replaced By Revision", type: "id", writable: false },
      { key: "replaced_at", label: "Replaced At", type: "datetime", writable: false },
      { key: "item_type", label: "Item Type", type: "text", writable: false },
      { key: "execution_class", label: "Execution Class", type: "text", writable: false },
      { key: "status", label: "Status", type: "text", writable: false },
      { key: "risk_level", label: "Risk Level", type: "text", writable: false },
      { key: "is_bottleneck", label: "Bottleneck", type: "boolean", writable: false },
      { key: "title", label: "Title", type: "text", writable: false },
      { key: "scenario_id", label: "Scenario ID", type: "id", writable: false },
      { key: "estimated_low_cents", label: "Est. Low (cents)", type: "currency_cents", writable: false },
      { key: "estimated_high_cents", label: "Est. High (cents)", type: "currency_cents", writable: false },
      { key: "change_source", label: "Change Source", type: "text", writable: false },
      { key: "changed_by", label: "Changed By", type: "text", writable: false },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Expense_Revisions",
    label: "Expense Revisions",
    writable: false,
    columns: [
      { key: "track_id", label: "Track ID", type: "id", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "revision_number", label: "Revision #", type: "number", writable: false },
      { key: "is_active", label: "Is Active", type: "boolean", writable: false },
      { key: "is_draft", label: "Is Draft", type: "boolean", writable: false },
      { key: "replaced_by_revision_id", label: "Replaced By Revision", type: "id", writable: false },
      { key: "replaced_at", label: "Replaced At", type: "datetime", writable: false },
      { key: "item", label: "Item", type: "text", writable: false },
      { key: "category", label: "Category", type: "text", writable: false },
      { key: "amount_cents", label: "Amount (cents)", type: "currency_cents", writable: false },
      { key: "vendor_name", label: "Vendor", type: "text", writable: false },
      { key: "scenario_id", label: "Scenario ID", type: "id", writable: false },
      { key: "change_source", label: "Change Source", type: "text", writable: false },
      { key: "changed_by", label: "Changed By", type: "text", writable: false },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Contract_Risk_Findings",
    label: "Contract Risk Findings",
    writable: false,
    columns: [
      { key: "contract_id", label: "Contract ID", type: "id", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "clause_type", label: "Clause Type", type: "text", writable: false },
      { key: "risk_level", label: "Risk Level", type: "text", writable: false },
      { key: "finding_text", label: "Finding", type: "text", writable: false },
      { key: "recommendation", label: "Recommendation", type: "text", writable: false },
      { key: "source_snippet", label: "Source Snippet", type: "text", writable: false },
      { key: "created_at", label: "Created At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Contract_Monitoring_Events",
    label: "Contract Monitoring Events",
    writable: false,
    columns: [
      { key: "contract_id", label: "Contract ID", type: "id", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "event_type", label: "Event Type", type: "text", writable: false },
      { key: "source", label: "Source", type: "text", writable: false },
      { key: "summary", label: "Summary", type: "text", writable: false },
      { key: "created_at", label: "Created At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Contract_Payment_Milestones",
    label: "Contract Payment Milestones",
    writable: false,
    columns: [
      { key: "contract_id", label: "Contract ID", type: "id", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "milestone_name", label: "Milestone", type: "text", writable: false },
      { key: "due_criteria", label: "Due Criteria", type: "text", writable: false },
      { key: "amount_cents", label: "Amount (cents)", type: "currency_cents", writable: false },
      { key: "approval_status", label: "Approval Status", type: "text", writable: false },
      { key: "due_start_at", label: "Due Start", type: "datetime", writable: false },
      { key: "due_end_at", label: "Due End", type: "datetime", writable: false },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Contract_Timeline_Milestones",
    label: "Contract Timeline Milestones",
    writable: false,
    columns: [
      { key: "contract_id", label: "Contract ID", type: "id", writable: false },
      { key: "revision_id", label: "Revision ID", type: "id", writable: false },
      { key: "milestone_name", label: "Milestone", type: "text", writable: false },
      { key: "planned_at", label: "Planned At", type: "datetime", writable: false },
      { key: "actual_at", label: "Actual At", type: "datetime", writable: false },
      { key: "delay_reason", label: "Delay Reason", type: "text", writable: false },
      { key: "notice_window", label: "Notice Window", type: "text", writable: false },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Estimate_Contacts",
    label: "Estimate Contacts",
    writable: false,
    columns: [
      { key: "contact_id", label: "Contact ID", type: "id", writable: false },
      { key: "company_id", label: "Company ID", type: "id", writable: false },
      { key: "company_name", label: "Company", type: "text", writable: false },
      { key: "name", label: "Name", type: "text", writable: false },
      { key: "title", label: "Title", type: "text", writable: false },
      { key: "email", label: "Email", type: "text", writable: false },
      { key: "phone", label: "Phone", type: "text", writable: false },
      { key: "source", label: "Source", type: "text", writable: false },
      { key: "mapping_status", label: "Mapping Status", type: "text", writable: false },
      { key: "updated_at", label: "Updated At", type: "datetime", writable: false },
    ],
  },
  {
    tab: "Rooms",
    label: "Rooms",
    writable: false,
    columns: [
      { key: "room_id", label: "Room ID", type: "id", writable: false },
      { key: "room_code", label: "Room Code", type: "text", writable: false },
      { key: "room_name", label: "Room Name", type: "text", writable: false },
      { key: "as_is_use", label: "As-Is Use", type: "text", writable: false },
      { key: "is_living_space", label: "Living Space", type: "boolean", writable: false },
      { key: "length_ft", label: "Length (ft)", type: "number", writable: false },
      { key: "length_in", label: "Length (in)", type: "number", writable: false },
      { key: "width_ft", label: "Width (ft)", type: "number", writable: false },
      { key: "width_in", label: "Width (in)", type: "number", writable: false },
    ],
  },
  {
    tab: "Budget_Summary",
    label: "Budget Summary",
    writable: false,
    columns: [
      { key: "grouping", label: "Grouping", type: "text", writable: false },
      { key: "execution_class", label: "Execution Class", type: "enum", writable: false },
      { key: "item_count", label: "Item Count", type: "number", writable: false },
      { key: "low_sum_cents", label: "Low Sum (cents)", type: "currency_cents", writable: false },
      { key: "high_sum_cents", label: "High Sum (cents)", type: "currency_cents", writable: false },
    ],
  },
];

export const REFERENCE_SHEET_FINDINGS = [
  {
    spreadsheetId: "local-csv-1",
    title: "Book 4(Budget summary).csv",
    notes:
      "Parsed sections: Project Information + Financial Status with account totals (cash, financed, allotted, used, remaining). Mirrored as Project_Information + Financial_Status tabs.",
  },
  {
    spreadsheetId: "local-csv-2",
    title: "Book 4(Itemized expenses).csv",
    notes:
      "Parsed columns: Item, Category, Amount with labor/material mix and funds snapshot header. Mirrored as writable Itemized_Expenses plus computed Category_Summary.",
  },
  {
    spreadsheetId: "1q4f_tcH8WzohE-N9WmIFXjXqE8qO5kOOjH9jF14p0-0",
    title: "126 Colby - Progress Tracker",
    notes:
      "Strong task/status cadence and owner/date tracking; costs are in a separate tab and should stay relational in D1.",
  },
  {
    spreadsheetId: "1Qy7BBePxDCnfLuvCriHJ7gf27MT7h7gu8XL6EA_X-Wo",
    title: "Expense tracker",
    notes:
      "Useful long-form expense log pattern; category + vendor + insurance coverage columns are valuable for mirrored UI rows.",
  },
  {
    spreadsheetId: "1wkOjrVdVqq_uhwXb7Pl_UMm8NU_R58HjLamdeTQGuEg",
    title: "Preliminary Cost of Repair",
    notes:
      "B2R vs actual vs insurance comparisons are a good model for optional 'compare bids' slices in future tabs.",
  },
];

function toIso(value: Date | number | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "y" || normalized === "yes";
  }
  return false;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return String(value);
}

function toCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (!Number.isInteger(value)) return Math.round(value * 100);
    return Math.round(value);
  }
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  const looksLikeDollars = /[$,.]/.test(value);
  return looksLikeDollars ? Math.round(parsed * 100) : Math.round(parsed);
}

function toTimestamp(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const asDate = new Date(value);
    return Number.isNaN(asDate.getTime()) ? null : asDate;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asDate = new Date(trimmed);
    return Number.isNaN(asDate.getTime()) ? null : asDate;
  }
  return null;
}

function parseRoomIds(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => Number.parseInt(String(entry), 10))
      .filter((entry) => Number.isFinite(entry));
  }
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isFinite(entry));
}

async function hashValue(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function budgetItemRowHash(row: {
  title: string;
  description: string | null;
  itemType: string;
  executionClass: string;
  optionGroup: string | null;
  optionKey: string | null;
  status: string;
  riskLevel: string;
  isBottleneck: boolean;
  bottleneckReason: string | null;
  estimatedLowCents: number | null;
  estimatedHighCents: number | null;
  scenarioId: string | null;
  owner: string | null;
  aiRationale: string | null;
}): Promise<string> {
  return hashValue(
    JSON.stringify({
      title: row.title,
      description: row.description,
      itemType: row.itemType,
      executionClass: row.executionClass,
      optionGroup: row.optionGroup,
      optionKey: row.optionKey,
      status: row.status,
      riskLevel: row.riskLevel,
      isBottleneck: row.isBottleneck,
      bottleneckReason: row.bottleneckReason,
      estimatedLowCents: row.estimatedLowCents,
      estimatedHighCents: row.estimatedHighCents,
      scenarioId: row.scenarioId,
      owner: row.owner,
      aiRationale: row.aiRationale,
    }),
  );
}

async function expenseRowHash(row: {
  item: string;
  category: string;
  amountCents: number;
  vendorName: string | null;
  scenarioId: string | null;
  optionGroup: string | null;
  optionKey: string | null;
  sourceType: string;
  sourceRef: string | null;
  notes: string | null;
  dateIncurred: Date | number | null;
}): Promise<string> {
  return hashValue(
    JSON.stringify({
      item: row.item,
      category: row.category,
      amountCents: row.amountCents,
      vendorName: row.vendorName,
      scenarioId: row.scenarioId,
      optionGroup: row.optionGroup,
      optionKey: row.optionKey,
      sourceType: row.sourceType,
      sourceRef: row.sourceRef,
      notes: row.notes,
      dateIncurred: toIso(row.dateIncurred),
    }),
  );
}

async function nextBudgetRevisionNumber(db: ReturnType<typeof drizzle>, trackId: string): Promise<number> {
  const row = await db
    .select({ revision: max(budgetTrackerItems.revisionNumber) })
    .from(budgetTrackerItems)
    .where(eq(budgetTrackerItems.trackId, trackId))
    .get();
  return (row?.revision || 0) + 1;
}

async function nextExpenseRevisionNumber(db: ReturnType<typeof drizzle>, trackId: string): Promise<number> {
  const row = await db
    .select({ revision: max(budgetExpenseEntries.revisionNumber) })
    .from(budgetExpenseEntries)
    .where(eq(budgetExpenseEntries.trackId, trackId))
    .get();
  return (row?.revision || 0) + 1;
}

export async function buildGoogleSheetsWorkbook(env: Env): Promise<WorkbookPayload> {
  const db = drizzle(env.DB);
  const generatedAt = new Date();
  const cursor = generatedAt.toISOString();

  const projectInfoDefaults = [
    { infoKey: "project_name", infoLabel: "Project name", infoValue: "126 Colby Remodel", notes: null as string | null },
    { infoKey: "project_description", infoLabel: "Project description", infoValue: null as string | null, notes: null as string | null },
    { infoKey: "contractor_name", infoLabel: "Contractor", infoValue: null as string | null, notes: null as string | null },
    { infoKey: "license_number", infoLabel: "Licensed/Bonded number", infoValue: null as string | null, notes: null as string | null },
    { infoKey: "contact_name", infoLabel: "Contact name", infoValue: null as string | null, notes: null as string | null },
    { infoKey: "website", infoLabel: "Website", infoValue: null as string | null, notes: null as string | null },
    { infoKey: "phone", infoLabel: "Phone", infoValue: null as string | null, notes: null as string | null },
    { infoKey: "address", infoLabel: "Address", infoValue: null as string | null, notes: null as string | null },
  ];

  const projectInfoRowsDb = await db
    .select()
    .from(budgetProjectInfo)
    .orderBy(budgetProjectInfo.id)
    .all();
  const projectInfoByKey = new Map(projectInfoRowsDb.map((row) => [row.infoKey, row]));
  const projectInformationRows: WorkbookRow[] = projectInfoDefaults.map((entry) => {
    const row = projectInfoByKey.get(entry.infoKey);
    return {
      info_key: entry.infoKey,
      info_label: row?.infoLabel || entry.infoLabel,
      info_value: row?.infoValue ?? entry.infoValue,
      notes: row?.notes ?? entry.notes,
      updated_at: toIso(row?.datetimeUpdated),
    };
  });

  const fundingAccounts = await db
    .select()
    .from(budgetFundingAccounts)
    .orderBy(budgetFundingAccounts.id)
    .all();

  const activeExpenses = await db
    .select()
    .from(budgetExpenseEntries)
    .where(eq(budgetExpenseEntries.isActive, true))
    .orderBy(desc(budgetExpenseEntries.datetimeUpdated))
    .all();
  const allExpenseRevisions = await db
    .select()
    .from(budgetExpenseEntries)
    .orderBy(desc(budgetExpenseEntries.datetimeUpdated))
    .all();

  const activeBudgetItems = await db
    .select()
    .from(budgetTrackerItems)
    .where(eq(budgetTrackerItems.isActive, true))
    .orderBy(desc(budgetTrackerItems.isBottleneck), desc(budgetTrackerItems.datetimeUpdated))
    .all();
  const allBudgetItemRevisions = await db
    .select()
    .from(budgetTrackerItems)
    .orderBy(desc(budgetTrackerItems.datetimeUpdated))
    .all();

  const budgetItemIds = activeBudgetItems.map((row) => row.id);
  const budgetItemRoomLinks =
    budgetItemIds.length > 0
      ? await db
          .select({
            budgetTrackerItemId: budgetTrackerItemRooms.budgetTrackerItemId,
            roomId: budgetTrackerItemRooms.roomId,
          })
          .from(budgetTrackerItemRooms)
          .where(inArray(budgetTrackerItemRooms.budgetTrackerItemId, budgetItemIds))
          .all()
      : [];
  const roomIdsByBudgetItemId = new Map<number, number[]>();
  for (const link of budgetItemRoomLinks) {
    const list = roomIdsByBudgetItemId.get(link.budgetTrackerItemId) || [];
    list.push(link.roomId);
    roomIdsByBudgetItemId.set(link.budgetTrackerItemId, list);
  }

  const budgetItemsRows: WorkbookRow[] = [];
  for (const row of activeBudgetItems) {
    const rowHash = await budgetItemRowHash(row);
    budgetItemsRows.push({
      track_id: row.trackId,
      revision_id: row.id,
      revision_number: row.revisionNumber,
      is_active: row.isActive,
      is_draft: row.isDraft,
      item_type: row.itemType,
      execution_class: row.executionClass,
      option_group: row.optionGroup,
      option_key: row.optionKey,
      status: row.status,
      risk_level: row.riskLevel,
      is_bottleneck: row.isBottleneck,
      bottleneck_reason: row.bottleneckReason,
      title: row.title,
      description: row.description,
      scenario_id: row.scenarioId,
      room_ids: (roomIdsByBudgetItemId.get(row.id) || []).join(","),
      estimated_low_cents: row.estimatedLowCents,
      estimated_high_cents: row.estimatedHighCents,
      owner: row.owner,
      ai_rationale: row.aiRationale,
      change_source: row.changeSource,
      changed_by: row.changedBy,
      updated_at: toIso(row.datetimeUpdated),
      row_hash: rowHash,
    });
  }

  const itemizedExpenseRows: WorkbookRow[] = [];
  for (const expense of activeExpenses) {
    const rowHash = await expenseRowHash({
      item: expense.item,
      category: expense.category,
      amountCents: expense.amountCents,
      vendorName: expense.vendorName,
      scenarioId: expense.scenarioId,
      optionGroup: expense.optionGroup,
      optionKey: expense.optionKey,
      sourceType: expense.sourceType,
      sourceRef: expense.sourceRef,
      notes: expense.notes,
      dateIncurred: expense.dateIncurred,
    });
    itemizedExpenseRows.push({
      track_id: expense.trackId,
      revision_id: expense.id,
      revision_number: expense.revisionNumber,
      is_active: expense.isActive,
      is_draft: expense.isDraft,
      item: expense.item,
      category: expense.category,
      amount_cents: expense.amountCents,
      vendor_name: expense.vendorName,
      scenario_id: expense.scenarioId,
      option_group: expense.optionGroup,
      option_key: expense.optionKey,
      source_type: expense.sourceType,
      source_ref: expense.sourceRef,
      date_incurred: toIso(expense.dateIncurred),
      notes: expense.notes,
      row_hash: rowHash,
      updated_at: toIso(expense.datetimeUpdated),
    });
  }

  const totalAllottedFundsCents = fundingAccounts.reduce(
    (sumValue, row) => sumValue + row.amountCents,
    0,
  );
  const totalUsedFundsCents = activeExpenses.reduce(
    (sumValue, row) => sumValue + row.amountCents,
    0,
  );
  const fundsRemainingCents = totalAllottedFundsCents - totalUsedFundsCents;

  const financialStatusRows: WorkbookRow[] = [
    ...fundingAccounts.map((row) => ({
      line_type: "account",
      account_key: row.accountKey,
      label: row.accountLabel,
      amount_cents: row.amountCents,
      value_text: null,
      notes: row.notes,
      updated_at: toIso(row.datetimeUpdated),
    })),
    {
      line_type: "metric",
      account_key: "total_allotted_funds",
      label: "Total allotted funds",
      amount_cents: totalAllottedFundsCents,
      value_text: null,
      notes: null,
      updated_at: generatedAt.toISOString(),
    },
    {
      line_type: "metric",
      account_key: "funds_used_to_date",
      label: "Funds used to date",
      amount_cents: totalUsedFundsCents,
      value_text: null,
      notes: null,
      updated_at: generatedAt.toISOString(),
    },
    {
      line_type: "metric",
      account_key: "funds_remaining",
      label: "Funds remaining",
      amount_cents: fundsRemainingCents,
      value_text: null,
      notes: null,
      updated_at: generatedAt.toISOString(),
    },
  ];

  const decisionGatesRows = budgetItemsRows
    .filter((row) => row.is_bottleneck === true)
    .map((row) => ({
      track_id: row.track_id,
      title: row.title,
      status: row.status,
      risk_level: row.risk_level,
      bottleneck_reason: row.bottleneck_reason,
      estimated_low_cents: row.estimated_low_cents,
      estimated_high_cents: row.estimated_high_cents,
    }));

  const scenarioRows = await db
    .select()
    .from(remodelScenarios)
    .orderBy(desc(remodelScenarios.datetimeUpdated))
    .all();
  const scenarioIds = scenarioRows.map((row) => row.id);
  const scenarioPlanCounts =
    scenarioIds.length > 0
      ? await db
          .select({
            scenarioId: scenarioRoomPlans.scenarioId,
            count: count(),
          })
          .from(scenarioRoomPlans)
          .groupBy(scenarioRoomPlans.scenarioId)
          .where(inArray(scenarioRoomPlans.scenarioId, scenarioIds))
          .all()
      : [];
  const planCountByScenarioId = new Map<string, number>();
  for (const countRow of scenarioPlanCounts) {
    planCountByScenarioId.set(countRow.scenarioId, Number(countRow.count || 0));
  }

  const scenarioOptionsRows: WorkbookRow[] = scenarioRows.map((row) => ({
    scenario_id: row.id,
    scenario_name: row.name,
    status: row.status,
    budget_low_cents: row.budgetLowCents,
    budget_high_cents: row.budgetHighCents,
    room_plan_count: planCountByScenarioId.get(row.id) || 0,
    decision_notes: row.decisionNotes,
  }));

  const companyRows = await db
    .select()
    .from(estimateCompanies)
    .orderBy(desc(estimateCompanies.datetimeUpdated))
    .all();
  const companyById = new Map(companyRows.map((row) => [row.id, row]));

  const professionalServicesRows = companyRows
    .filter((company) => {
      const type = (company.businessType || "").toLowerCase();
      return (
        type.includes("architect") ||
        type.includes("engineer") ||
        type.includes("contractor") ||
        type.includes("subcontractor") ||
        type.includes("service")
      );
    })
    .map((company) => ({
      company_id: company.id,
      name: company.name,
      business_type: company.businessType,
      website: company.website,
      email: company.email,
      phone: company.phone,
      cslb_license_number: company.cslbLicenseNumber,
      is_active: company.isActive,
    }));

  const estimateRows = await db.select().from(estimates).orderBy(desc(estimates.datetimeUpdated)).all();
  const estimateById = new Map(estimateRows.map((row) => [row.id, row]));
  const estimateStatusRows = await db.select().from(estimateStatuses).all();
  const estimateStatusById = new Map(estimateStatusRows.map((row) => [row.id, row]));
  const latestEstimateRevisions = await db
    .select()
    .from(estimateRevisions)
    .where(eq(estimateRevisions.isLatest, true))
    .all();
  const allEstimateRevisions = await db
    .select()
    .from(estimateRevisions)
    .orderBy(desc(estimateRevisions.datetimeUpdated))
    .all();
  const latestEstimateRevisionByEstimateId = new Map(
    latestEstimateRevisions.map((revision) => [revision.estimateId, revision]),
  );

  const estimatesLatestRows: WorkbookRow[] = estimateRows.map((estimate) => {
    const revision = latestEstimateRevisionByEstimateId.get(estimate.id);
    return {
      estimate_id: estimate.id,
      company_id: estimate.estimateCompanyId,
      scenario_id: estimate.scenarioId,
      revision_id: revision?.id || null,
      revision_number: revision?.revisionNumber || null,
      is_draft: revision?.isDraft || false,
      is_latest: revision?.isLatest || false,
      status_notes: revision?.statusNotes || null,
      total_amount_cents: revision?.totalAmountCents || null,
      total_tax_cents: revision?.totalTaxCents || null,
      deposit_amount_cents: revision?.depositAmountCents || null,
      updated_at: toIso(revision?.datetimeUpdated || estimate.datetimeUpdated),
    };
  });

  const estimateRevisionLogRows: WorkbookRow[] = allEstimateRevisions.map((revision) => {
    const estimate = estimateById.get(revision.estimateId);
    const company = estimate?.estimateCompanyId
      ? companyById.get(estimate.estimateCompanyId) || null
      : null;
    const statusName = revision.estimateStatusId
      ? estimateStatusById.get(revision.estimateStatusId)?.name || null
      : null;
    return {
      estimate_id: revision.estimateId,
      company_id: estimate?.estimateCompanyId || null,
      company_name: company?.name || null,
      revision_id: revision.id,
      revision_number: revision.revisionNumber,
      status_name: statusName,
      is_draft: revision.isDraft,
      is_latest: revision.isLatest,
      total_amount_cents: revision.totalAmountCents,
      total_tax_cents: revision.totalTaxCents,
      deposit_amount_cents: revision.depositAmountCents,
      change_source: revision.changeSource,
      created_by: revision.createdBy,
      created_at: toIso(revision.datetimeCreated),
      updated_at: toIso(revision.datetimeUpdated),
    };
  });

  const latestEstimateRevisionIds = latestEstimateRevisions.map((revision) => revision.id);
  const latestLineItems =
    latestEstimateRevisionIds.length > 0
      ? await db
          .select()
          .from(estimateLineItems)
          .where(inArray(estimateLineItems.estimateRevisionId, latestEstimateRevisionIds))
          .all()
      : [];
  const estimateIdByRevisionId = new Map(latestEstimateRevisions.map((row) => [row.id, row.estimateId]));
  const estimateLineItemRows: WorkbookRow[] = latestLineItems.map((item) => ({
    line_item_id: item.id,
    estimate_id: estimateIdByRevisionId.get(item.estimateRevisionId) || null,
    revision_id: item.estimateRevisionId,
    item_code: item.itemCode,
    description: item.description,
    qty: item.qty,
    uom: item.uom,
    unit_cost_cents: item.unitCostCents,
    line_total_cents: item.lineTotalCents,
    tax_cents: item.taxCents,
  }));

  const contractRows = await db.select().from(contracts).orderBy(desc(contracts.datetimeUpdated)).all();
  const contractById = new Map(contractRows.map((row) => [row.id, row]));
  const contractStatusRows = await db.select().from(contractStatuses).all();
  const contractStatusById = new Map(contractStatusRows.map((row) => [row.id, row]));
  const latestContractRevisions = await db
    .select()
    .from(contractRevisions)
    .where(eq(contractRevisions.isLatest, true))
    .all();
  const allContractRevisions = await db
    .select()
    .from(contractRevisions)
    .orderBy(desc(contractRevisions.datetimeUpdated))
    .all();
  const latestContractRevisionByContractId = new Map(
    latestContractRevisions.map((revision) => [revision.contractId, revision]),
  );
  const contractIdByRevisionId = new Map(allContractRevisions.map((row) => [row.id, row.contractId]));
  const contractsLatestRows: WorkbookRow[] = contractRows.map((contract) => {
    const revision = latestContractRevisionByContractId.get(contract.id);
    return {
      contract_id: contract.id,
      company_id: contract.estimateCompanyId,
      linked_estimate_id: contract.linkedEstimateId,
      scenario_id: contract.scenarioId,
      revision_id: revision?.id || null,
      revision_number: revision?.revisionNumber || null,
      is_draft: revision?.isDraft || false,
      is_latest: revision?.isLatest || false,
      status_notes: revision?.statusNotes || null,
      ai_rationale: revision?.aiRationale || null,
      contract_required: contract.contractRequired,
      updated_at: toIso(revision?.datetimeUpdated || contract.datetimeUpdated),
    };
  });

  const contractRevisionLogRows: WorkbookRow[] = allContractRevisions.map((revision) => {
    const contract = contractById.get(revision.contractId);
    const company = contract?.estimateCompanyId
      ? companyById.get(contract.estimateCompanyId) || null
      : null;
    const statusName = revision.contractStatusId
      ? contractStatusById.get(revision.contractStatusId)?.name || null
      : null;
    return {
      contract_id: revision.contractId,
      company_id: contract?.estimateCompanyId || null,
      company_name: company?.name || null,
      revision_id: revision.id,
      revision_number: revision.revisionNumber,
      status_name: statusName,
      is_draft: revision.isDraft,
      is_latest: revision.isLatest,
      change_source: revision.changeSource,
      created_by: revision.createdBy,
      status_notes: revision.statusNotes,
      ai_rationale: revision.aiRationale,
      created_at: toIso(revision.datetimeCreated),
      updated_at: toIso(revision.datetimeUpdated),
    };
  });

  const contractRiskRows: WorkbookRow[] = (
    await db
      .select()
      .from(contractClauseFindings)
      .orderBy(desc(contractClauseFindings.datetimeCreated))
      .limit(500)
      .all()
  ).map((finding) => ({
    contract_id: contractIdByRevisionId.get(finding.contractRevisionId) || null,
    revision_id: finding.contractRevisionId,
    clause_type: finding.clauseType,
    risk_level: finding.riskLevel,
    finding_text: finding.findingText,
    recommendation: finding.recommendation,
    source_snippet: finding.sourceSnippet,
    created_at: toIso(finding.datetimeCreated),
  }));

  const contractMonitoringRows: WorkbookRow[] = (
    await db
      .select()
      .from(contractMonitoringEvents)
      .orderBy(desc(contractMonitoringEvents.datetimeCreated))
      .limit(500)
      .all()
  ).map((event) => ({
    contract_id: event.contractId,
    revision_id: event.contractRevisionId,
    event_type: event.eventType,
    source: event.source,
    summary: event.summary,
    created_at: toIso(event.datetimeCreated),
  }));

  const contractPaymentMilestoneRows: WorkbookRow[] = (
    await db
      .select()
      .from(contractPaymentMilestones)
      .orderBy(desc(contractPaymentMilestones.datetimeUpdated))
      .limit(500)
      .all()
  ).map((row) => ({
    contract_id: contractIdByRevisionId.get(row.contractRevisionId) || null,
    revision_id: row.contractRevisionId,
    milestone_name: row.milestoneName,
    due_criteria: row.dueCriteria,
    amount_cents: row.amountCents,
    approval_status: row.approvalStatus,
    due_start_at: toIso(row.dueStartAt),
    due_end_at: toIso(row.dueEndAt),
    updated_at: toIso(row.datetimeUpdated),
  }));

  const contractTimelineRows: WorkbookRow[] = (
    await db
      .select()
      .from(contractTimelineMilestones)
      .orderBy(desc(contractTimelineMilestones.datetimeUpdated))
      .limit(500)
      .all()
  ).map((row) => ({
    contract_id: contractIdByRevisionId.get(row.contractRevisionId) || null,
    revision_id: row.contractRevisionId,
    milestone_name: row.milestoneName,
    planned_at: toIso(row.plannedAt),
    actual_at: toIso(row.actualAt),
    delay_reason: row.delayReason,
    notice_window: row.noticeWindow,
    updated_at: toIso(row.datetimeUpdated),
  }));

  const budgetItemRevisionRows: WorkbookRow[] = allBudgetItemRevisions.map((row) => ({
    track_id: row.trackId,
    revision_id: row.id,
    revision_number: row.revisionNumber,
    is_active: row.isActive,
    is_draft: row.isDraft,
    replaced_by_revision_id: row.replacedByItemId,
    replaced_at: toIso(row.replacedAt),
    item_type: row.itemType,
    execution_class: row.executionClass,
    status: row.status,
    risk_level: row.riskLevel,
    is_bottleneck: row.isBottleneck,
    title: row.title,
    scenario_id: row.scenarioId,
    estimated_low_cents: row.estimatedLowCents,
    estimated_high_cents: row.estimatedHighCents,
    change_source: row.changeSource,
    changed_by: row.changedBy,
    updated_at: toIso(row.datetimeUpdated),
  }));

  const expenseRevisionRows: WorkbookRow[] = allExpenseRevisions.map((row) => ({
    track_id: row.trackId,
    revision_id: row.id,
    revision_number: row.revisionNumber,
    is_active: row.isActive,
    is_draft: row.isDraft,
    replaced_by_revision_id: row.replacedByExpenseId,
    replaced_at: toIso(row.replacedAt),
    item: row.item,
    category: row.category,
    amount_cents: row.amountCents,
    vendor_name: row.vendorName,
    scenario_id: row.scenarioId,
    change_source: row.changeSource,
    changed_by: row.changedBy,
    updated_at: toIso(row.datetimeUpdated),
  }));

  const contactRows = await db
    .select()
    .from(estimateCompanyContacts)
    .orderBy(desc(estimateCompanyContacts.datetimeUpdated))
    .all();
  const estimateContactRows: WorkbookRow[] = contactRows.map((row) => ({
    contact_id: row.id,
    company_id: row.estimateCompanyId,
    company_name: row.estimateCompanyId
      ? companyById.get(row.estimateCompanyId)?.name || null
      : null,
    name: row.name,
    title: row.title,
    email: row.email,
    phone: row.phone,
    source: row.source,
    mapping_status: row.mappingStatus,
    updated_at: toIso(row.datetimeUpdated),
  }));

  const roomRows = await db.select().from(rooms).orderBy(rooms.id).all();
  const roomsTabRows: WorkbookRow[] = roomRows.map((room) => ({
    room_id: room.id,
    room_code: room.roomCode,
    room_name: room.roomName,
    as_is_use: room.asIsUse,
    is_living_space: room.isLivingSpace,
    length_ft: room.lengthFeet,
    length_in: room.lengthInches,
    width_ft: room.widthFeet,
    width_in: room.widthInches,
  }));

  const summaryByClass = new Map<
    string,
    { itemCount: number; lowSumCents: number; highSumCents: number }
  >();
  for (const row of budgetItemsRows) {
    const key = String(row.execution_class || "unclassified");
    const current = summaryByClass.get(key) || { itemCount: 0, lowSumCents: 0, highSumCents: 0 };
    current.itemCount += 1;
    current.lowSumCents += Number(row.estimated_low_cents || 0);
    current.highSumCents += Number(row.estimated_high_cents || 0);
    summaryByClass.set(key, current);
  }
  const budgetSummaryRows: WorkbookRow[] = Array.from(summaryByClass.entries()).map(
    ([executionClass, summary]) => ({
      grouping: "execution_class",
      execution_class: executionClass,
      item_count: summary.itemCount,
      low_sum_cents: summary.lowSumCents,
      high_sum_cents: summary.highSumCents,
    }),
  );

  const categorySummaryMap = new Map<string, { itemCount: number; totalAmountCents: number }>();
  for (const row of itemizedExpenseRows) {
    const category = String(row.category || "general");
    const current = categorySummaryMap.get(category) || { itemCount: 0, totalAmountCents: 0 };
    current.itemCount += 1;
    current.totalAmountCents += Number(row.amount_cents || 0);
    categorySummaryMap.set(category, current);
  }
  const categorySummaryRows: WorkbookRow[] = Array.from(categorySummaryMap.entries()).map(
    ([category, summary]) => ({
      category,
      item_count: summary.itemCount,
      total_amount_cents: summary.totalAmountCents,
    }),
  );

  const varianceMap = new Map<
    string,
    {
      optionGroup: string;
      optionKey: string;
      itemCount: number;
      lowSumCents: number;
      highSumCents: number;
      statuses: Record<string, number>;
    }
  >();

  const basePlanLowCents = budgetItemsRows
    .filter((row) => String(row.execution_class || "") === "must_now")
    .reduce((sumValue, row) => sumValue + Number(row.estimated_low_cents || 0), 0);
  const basePlanHighCents = budgetItemsRows
    .filter((row) => String(row.execution_class || "") === "must_now")
    .reduce((sumValue, row) => sumValue + Number(row.estimated_high_cents || 0), 0);

  const expenseByOption = new Map<string, { count: number; totalCents: number }>();
  for (const expenseRow of itemizedExpenseRows) {
    const optionGroup = String(expenseRow.option_group || "");
    const optionKey = String(expenseRow.option_key || "");
    if (!optionGroup || !optionKey) continue;
    const key = `${optionGroup}::${optionKey}`;
    const current = expenseByOption.get(key) || { count: 0, totalCents: 0 };
    current.count += 1;
    current.totalCents += Number(expenseRow.amount_cents || 0);
    expenseByOption.set(key, current);
  }

  for (const row of budgetItemsRows) {
    const optionGroup = String(row.option_group || "");
    const optionKey = String(row.option_key || "");
    if (!optionGroup || !optionKey) continue;
    const key = `${optionGroup}::${optionKey}`;
    const current = varianceMap.get(key) || {
      optionGroup,
      optionKey,
      itemCount: 0,
      lowSumCents: 0,
      highSumCents: 0,
      statuses: {},
    };
    current.itemCount += 1;
    current.lowSumCents += Number(row.estimated_low_cents || 0);
    current.highSumCents += Number(row.estimated_high_cents || 0);
    const status = String(row.status || "open");
    current.statuses[status] = (current.statuses[status] || 0) + 1;
    varianceMap.set(key, current);
  }
  const varianceOptionsRows: WorkbookRow[] = Array.from(varianceMap.values()).map((row) => {
    const expenseStats = expenseByOption.get(`${row.optionGroup}::${row.optionKey}`) || {
      count: 0,
      totalCents: 0,
    };
    return {
      option_group: row.optionGroup,
      option_key: row.optionKey,
      item_count: row.itemCount,
      base_low_cents: basePlanLowCents,
      base_high_cents: basePlanHighCents,
      low_sum_cents: row.lowSumCents,
      high_sum_cents: row.highSumCents,
      projected_total_low_cents: basePlanLowCents + row.lowSumCents,
      projected_total_high_cents: basePlanHighCents + row.highSumCents,
      expense_count: expenseStats.count,
      expense_total_cents: expenseStats.totalCents,
      status_mix: Object.entries(row.statuses)
        .map(([status, count]) => `${status}:${count}`)
        .join(", "),
    };
  });

  const tabs: WorkbookTabsPayload = {
    Project_Information: projectInformationRows,
    Financial_Status: financialStatusRows,
    Itemized_Expenses: itemizedExpenseRows,
    Category_Summary: categorySummaryRows,
    Variance_Options: varianceOptionsRows,
    Budget_Items: budgetItemsRows,
    Decision_Gates: decisionGatesRows,
    Scenario_Options: scenarioOptionsRows,
    Professional_Services: professionalServicesRows,
    Estimates_Latest: estimatesLatestRows,
    Estimate_Revisions_Log: estimateRevisionLogRows,
    Estimate_Line_Items: estimateLineItemRows,
    Contracts_Latest: contractsLatestRows,
    Contract_Revisions_Log: contractRevisionLogRows,
    Budget_Item_Revisions: budgetItemRevisionRows,
    Expense_Revisions: expenseRevisionRows,
    Contract_Risk_Findings: contractRiskRows,
    Contract_Monitoring_Events: contractMonitoringRows,
    Contract_Payment_Milestones: contractPaymentMilestoneRows,
    Contract_Timeline_Milestones: contractTimelineRows,
    Estimate_Contacts: estimateContactRows,
    Rooms: roomsTabRows,
    Budget_Summary: budgetSummaryRows,
  };

  const syncHash = await hashValue(JSON.stringify(tabs));
  return {
    meta: {
      generatedAt: generatedAt.toISOString(),
      cursor,
      syncHash,
      source: "d1",
    },
    tabs,
  };
}

async function replaceBudgetItemRevisionFromRow(
  db: ReturnType<typeof drizzle>,
  activeItemId: number,
  row: WorkbookRow,
  opts: {
    staleHead: boolean;
    changedBy: string | null;
    changeSource: string;
  },
) {
  const current = await db
    .select()
    .from(budgetTrackerItems)
    .where(eq(budgetTrackerItems.id, activeItemId))
    .get();
  if (!current || !current.isActive) return null;

  const nextRevision = await nextBudgetRevisionNumber(db, current.trackId);
  const now = new Date();
  const newRowInsert = await db
    .insert(budgetTrackerItems)
    .values({
      trackId: current.trackId,
      revisionNumber: nextRevision,
      isActive: true,
      isDraft: opts.staleHead ? true : toBool(row.is_draft ?? current.isDraft),
      itemType: toText(row.item_type) || current.itemType,
      executionClass: toText(row.execution_class) || current.executionClass,
      optionGroup: toText(row.option_group),
      optionKey: toText(row.option_key),
      title: toText(row.title) || current.title,
      description: toText(row.description),
      status: toText(row.status) || current.status,
      riskLevel: toText(row.risk_level) || current.riskLevel,
      isBottleneck: toBool(row.is_bottleneck),
      bottleneckReason: toText(row.bottleneck_reason),
      estimatedLowCents: toCents(row.estimated_low_cents),
      estimatedHighCents: toCents(row.estimated_high_cents),
      scenarioId: toText(row.scenario_id),
      owner: toText(row.owner),
      aiRationale: toText(row.ai_rationale),
      changeSource: opts.changeSource,
      changedBy: opts.changedBy,
      datetimeCreated: now,
      datetimeUpdated: now,
    })
    .returning();
  const next = newRowInsert[0];

  await db
    .update(budgetTrackerItems)
    .set({
      isActive: false,
      replacedByItemId: next.id,
      replacedAt: now,
      datetimeUpdated: now,
    })
    .where(eq(budgetTrackerItems.id, current.id))
    .run();

  await db
    .delete(budgetTrackerItemRooms)
    .where(eq(budgetTrackerItemRooms.budgetTrackerItemId, next.id))
    .run();
  const nextRoomIds = parseRoomIds(row.room_ids);
  if (nextRoomIds.length > 0) {
    await db.insert(budgetTrackerItemRooms).values(
      nextRoomIds.map((roomId) => ({
        budgetTrackerItemId: next.id,
        roomId,
        datetimeCreated: now,
      })),
    );
  }
  return next;
}

async function replaceExpenseRevisionFromRow(
  db: ReturnType<typeof drizzle>,
  activeExpenseId: number,
  row: WorkbookRow,
  opts: {
    staleHead: boolean;
    changedBy: string | null;
    changeSource: string;
  },
) {
  const current = await db
    .select()
    .from(budgetExpenseEntries)
    .where(eq(budgetExpenseEntries.id, activeExpenseId))
    .get();
  if (!current || !current.isActive) return null;

  const item = toText(row.item) || current.item;
  const category = toText(row.category) || current.category;
  const amountCents = toCents(row.amount_cents);
  if (amountCents === null) {
    throw new Error("Expense amount_cents is required");
  }

  const nextRevision = await nextExpenseRevisionNumber(db, current.trackId);
  const now = new Date();
  const insert = await db
    .insert(budgetExpenseEntries)
    .values({
      trackId: current.trackId,
      revisionNumber: nextRevision,
      isActive: true,
      isDraft: opts.staleHead ? true : toBool(row.is_draft ?? current.isDraft),
      item,
      category,
      amountCents,
      vendorName: toText(row.vendor_name),
      scenarioId: toText(row.scenario_id),
      optionGroup: toText(row.option_group),
      optionKey: toText(row.option_key),
      sourceType: toText(row.source_type) || current.sourceType || "manual",
      sourceRef: toText(row.source_ref),
      dateIncurred: toTimestamp(row.date_incurred),
      notes: toText(row.notes),
      changeSource: opts.changeSource,
      changedBy: opts.changedBy,
      datetimeCreated: now,
      datetimeUpdated: now,
    })
    .returning();
  const next = insert[0];

  await db
    .update(budgetExpenseEntries)
    .set({
      isActive: false,
      replacedByExpenseId: next.id,
      replacedAt: now,
      datetimeUpdated: now,
    })
    .where(eq(budgetExpenseEntries.id, current.id))
    .run();

  return next;
}

export async function applyGoogleSheetsWorkbookPush(
  env: Env,
  payload: {
    idempotencyKey: string;
    changedBy?: string | null;
    changeSource?: string | null;
    workbook?: {
      tabs?: WorkbookTabsPayload;
      meta?: {
        cursor?: string;
        syncHash?: string;
      };
    };
  },
) {
  const db = drizzle(env.DB);
  const idempotencyKey = toText(payload.idempotencyKey);
  if (!idempotencyKey) {
    throw new Error("idempotencyKey is required");
  }

  const existingEvent = await db
    .select()
    .from(googleSheetSyncEvents)
    .where(eq(googleSheetSyncEvents.idempotencyKey, idempotencyKey))
    .get();
  if (existingEvent) {
    return {
      duplicate: true,
      eventId: existingEvent.id,
      applied: 0,
      created: 0,
      revised: 0,
      staleHeadDrafts: 0,
    };
  }

  const projectInfoRows = payload.workbook?.tabs?.Project_Information || [];
  const financialRows = payload.workbook?.tabs?.Financial_Status || [];
  const budgetTabRows = payload.workbook?.tabs?.Budget_Items || [];
  const expenseRows = payload.workbook?.tabs?.Itemized_Expenses || [];

  let updatedProjectInfo = 0;
  let updatedFundingAccounts = 0;
  let createdBudgetItems = 0;
  let revisedBudgetItems = 0;
  let staleHeadDraftsBudget = 0;
  let unchangedBudgetItems = 0;
  let createdExpenses = 0;
  let revisedExpenses = 0;
  let staleHeadDraftExpenses = 0;
  let unchangedExpenses = 0;

  for (const row of projectInfoRows) {
    const infoKey = toText(row.info_key);
    if (!infoKey) continue;
    await db
      .insert(budgetProjectInfo)
      .values({
        infoKey,
        infoLabel: toText(row.info_label) || infoKey,
        infoValue: toText(row.info_value),
        notes: toText(row.notes),
        datetimeCreated: new Date(),
        datetimeUpdated: new Date(),
      })
      .onConflictDoUpdate({
        target: budgetProjectInfo.infoKey,
        set: {
          infoLabel: toText(row.info_label) || infoKey,
          infoValue: toText(row.info_value),
          notes: toText(row.notes),
          datetimeUpdated: new Date(),
        },
      });
    updatedProjectInfo += 1;
  }

  for (const row of financialRows) {
    const lineType = toText(row.line_type);
    const accountKey = toText(row.account_key);
    if (lineType !== "account" || !accountKey) continue;

    const amountCents = toCents(row.amount_cents);
    if (amountCents === null) continue;

    await db
      .insert(budgetFundingAccounts)
      .values({
        accountKey,
        accountLabel: toText(row.label) || accountKey,
        amountCents,
        notes: toText(row.notes),
        datetimeCreated: new Date(),
        datetimeUpdated: new Date(),
      })
      .onConflictDoUpdate({
        target: budgetFundingAccounts.accountKey,
        set: {
          accountLabel: toText(row.label) || accountKey,
          amountCents,
          notes: toText(row.notes),
          datetimeUpdated: new Date(),
        },
      });
    updatedFundingAccounts += 1;
  }

  for (const row of budgetTabRows) {
    const title = toText(row.title);
    if (!title) continue;
    const trackId = toText(row.track_id) || crypto.randomUUID();
    const incomingRevision = Number.parseInt(String(row.revision_number || "0"), 10) || 0;
    const incomingHash = toText(row.row_hash);
    const active = await db
      .select()
      .from(budgetTrackerItems)
      .where(and(eq(budgetTrackerItems.trackId, trackId), eq(budgetTrackerItems.isActive, true)))
      .get();

    if (!active) {
      const now = new Date();
      const inserted = await db
        .insert(budgetTrackerItems)
        .values({
          trackId,
          revisionNumber: 1,
          isActive: true,
          isDraft: toBool(row.is_draft),
          itemType: toText(row.item_type) || "project",
          executionClass: toText(row.execution_class) || "must_now",
          optionGroup: toText(row.option_group),
          optionKey: toText(row.option_key),
          title,
          description: toText(row.description),
          status: toText(row.status) || "open",
          riskLevel: toText(row.risk_level) || "medium",
          isBottleneck: toBool(row.is_bottleneck),
          bottleneckReason: toText(row.bottleneck_reason),
          estimatedLowCents: toCents(row.estimated_low_cents),
          estimatedHighCents: toCents(row.estimated_high_cents),
          scenarioId: toText(row.scenario_id),
          owner: toText(row.owner),
          aiRationale: toText(row.ai_rationale),
          changeSource: toText(payload.changeSource) || "google_sheets_push",
          changedBy: toText(payload.changedBy),
          datetimeCreated: now,
          datetimeUpdated: now,
        })
        .returning();
      const next = inserted[0];
      const nextRoomIds = parseRoomIds(row.room_ids);
      if (nextRoomIds.length > 0) {
        await db.insert(budgetTrackerItemRooms).values(
          nextRoomIds.map((roomId) => ({
            budgetTrackerItemId: next.id,
            roomId,
            datetimeCreated: now,
          })),
        );
      }
      createdBudgetItems += 1;
      continue;
    }

    const activeHash = await budgetItemRowHash(active);
    if (incomingHash && incomingHash === activeHash) {
      unchangedBudgetItems += 1;
      continue;
    }

    const staleHead = incomingRevision > 0 && incomingRevision < active.revisionNumber;
    await replaceBudgetItemRevisionFromRow(db, active.id, row, {
      staleHead,
      changedBy: toText(payload.changedBy),
      changeSource: staleHead
        ? "google_sheets_stale_head"
        : toText(payload.changeSource) || "google_sheets_push",
    });
    revisedBudgetItems += 1;
    if (staleHead) staleHeadDraftsBudget += 1;
  }

  for (const row of expenseRows) {
    const item = toText(row.item);
    const amountCents = toCents(row.amount_cents);
    if (!item || amountCents === null) continue;

    const trackId = toText(row.track_id) || crypto.randomUUID();
    const incomingRevision = Number.parseInt(String(row.revision_number || "0"), 10) || 0;
    const incomingHash = toText(row.row_hash);
    const active = await db
      .select()
      .from(budgetExpenseEntries)
      .where(and(eq(budgetExpenseEntries.trackId, trackId), eq(budgetExpenseEntries.isActive, true)))
      .get();

    if (!active) {
      await db.insert(budgetExpenseEntries).values({
        trackId,
        revisionNumber: 1,
        isActive: true,
        isDraft: toBool(row.is_draft),
        item,
        category: toText(row.category) || "general",
        amountCents,
        vendorName: toText(row.vendor_name),
        scenarioId: toText(row.scenario_id),
        optionGroup: toText(row.option_group),
        optionKey: toText(row.option_key),
        sourceType: toText(row.source_type) || "manual",
        sourceRef: toText(row.source_ref),
        dateIncurred: toTimestamp(row.date_incurred),
        notes: toText(row.notes),
        changeSource: toText(payload.changeSource) || "google_sheets_push",
        changedBy: toText(payload.changedBy),
        datetimeCreated: new Date(),
        datetimeUpdated: new Date(),
      });
      createdExpenses += 1;
      continue;
    }

    const activeHash = await expenseRowHash({
      item: active.item,
      category: active.category,
      amountCents: active.amountCents,
      vendorName: active.vendorName,
      scenarioId: active.scenarioId,
      optionGroup: active.optionGroup,
      optionKey: active.optionKey,
      sourceType: active.sourceType,
      sourceRef: active.sourceRef,
      notes: active.notes,
      dateIncurred: active.dateIncurred,
    });
    if (incomingHash && incomingHash === activeHash) {
      unchangedExpenses += 1;
      continue;
    }

    const staleHead = incomingRevision > 0 && incomingRevision < active.revisionNumber;
    await replaceExpenseRevisionFromRow(db, active.id, row, {
      staleHead,
      changedBy: toText(payload.changedBy),
      changeSource: staleHead
        ? "google_sheets_stale_head"
        : toText(payload.changeSource) || "google_sheets_push",
    });
    revisedExpenses += 1;
    if (staleHead) staleHeadDraftExpenses += 1;
  }

  const result = {
    duplicate: false,
    applied: {
      project_information: projectInfoRows.length,
      financial_status: financialRows.length,
      budget_items: budgetTabRows.length,
      itemized_expenses: expenseRows.length,
    },
    updatedProjectInfo,
    updatedFundingAccounts,
    createdBudgetItems,
    revisedBudgetItems,
    staleHeadDraftsBudget,
    unchangedBudgetItems,
    createdExpenses,
    revisedExpenses,
    staleHeadDraftExpenses,
    unchangedExpenses,
  };

  const eventInsert = await db
    .insert(googleSheetSyncEvents)
    .values({
      target: "google_sheets",
      direction: "push",
      idempotencyKey,
      cursorValue: toText(payload.workbook?.meta?.cursor),
      syncHash: toText(payload.workbook?.meta?.syncHash),
      requestJson: JSON.stringify(payload.workbook || {}),
      resultJson: JSON.stringify(result),
      datetimeCreated: new Date(),
    })
    .returning();

  return {
    ...result,
    eventId: eventInsert[0].id,
  };
}
