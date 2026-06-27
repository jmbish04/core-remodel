import fs from "fs";
import path from "path";
import crypto from "crypto";

// Relative paths to data files
const JSON_PATH = path.join(__dirname, "../proofs/data/2026_-_Renovation_Budget_Agent_all_tabs_export_20260524_054055.json");
const TSV_PATH = path.join(__dirname, "../proofs/data/2026 - Renovation Budget - Assumptions - Assumptions.tsv");

interface JsonSheetRow {
  [key: string]: any;
}

interface JsonSheet {
  sheetName: string;
  rowCount: number;
  rows: JsonSheetRow[];
}

interface JsonExport {
  sheets: JsonSheet[];
}

function normalizeSlug(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_+|_+$)/g, "");
}

function escapeSql(str: string | null | undefined): string {
  if (str === null || str === undefined) return "NULL";
  return `'${str.toString().replace(/'/g, "''")}'`;
}

function cleanPrice(val: any): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return val;
  const cleaned = val.toString().replace(/[\$,]/g, "").trim();
  if (cleaned === "") return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function generateUuid(prefix = ""): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

async function run() {
  console.log("Starting seed script generation...");

  // Load JSON and TSV files
  if (!fs.existsSync(JSON_PATH)) {
    throw new Error(`JSON file not found at ${JSON_PATH}`);
  }
  if (!fs.existsSync(TSV_PATH)) {
    throw new Error(`TSV file not found at ${TSV_PATH}`);
  }

  const jsonData: JsonExport = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  const tsvLines = fs.readFileSync(TSV_PATH, "utf8").split(/\r?\n/);

  // Extract sheets
  const truthTableSheet = jsonData.sheets.find(s => s.sheetName === "Truth Table");
  const standardCostsSheet = jsonData.sheets.find(s => s.sheetName === "Standard Costs");
  
  // Static budget item sheets (merge 3 sheets)
  const staticSheet1 = jsonData.sheets.find(s => s.sheetName === "gemini-code-1779138284204");
  const staticSheet2 = jsonData.sheets.find(s => s.sheetName === "Sheet6");
  const staticSheet3 = jsonData.sheets.find(s => s.sheetName === "gemini-code-1779142317914");
  
  const budgetVarianceSheet = jsonData.sheets.find(s => s.sheetName === "Budget Variance");

  if (!truthTableSheet || !standardCostsSheet) {
    throw new Error("Required sheets missing from JSON export");
  }

  let sql = `-- Auto-generated seed-budget.sql
-- Run: npx wrangler d1 execute DB --local --file=seed-budget.sql
-- Run Remote: npx wrangler d1 execute DB --remote --file=seed-budget.sql

-- Clear new tables to prevent duplicate seed conflicts
DELETE FROM trade_data;
DELETE FROM standard_costs;
DELETE FROM static_budget_items;
DELETE FROM budget_variance_line_items;
DELETE FROM budget_variance_scenarios;
DELETE FROM assumption_line_items;
DELETE FROM assumption_micro_variances;
DELETE FROM project_system_variables;
DELETE FROM work_item_types;

`;

  // ==========================================
  // 1. SEED WORK_ITEM_TYPES
  // ==========================================
  console.log("Processing work_item_types...");
  const typesSet = new Set<string>();
  
  // Collect from Standard Costs "Work Item Type" column
  standardCostsSheet.rows.forEach(row => {
    const type = row["Work Item Type"];
    if (type && type.toString().trim() !== "") {
      typesSet.add(type.toString().trim());
    }
  });

  // Collect from Truth Table "category" column
  truthTableSheet.rows.forEach(row => {
    const cat = row["category"];
    if (cat && cat.toString().trim() !== "") {
      typesSet.add(cat.toString().trim());
    }
  });

  // Ensure standard defaults exist
  typesSet.add("Drywall");
  typesSet.add("Plumbing/Bath");
  typesSet.add("Flooring");
  typesSet.add("General");
  typesSet.add("Electrical");
  typesSet.add("Paint");
  typesSet.add("Windows & Doors");
  typesSet.add("Demolition");
  typesSet.add("Insulation");
  typesSet.add("Cabinetry");
  typesSet.add("HVAC");

  sql += `-- Seed work_item_types\n`;
  const typeMap = new Map<string, string>(); // name -> key slug
  Array.from(typesSet).sort().forEach(typeName => {
    const key = normalizeSlug(typeName);
    typeMap.set(typeName, key);
    sql += `INSERT INTO work_item_types (key, name, description) VALUES ('${key}', ${escapeSql(typeName)}, 'Renovation trade category for ${typeName}');\n`;
  });
  sql += `\n`;

  // ==========================================
  // 2. SEED FLOORS AND ROOMS (Ensure standard mapping targets exist)
  // ==========================================
  sql += `-- Seed/Ensure Floors & Rooms
INSERT OR IGNORE INTO floors (key, name, level_order, living_sq_ft) VALUES ('lower_level', 'Lower Level', 1, 1000);
INSERT OR IGNORE INTO floors (key, name, level_order, living_sq_ft) VALUES ('upper_level', 'Upper Level', 2, 1200);
INSERT OR IGNORE INTO floors (key, name, level_order, living_sq_ft) VALUES ('outside', 'Outside', 3, 0);
INSERT OR IGNORE INTO floors (key, name, level_order, living_sq_ft) VALUES ('all_levels', 'All Levels', 4, 2200);

INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'upper_level'), 'primary_bathroom', 'Primary Bathroom', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'lower_level'), 'entry_foyer', 'Entry/Foyer', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'upper_level'), 'kitchen', 'Kitchen', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'lower_level'), 'guest_bathroom', 'Guest Bathroom', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'upper_level'), 'hall_bathroom', 'Hall Bathroom', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'lower_level'), 'guest_bedroom', 'Guest Bedroom', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'lower_level'), 'living_room', 'Living Room', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'upper_level'), 'family_room', 'Family Room', 1);
INSERT OR IGNORE INTO rooms (floor_id, room_code, room_name, is_living_space) VALUES ((SELECT id FROM floors WHERE key = 'outside'), 'backyard', 'Backyard', 0);
\n`;

  // ==========================================
  // 3. SEED TRADE_DATA (Deduplicated Truth Table)
  // ==========================================
  console.log("Processing trade_data...");
  sql += `-- Seed trade_data (Truth Table)\n`;
  const tradeMap = new Map<string, string>(); // "workItem|category" -> id
  const tradeList: any[] = [];
  
  truthTableSheet.rows.forEach(row => {
    const workItem = row["work_item"]?.toString().trim();
    const category = row["category"]?.toString().trim();
    if (!workItem || !category) return;
    
    const mapKey = `${workItem}|${category}`;
    if (tradeMap.has(mapKey)) {
      console.log(`  Duplicate skipped in Truth Table: "${workItem}" under category "${category}"`);
      return;
    }
    
    const id = generateUuid("td_");
    tradeMap.set(mapKey, id);
    tradeList.push({
      id,
      workItem,
      description: row["description"],
      category,
      typeKey: normalizeSlug(category),
      measurementType: row["measurement_type"],
      maxUnitPrice: cleanPrice(row["max_unit_price"]),
      sfUnitPrice: cleanPrice(row["sf_unit_price"]),
      sfMultiplier: cleanPrice(row["sf_multiplier"]),
      rationale: row["rationale"]
    });
  });

  tradeList.forEach(t => {
    sql += `INSERT INTO trade_data (id, work_item, description, category, work_item_type_id, measurement_type, max_unit_price, sf_unit_price, sf_multiplier, rationale) VALUES (
      '${t.id}', ${escapeSql(t.workItem)}, ${escapeSql(t.description)}, ${escapeSql(t.category)},
      (SELECT id FROM work_item_types WHERE key = '${t.typeKey}'), ${escapeSql(t.measurementType)},
      ${t.maxUnitPrice ?? "NULL"}, ${t.sfUnitPrice ?? "NULL"}, ${t.sfMultiplier ?? "NULL"}, ${escapeSql(t.rationale)}
    );\n`;
  });
  sql += `\n`;

  // ==========================================
  // 4. SEED STANDARD_COSTS
  // ==========================================
  console.log("Processing standard_costs...");
  sql += `-- Seed standard_costs\n`;
  
  standardCostsSheet.rows.forEach((row, index) => {
    const id = generateUuid("sc_");
    const workItem = row["work_item"]?.toString().trim();
    const room = row["room"]?.toString().trim();
    const floor = row["floor"]?.toString().trim();
    const rawType = row["Work Item Type"]?.toString().trim();
    const typeKey = rawType ? normalizeSlug(rawType) : "general";
    
    if (!workItem || !room) return;
    
    // Fuzzy matching for tradeDataId
    let matchedTradeId = "NULL";
    if (categoryMapping(rawType)) {
      const matchCategory = categoryMapping(rawType);
      const exactKey = `${workItem}|${matchCategory}`;
      if (tradeMap.has(exactKey)) {
        matchedTradeId = `'${tradeMap.get(exactKey)}'`;
      } else {
        // Find best match in tradeList
        const matches = tradeList.filter(t => t.workItem.toLowerCase() === workItem.toLowerCase());
        if (matches.length > 0) {
          matchedTradeId = `'${matches[0].id}'`;
        }
      }
    }

    const roomCode = normalizeSlug(room);
    const floorKey = floor ? normalizeSlug(floor) : "upper_level";
    const quantity = cleanPrice(row["quantity"]) || 0;
    const unitPrice = cleanPrice(row["UNIT PRICE"]);
    const sfUnitPrice = cleanPrice(row["SF UNIT PRICE"]);
    const tax = cleanPrice(row["TAX"]) || 0;
    const op = cleanPrice(row["O&P"]) || 0;
    const rcv = cleanPrice(row["RCV"]);
    const totalCost = cleanPrice(row["Total Cost"]);
    const totalSfCost = cleanPrice(row["Total SF Cost"]);
    
    sql += `INSERT INTO standard_costs (id, room_id, room_name, floor_name, work_item, work_item_type_id, trade_data_id, quantity, measurement_type, unit_price, sf_unit_price, tax, overhead_and_profit, rcv, total_cost, total_sf_cost, notes) VALUES (
      '${id}', (SELECT id FROM rooms WHERE room_code = '${roomCode}'), ${escapeSql(room)}, ${escapeSql(floor)}, ${escapeSql(workItem)},
      (SELECT id FROM work_item_types WHERE key = '${typeKey}'), ${matchedTradeId}, ${quantity}, ${escapeSql(row["measurement_type"])},
      ${unitPrice ?? "NULL"}, ${sfUnitPrice ?? "NULL"}, ${tax}, ${op}, ${rcv ?? "NULL"}, ${totalCost ?? "NULL"}, ${totalSfCost ?? "NULL"}, ${escapeSql(row["Notes"])}
    );\n`;
  });
  sql += `\n`;

  // Auxiliary category mapping helper
  function categoryMapping(rawType: string): string {
    if (!rawType) return "General";
    if (rawType.toLowerCase() === "plumbing/bath") return "Plumbing/Bath";
    if (rawType.toLowerCase() === "drywall") return "Drywall";
    if (rawType.toLowerCase() === "flooring") return "Flooring";
    if (rawType.toLowerCase() === "electrical") return "Electrical";
    if (rawType.toLowerCase() === "paint" || rawType.toLowerCase() === "painting") return "Paint";
    return "General";
  }

  // ==========================================
  // 5. SEED STATIC_BUDGET_ITEMS
  // ==========================================
  console.log("Processing static_budget_items...");
  sql += `-- Seed static_budget_items\n`;
  
  const staticItemsMerged: any[] = [];
  const staticItemsSet = new Set<string>();

  // Process sheet 1: Primary Static Items (gemini-code-1779138284204)
  if (staticSheet1) {
    staticSheet1.rows.forEach(row => {
      const desc = row["Item Description"] || row["item_description"];
      if (!desc) return;
      const cat = row["Category"] || "General";
      const floor = row["Floor"] || "";
      const area = row["Area/Room"] || "";
      
      const setKey = `${desc}|${floor}|${area}`;
      if (staticItemsSet.has(setKey)) return;
      staticItemsSet.add(setKey);

      staticItemsMerged.push({
        id: generateUuid("sbi_"),
        category: cat,
        floorName: floor,
        areaRoom: area,
        comparisonGroup: row["Comparison"],
        itemDescription: desc,
        qty: cleanPrice(row["Estimated QTY"] || row["estimated_qty"]),
        unit: row["Unit"],
        minUnitCost: cleanPrice(row["Min Unit Cost"] || row["min_unit_cost"]),
        maxUnitCost: cleanPrice(row["Max Unit Cost"] || row["max_unit_cost"]),
        minCost: cleanPrice(row["Min Cost"] || row["min_cost"]),
        avgCost: cleanPrice(row["Avg Cost"] || row["avg_cost"]),
        maxCost: cleanPrice(row["Max Cost"] || row["max_cost"]),
        phaseTag: row["Phase Tag"] || row["phase_tag"],
        notes: row["Notes"] || row["notes"],
        sourceSheet: "Static Budget Items"
      });
    });
  }

  // Process sheet 2: Sheet6 (Infrastructure/permits)
  if (staticSheet2) {
    staticSheet2.rows.forEach(row => {
      const desc = row["Item Description"] || row["item_description"];
      if (!desc) return;
      
      const setKey = `${desc}||House-wide`;
      if (staticItemsSet.has(setKey)) return;
      staticItemsSet.add(setKey);

      staticItemsMerged.push({
        id: generateUuid("sbi_"),
        category: "Infrastructure",
        floorName: "all levels",
        areaRoom: "House-wide",
        comparisonGroup: null,
        itemDescription: desc,
        qty: 1,
        unit: "LS",
        minUnitCost: null,
        maxUnitCost: null,
        minCost: cleanPrice(row["Min Cost"] || row["min_cost"]),
        avgCost: cleanPrice(row["Avg Cost"] || row["avg_cost"]),
        maxCost: cleanPrice(row["Max Cost"] || row["max_cost"]),
        phaseTag: row["Feasibility / Strategy Tag"] || row["phase_tag"],
        notes: row["Architectural & Engineering Notes"] || row["notes"],
        sourceSheet: "Sheet6"
      });
    });
  }

  // Process sheet 3: gemini-code-1779142317914 (Kitchen Additions)
  if (staticSheet3) {
    staticSheet3.rows.forEach(row => {
      const desc = row["Item Description"] || row["item_description"];
      if (!desc) return;
      const cat = row["Category"] || "Kitchen";
      const floor = row["Floor"] || "upper level";
      const area = row["Area/Room"] || "Kitchen";
      
      const setKey = `${desc}|${floor}|${area}`;
      if (staticItemsSet.has(setKey)) return;
      staticItemsSet.add(setKey);

      staticItemsMerged.push({
        id: generateUuid("sbi_"),
        category: cat,
        floorName: floor,
        areaRoom: area,
        comparisonGroup: row["Comparison"],
        itemDescription: desc,
        qty: cleanPrice(row["Estimated QTY"] || row["estimated_qty"]),
        unit: row["Unit"],
        minUnitCost: cleanPrice(row["Min Unit Cost"] || row["min_unit_cost"]),
        maxUnitCost: cleanPrice(row["Max Unit Cost"] || row["max_unit_cost"]),
        minCost: cleanPrice(row["Min Cost"] || row["min_cost"]),
        avgCost: cleanPrice(row["Avg Cost"] || row["avg_cost"]),
        maxCost: cleanPrice(row["Max Cost"] || row["max_cost"]),
        phaseTag: row["Phase Tag"] || row["phase_tag"],
        notes: row["Notes"] || row["notes"],
        sourceSheet: "Kitchen Additions"
      });
    });
  }

  staticItemsMerged.forEach(item => {
    let floorKey = "all_levels";
    if (item.floorName) {
      const fn = item.floorName.toLowerCase();
      if (fn.includes("lower")) floorKey = "lower_level";
      else if (fn.includes("upper")) floorKey = "upper_level";
      else if (fn.includes("outside") || fn.includes("backyard")) floorKey = "outside";
    }

    // Clean boolean "false" values in notes/phaseTag
    const phaseTagVal = (item.phaseTag === false || item.phaseTag === "false") ? null : item.phaseTag;
    const notesVal = (item.notes === false || item.notes === "false") ? null : item.notes;

    sql += `INSERT INTO static_budget_items (id, category, floor_id, floor_name, area_room, comparison_group, item_description, estimated_qty, unit, min_unit_cost, max_unit_cost, min_cost, avg_cost, max_cost, phase_tag, notes, source_sheet) VALUES (
      '${item.id}', ${escapeSql(item.category)}, (SELECT id FROM floors WHERE key = '${floorKey}'), ${escapeSql(item.floorName)}, ${escapeSql(item.areaRoom)},
      ${escapeSql(item.comparisonGroup)}, ${escapeSql(item.itemDescription)}, ${item.qty ?? "NULL"}, ${escapeSql(item.unit)},
      ${item.minUnitCost ?? "NULL"}, ${item.maxUnitCost ?? "NULL"}, ${item.minCost ?? "NULL"}, ${item.avgCost ?? "NULL"}, ${item.maxCost ?? "NULL"},
      ${escapeSql(phaseTagVal)}, ${escapeSql(notesVal)}, ${escapeSql(item.sourceSheet)}
    );\n`;
  });
  sql += `\n`;

  // ==========================================
  // 6. SEED BUDGET_VARIANCE_SCENARIOS
  // ==========================================
  console.log("Processing budget_variance_scenarios...");
  sql += `-- Seed budget_variance_scenarios\n`;
  
  // Kitchen Scenarios definitions
  const scenarios = [
    { id: 1, key: "a", label: "Scenario A", loc: "Kitchen Downstairs", sub: "Living Room (South Wall)", layout: "Galley w/ island", plumb: "Cut through slab for plumbing", total: 177284 },
    { id: 2, key: "b", label: "Scenario B", loc: "Kitchen Downstairs", sub: "Guest Bedroom (North Wall)", layout: "U-shape", plumb: "tap into bathroom plumbing", total: 80000 },
    { id: 3, key: "c", label: "Scenario C", loc: "Kitchen Upstairs", sub: "New Layout", layout: "U-Shape", plumb: "Move sink to window", total: 117304 },
    { id: 4, key: "d", label: "Scenario D", loc: "Kitchen Upstairs", sub: "In Kind", layout: "L-Shape", plumb: "Nothing special", total: 40000 }
  ];

  scenarios.forEach(s => {
    sql += `INSERT INTO budget_variance_scenarios (id, scenario_key, label, kitchen_location, sub_location, layout_type, plumbing_strategy, deviation_total, notes) VALUES (
      ${s.id}, '${s.key}', '${s.label}', '${s.loc}', ${escapeSql(s.sub)}, '${s.layout}', '${s.plumb}', ${s.total}, '4-Scenario kitchen architectural layout options'
    );\n`;
  });
  sql += `\n`;

  // ==========================================
  // 7. SEED BUDGET_VARIANCE_LINE_ITEMS
  // ==========================================
  console.log("Processing budget_variance_line_items...");
  sql += `-- Seed budget_variance_line_items\n`;
  
  if (budgetVarianceSheet) {
    // Unpivot the table rows starting from row index 4 (excluding headers)
    // Row 0-2 are description & headers
    budgetVarianceSheet.rows.forEach((row, rIdx) => {
      // Row contains column_1 as label, values for each scenario, and notes in column_6
      const label = row["column_1"] || row["Scenario"];
      if (!label || label.trim() === "" || label.includes("Totals") || label.includes("Totals (Delta)")) return;

      const notes = row["column_6"] || "";
      const valA = cleanPrice(row["Kitchen Downstairs"]);
      const valB = cleanPrice(row["column_3"]);
      const valC = cleanPrice(row["Kitchen Upstairs"]);
      const valD = cleanPrice(row["column_5"]);

      if (valA !== null) {
        sql += `INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('${generateUuid("bvli_")}', 1, ${escapeSql(label)}, ${rIdx}, ${valA}, ${escapeSql(notes)});\n`;
      }
      if (valB !== null) {
        sql += `INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('${generateUuid("bvli_")}', 2, ${escapeSql(label)}, ${rIdx}, ${valB}, ${escapeSql(notes)});\n`;
      }
      if (valC !== null) {
        sql += `INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('${generateUuid("bvli_")}', 3, ${escapeSql(label)}, ${rIdx}, ${valC}, ${escapeSql(notes)});\n`;
      }
      if (valD !== null) {
        sql += `INSERT INTO budget_variance_line_items (id, scenario_id, line_item_label, sort_order, cost_amount, notes) VALUES ('${generateUuid("bvli_")}', 4, ${escapeSql(label)}, ${rIdx}, ${valD}, ${escapeSql(notes)});\n`;
      }
    });
  }
  sql += `\n`;

  // ==========================================
  // 8. SEED TSV ASSUMPTIONS & PROJECT VARIABLES & SHOWER MATRIX
  // ==========================================
  console.log("Processing TSV assumptions & variables...");
  
  sql += `-- Seed project_system_variables\n`;
  // TSV global variables are at rows 12-16 (0-indexed lines 11 to 15)
  // Let's hardcode or parse directly:
  // Global System Variables	Value	Unit	Category	Description	Mapping Ref Key
  // Project Baseline Cap	$300,000	USD	Financial	Target absolute max phase 1 ceiling	SYS_BUDGET_CAP
  // Active Triage Kitchen Scenario	Scenario C	String	Architectural	Selected programmatic layout choice	ACTIVE_KITCHEN_SCENARIO
  // Rough-in Phase Open Framing Credit	20.0%	Percentage	HVAC / Labor	Credit applied to mechanical installation labor hours	OPEN_FRAMING_CREDIT
  // Sewer Lateral Test Mandate Trigger	$100,000	USD	Infrastructure	Monetary threshold triggering lateral compliance	SLO_TRIGGER_VAL
  
  const vars = [
    { key: "SYS_BUDGET_CAP", val: "$300,000", unit: "USD", cat: "Financial", desc: "Target absolute max phase 1 ceiling" },
    { key: "ACTIVE_KITCHEN_SCENARIO", val: "Scenario C", unit: "String", cat: "Architectural", desc: "Selected kitchen scenario layout choice" },
    { key: "OPEN_FRAMING_CREDIT", val: "20.0%", unit: "Percentage", cat: "HVAC / Labor", desc: "Credit applied to mechanical installation labor hours" },
    { key: "SLO_TRIGGER_VAL", val: "$100,000", unit: "USD", cat: "Infrastructure", desc: "Monetary threshold triggering lateral compliance" }
  ];

  vars.forEach(v => {
    sql += `INSERT INTO project_system_variables (variable_key, value_text, unit, category, description, mapping_ref_key) VALUES (
      '${v.key}', '${v.val}', '${v.unit}', '${v.cat}', '${v.desc}', '${v.key}'
    );\n`;
  });
  sql += `\n`;

  sql += `-- Seed assumption_line_items & micro-variances\n`;

  // Parse TSV sections and rows
  let currentSection = "";
  let sortOrderIndex = 0;

  for (let idx = 17; idx < tsvLines.length; idx++) {
    const line = tsvLines[idx].trim();
    if (line === "") continue;
    
    const cols = tsvLines[idx].split("\t").map(c => c.trim());
    if (cols.length < 2) continue;

    // Check if it's a section header
    // Backyard 	Min Cost	Avg/Target Cost	Max Cost	Phase Tag	Variant Risk Notes
    if (cols[1] === "Min Cost" && cols[2] === "Avg/Target Cost") {
      currentSection = cols[0].trim();
      console.log(`  Found TSV section: "${currentSection}"`);
      continue;
    }

    if (!currentSection) continue;

    // Skip TSV rows that are section-specific headers or details that we handle separately
    // Specifically Primary Bathroom shower scenarios are in rows 79-116
    const lineIndexInTsv = idx + 1; // 1-indexed for row traceability
    
    const isShowerRow = lineIndexInTsv >= 79 && lineIndexInTsv <= 116;

    if (isShowerRow) {
      // Ingest into assumption_micro_variances
      // Description is col 0
      // Min is col 1, Avg is col 2, Max is col 3
      // Phase is col 4, notes is col 5
      const desc = cols[0];
      const min = cleanPrice(cols[1]);
      const avg = cleanPrice(cols[2]);
      const max = cleanPrice(cols[3]);
      const phase = cols[4] || "TBD";
      const notes = cols[5] || "";

      let isAddon = false;
      let addonCategory = null;
      let scenarioLetter = null;
      let variantNumber = null;
      let wallPosition = "center"; // center (A-C) vs side (D-F)
      let floorType = null;
      let plumbingType = null;

      if (desc.startsWith("Add-On - Steam")) {
        isAddon = true;
        addonCategory = "steam";
      } else if (desc.startsWith("Add-On - Smart")) {
        isAddon = true;
        addonCategory = "smart";
      } else if (lineIndexInTsv >= 82 && lineIndexInTsv <= 91) {
        // center wall positioning (A-C)
        wallPosition = "center";
        const match = desc.match(/Scenario ([A-F])([1-2]):/i);
        if (match) {
          scenarioLetter = match[1].toUpperCase();
          variantNumber = parseInt(match[2]);
          plumbingType = variantNumber === 1 ? "dual_rainhead" : "single_rainhead";
        }
        if (lineIndexInTsv <= 83) floorType = "curbless_drop_box";
        else if (lineIndexInTsv <= 87) floorType = "no_pan_mud_bed";
        else floorType = "step_up_curb";
      } else if (lineIndexInTsv >= 96 && lineIndexInTsv <= 105) {
        // side wall positioning (D-F)
        wallPosition = "side";
        const match = desc.match(/Scenario ([A-F])([1-2]):/i);
        if (match) {
          scenarioLetter = match[1].toUpperCase();
          variantNumber = parseInt(match[2]);
          plumbingType = variantNumber === 1 ? "dual_rainhead" : "single_rainhead";
        }
        if (lineIndexInTsv <= 97) floorType = "curbless_drop_box";
        else if (lineIndexInTsv <= 101) floorType = "no_pan_mud_bed";
        else floorType = "step_up_curb";
      } else {
        // Section titles or spacers like "Primary Bath - Shower - Option Footprint Matrix" (skip)
        continue;
      }

      sql += `INSERT INTO assumption_micro_variances (id, scenario_letter, variant_number, wall_position, floor_type, plumbing_type, is_addon, addon_category, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        '${generateUuid("amv_")}', ${escapeSql(scenarioLetter)}, ${variantNumber ?? "NULL"}, '${wallPosition}', ${escapeSql(floorType)}, ${escapeSql(plumbingType)},
        ${isAddon ? 1 : 0}, ${escapeSql(addonCategory)}, ${escapeSql(desc)}, ${min ?? "NULL"}, ${avg ?? "NULL"}, ${max ?? "NULL"},
        ${escapeSql(phase)}, ${escapeSql(notes)}, ${sortOrderIndex++}, ${lineIndexInTsv}
      );\n`;

    } else {
      // General assumption line items
      // backyard, lower level, kitchen upstairs, guest bath, etc.
      // E.g. "Exterior French Drain Perimeter Matrix	$10,500	$11,250	$12,000..."
      const desc = cols[0];
      const min = cleanPrice(cols[1]);
      const avg = cleanPrice(cols[2]);
      const max = cleanPrice(cols[3]);
      const phase = cols[4] || "TBD";
      const notes = cols[5] || "";

      // Skip total rows or header spacers
      if (!desc || desc.trim() === "" || desc.toLowerCase().includes("cost summary") || desc.toLowerCase().includes("total estimated")) continue;

      sql += `INSERT INTO assumption_line_items (id, section_name, item_description, min_cost, avg_cost, max_cost, phase_tag, variant_risk_notes, sort_order, source_row) VALUES (
        '${generateUuid("ali_")}', ${escapeSql(currentSection)}, ${escapeSql(desc)}, ${min ?? "NULL"}, ${avg ?? "NULL"}, ${max ?? "NULL"},
        ${escapeSql(phase)}, ${escapeSql(notes)}, ${sortOrderIndex++}, ${lineIndexInTsv}
      );\n`;
    }
  }

  // Write out the SQL script
  const OUT_PATH = path.join(__dirname, "../seed-budget.sql");
  fs.writeFileSync(OUT_PATH, sql);
  console.log(`Successfully generated seed-budget.sql at ${OUT_PATH}`);
}

run().catch(e => {
  console.error("Error generating seed script: ", e);
  process.exit(1);
});
