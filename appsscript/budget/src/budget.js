function createRenovationTracker() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Clean up any default or existing sheets with conflicting names
  var sheetsToClear = [
    "Dimensions & Material Specs", 
    "The Baseline (No-Matter-What)", 
    "Scenario 1 - Downstairs South (Slab Cut)", 
    "Scenario 2 - Downstairs North (Stack Tap)", 
    "Scenario 3 - Upstairs U-Shape Open", 
    "Scenario 4 - Upstairs In-Kind L-Shape"
  ];
  
  sheetsToClear.forEach(function(name) {
    var existingSheet = ss.getSheetByName(name);
    if (existingSheet) {
      try {
        ss.deleteSheet(existingSheet);
      } catch(e) {
        // Fallback if it's the only remaining sheet
        existingSheet.setName("Temp_Old_" + Math.floor(Math.random() * 1000));
      }
    }
  });

  // Theme configuration (Moody Modern Design System)
  var THEME = {
    headerBg: "#1C1A27",
    headerTextColor: "#FFFFFF",
    zebraBg: "#F9F9FB",
    accentBg: "#F1F0F5",
    borderGainsboro: "#DCDCDC",
    textDark: "#111111",
    textMuted: "#666666"
  };

  // ==========================================
  // TAB 1: DIMENSIONS & MATERIAL SPECS
  // ==========================================
  var dimSheet = ss.insertSheet("Dimensions & Material Specs");
  dimSheet.setGridlinesGraphic(true);
  
  dimSheet.getRange("A1:E1").merge().setValue("PROPERTY SPACE DIMENSIONS & VARIABLE CALCULATORS")
    .setBackground(THEME.headerBg).setFontColor(THEME.headerTextColor).setFontWeight("bold").setFontSize(12).setHorizontalAlignment("center");
  
  var dimHeaders = [["Room/Zone", "Length (ft)", "Width (ft)", "Ceiling Height (ft)", "Calculated Floor Sq Ft"]];
  dimSheet.getRange("A2:E2").setValues(dimHeaders).setFontWeight("bold").setBackground(THEME.accentBg);
  
  var dimData = [
    ["Lower Level Living Room", 18, 14, 9.5, "=B3*C3"],
    ["Lower Level Bedroom (North)", 12, 11, 9.5, "=B4*C4"],
    ["Lower Level Bathroom", 8, 6, 9.5, "=B5*C5"],
    ["Upper Level Kitchen Space", 18, 9, 8, "=B6*C6"],
    ["Upper Level Hall Bathroom", 9, 6, 8, "=B7*C7"],
    ["Upper Level Primary Bedroom", 16, 14, 8, "=B8*C8"],
    ["Upper Level Primary Bathroom", 12, 10, 8, "=B9*C9"],
    ["Upper Level Second Bedroom (Jason Office)", 12, 11, 8, "=B10*C10"],
    ["Staircase Zone", 14, 4, 10, "=B11*C11"]
  ];
  dimSheet.getRange(3, 1, dimData.length, 5).setValues(dimData);
  
  // Add Dynamic Material Price Injectors
  var injectStartRow = 14;
  dimSheet.getRange(injectStartRow, 1, 1, 3).merge().setValue("GLOBAL MATERIAL UNIT COST ASSUMPTIONS")
    .setFontWeight("bold").setBackground(THEME.headerBg).setFontColor(THEME.headerTextColor);
  
  var injectHeaders = [["Material Type", "Est. Unit Cost (per Sq Ft / Unit)", "Reference Link / Notes"]];
  dimSheet.getRange(injectStartRow + 1, 1, 1, 3).setValues(injectHeaders).setFontWeight("bold").setBackground(THEME.accentBg);
  
  var injectData = [
    ["High-End Hardwood Flooring Material", 14.50, "Upper floor and staircase premium specification"],
    ["Primary Bathroom Premium Floor Tile", 18.00, "Luxury finish porcelain or natural stone"],
    ["Lower Level Bathroom Floor Tile", 12.00, "Mid-to-high clean aesthetic specification"],
    ["Hall/Jack-and-Jill Bathroom Floor Tile", 12.00, "Upstairs bathroom floor material baseline"],
    ["Wall Tile / Backsplash Material (Average)", 15.00, "Wet walls and kitchen tile treatments"],
    ["Premium Interior Paint Paint (per Gal)", 75.00, "Low-sheen matte finish formulations"]
  ];
  dimSheet.getRange(injectStartRow + 2, 1, injectData.length, 3).setValues(injectData);
  dimSheet.getRange(injectStartRow + 2, 2, injectData.length, 1).setNumberFormat("$#,##0.00");

  // Format dimensions sheet
  dimSheet.getRange("B3:E11").setNumberFormat("#,##0.00").setHorizontalAlignment("right");
  dimSheet.setColumnWidths(1, 3, 220);

  // ==========================================
  // TAB 2: THE BASELINE (NO-MATTER-WHAT)
  // ==========================================
  var baseSheet = ss.insertSheet("The Baseline (No-Matter-What)");
  baseSheet.setGridlinesGraphic(true);
  
  baseSheet.getRange("A1:D1").merge().setValue("THE BASELINE SCOPE: MANDATORY INFRASTRUCTURE & REQUISITES")
    .setBackground(THEME.headerBg).setFontColor(THEME.headerTextColor).setFontWeight("bold").setFontSize(12).setHorizontalAlignment("center");
  
  baseSheet.getRange("A2:D2").setValues([["Category", "Scope Component Item Name", "Estimated Cost", "Technical Realities & Scope Descriptions"]])
    .setFontWeight("bold").setBackground(THEME.accentBg);
  
  // Infused reactive formulas using cross-sheet lookups instead of old hardcoded numbers
  var baselineItems = [
    ["Outdoor/Drainage", "25-ft Custom French Drain Installation", 24500.00, "Excavate along rear width of house down to footing depth; layout perforated pipe wrap in filter fabric and clean gravel drainage bed."],
    ["Outdoor/Drainage", "Civil Engineered Bioswale Implementation", 18500.00, "Incorporate a vegetative swale with engineered clay-soil filtration layer across rear terrain to manage high volume surface runoff."],
    ["Outdoor/Drainage", "Sub-Grade Sump Pump Infrastructure", 8500.00, "Heavy-duty basin with dual pump backup matrix feeding directly into existing outdoor floor drain via hard pipe."],
    ["Outdoor/Drainage", "Concrete Patio Demolition & Wall Removal", 12000.00, "Break out existing concrete patio slab and demolish the existing 4-inch high perimeter concrete block wall splitting patio from yard space."],
    ["Outdoor/Drainage", "Patio Surfacing Upgrade (Decking/Tile Material)", 16500.00, "Prep ground and install high durability structural framing and overlay with premium exterior material matrix."],
    ["Outdoor/Drainage", "Utility Infrastructure Extension to Retaining Walls", 6800.00, "Trench and run dedicated irrigation supply mains and low-voltage electrical conduits out to retaining walls for lighting and garden systems."],
    ["Outdoor/Drainage", "Pre-Interior Finish Landscaping & Stabilization", 14500.00, "Grade soil, establish native planting layout, and stabilize yard contours before moving interior finishes forward."],
    ["Lower Level Core", "Expanded Stackable Lower Sliding Glass Door Assembly", 22000.00, "Structural framing alteration to maximize width/height opening on living side; install premium multi-panel stackable glass system."],
    ["Lower Level Core", "Lower Level Full Bathroom Gut Remodel", "=22000 + ('Dimensions & Material Specs'!E5 * 'Dimensions & Material Specs'!B18) + ('Dimensions & Material Specs'!E5 * 2.5 * 'Dimensions & Material Specs'!B20)", "Down-to-the-studs modernization. Cost dynamically aggregates a labor baseline plus tile allocations pulled natively from Specs tab values."],
    ["Lower Level Core", "Concrete Slab Micro-Polishing & Sealing", 14500.00, "Mechanically grind concrete down to an even matte, non-reflective finish across total lower level envelope; apply commercial sealer."],
    ["Upper Level Core", "Upstairs Hall Bathroom Finish Material Suite", 11200.00, "Upfront asset purchase of bathroom finish materials (vanity, fixtures, tile allocation) used across either bathroom scenario."],
    ["Upper Level Core", "House-Wide Premium Hardwood Subfloor & Flooring", "=SUM('Dimensions & Material Specs'!E6, 'Dimensions & Material Specs'!E8, 'Dimensions & Material Specs'!E10, 'Dimensions & Material Specs'!E11) * 'Dimensions & Material Specs'!B16 + 12000", "Calculates required wood cost automatically by summing upper level layouts + stairs from Specs sheet and applying the live unit variable."],
    ["HVAC System", "3-Zone Ductless Mini-Split HVAC Matrix System", 36000.00, "Decommission and extract forced-air system; route dedicated refrigerant loops for 1 lower level zone and 2 distinct upper level zones."]
  ];
  
  baseSheet.getRange(3, 1, baselineItems.length, 4).setValues(baselineItems);
  
  var baseTotalRow = 3 + baselineItems.length;
  baseSheet.getRange(baseTotalRow, 1, 1, 2).merge().setValue("TOTAL MANDATORY BASELINE INVESTMENTS").setFontWeight("bold").setHorizontalAlignment("right");
  baseSheet.getRange(baseTotalRow, 3).setValue("=SUM(C3:C" + (baseTotalRow-1) + ")").setFontWeight("bold");
  baseSheet.getRange(baseTotalRow, 1, 1, 4).setBackground(THEME.accentBg);
  
  baseSheet.getRange("C3:C" + baseTotalRow).setNumberFormat("$#,##0.00").setHorizontalAlignment("right");
  
  // ==========================================
  // INJECT PATHWAYS & SEWER ALTERNATIVES REFERENCES (ROOF/SOLAR STRIPPED)
  // ==========================================
  var altStartRow = baseTotalRow + 3;
  baseSheet.getRange(altStartRow, 1, 1, 4).merge().setValue("PLUMBING SEWER ALTERNATIVES & MAINTENANCE LEDGERS")
    .setBackground(THEME.headerBg).setFontColor(THEME.headerTextColor).setFontWeight("bold").setFontSize(11).setHorizontalAlignment("center");
  
  baseSheet.getRange(altStartRow + 1, 1, 1, 4).setValues([["Scope Category", "Alternative / Operational Variable Name", "Estimated Cost", "Strategic Execution Realities & Fluid Constraints"]])
    .setFontWeight("bold").setBackground(THEME.accentBg);
  
  var altData = [
    ["Sewer Alternate", "Backflow Preventer - Garage Slab Pathway (Recommended)", 3500.00, "Install mechanical one-way backwater valve under thin floating garage slab. Lower complexity/cost. Protects ground floor drains from storm sewer backups and external debris (wet wipes). Note: Creates a mechanical choke point; plumber must lift the flapper inside a flush garage access vault during periodic maintenance to allow equipment passage."],
    ["Sewer Alternate", "Backflow Preventer - Main House Slab Pathway (Alternative)", 5750.00, "Excavate directly into main structural home slab. Highly complex; involves indoor finished floor demolition, extensive structural dust containment, and subsequent tile reconstruction. Maintains sidewalk cleanout clear for standalone upstream jetting, but highly destructive to finished interior footprint."],
    ["Sewer Operations", "Sewer Line Preventative Hydro-Jetting (Annual Contract)", 1200.00, "Ongoing operational maintenance protocol (4x/year at $300/session) to prevent grease/solids buildup. Technical Win: Utilizes the newly identified two-way sidewalk cleanout to push a dead hose back to the backyard drain and apply high-pressure rear thrusters to drag debris out to the street main with zero lot-line property intrusion."]
  ];
  
  baseSheet.getRange(altStartRow + 2, 1, altData.length, 4).setValues(altData);
  baseSheet.getRange(altStartRow + 2, 3, altData.length, 1).setNumberFormat("$#,##0.00");
  baseSheet.getRange(altStartRow + 2, 1, altData.length, 4).setWrap(true);

  baseSheet.setColumnWidth(1, 160);
  baseSheet.setColumnWidth(2, 340);
  baseSheet.setColumnWidth(3, 140);
  baseSheet.setColumnWidth(4, 500);

  // Helper macro function to spin up Scenario Sheets uniformly
  function buildScenarioTab(tabName, specificItems) {
    var s = ss.insertSheet(tabName);
    s.setGridlinesGraphic(true);
    
    s.getRange("A1:D1").merge().setValue(tabName.toUpperCase() + " ANALYSIS MATRIX")
      .setBackground(THEME.headerBg).setFontColor(THEME.headerTextColor).setFontWeight("bold").setFontSize(11).setHorizontalAlignment("center");
    
    s.getRange("A2:D2").setValues([["Scope Category", "Scenario Specific Item Name", "Estimated Cost", "Strategic Execution & Architecture Parameters"]])
      .setFontWeight("bold").setBackground(THEME.accentBg);
    
    // Inject Scenario Unique Cost Rows
    s.getRange(3, 1, specificItems.length, 4).setValues(specificItems);
    
    var rowIdx = 3 + specificItems.length;
    
    // Add Linkage to Baseline Cost
    s.getRange(rowIdx, 1, 1, 2).merge().setValue("Carried Core Baseline Expenses (From Sheet 2)").setFontColor(THEME.textMuted).setHorizontalAlignment("right");
    s.getRange(rowIdx, 3).setValue("='The Baseline (No-Matter-What)'!C" + baseTotalRow).setFontColor(THEME.textMuted);
    rowIdx++;
    
    // Generate Subtotal Aggregations
    s.getRange(rowIdx, 1, 1, 2).merge().setValue("TOTAL PROJECT PATH ESTIMATION").setFontWeight("bold").setHorizontalAlignment("right");
    s.getRange(rowIdx, 3).setValue("=SUM(C3:C" + (rowIdx-1) + ")").setFontWeight("bold");
    s.getRange(rowIdx, 1, 1, 4).setBackground(THEME.accentBg);
    
    s.getRange("C3:C" + rowIdx).setNumberFormat("$#,##0.00").setHorizontalAlignment("right");
    s.getRange(3, 1, specificItems.length, 4).setWrap(true);
    
    s.setColumnWidth(1, 160);
    s.setColumnWidth(2, 340);
    s.setColumnWidth(3, 140);
    s.setColumnWidth(4, 500);
  }

  // ==========================================
  // TAB 3: SCENARIO 1 DATA (REACTIVE FORMULAS INJECTED)
  // ==========================================
  var s1Data = [
    ["LL Structural", "Structural Beam Intrusions & Framing Header", 52000.00, "Engineering, shoring setup, and insertion of triple 2x12 engineered headers or steel equivalents to open wall between bedroom & living room under the 6-foot upper cantilever."],
    ["LL Plumbing", "Concrete Foundation Slab Trenching (6 Linear Feet)", 18500.00, "Jackhammer lower level concrete slab to lay a dedicated drain assembly connecting directly into main sewer lateral line directly below the proposed island footprint."],
    ["LL Architecture", "Kitchen Utilities & Core Infrastructure Runs", 24000.00, "Run plumbing supply, vent vertical stack through the roof assembly, and run high-amperage dedicated lines across open floor slab."],
    ["UL Layout Mod", "Kitchen to Bedroom/Library Functional Flip", 16000.00, "Dismantle upper kitchen framing and convert into library/bedroom on paper to safeguard total residential room valuations."],
    ["UL Layout Mod", "Jack-and-Jill Bathroom Transformation & Relocation", "=25000 + ('Dimensions & Material Specs'!E6 * 'Dimensions & Material Specs'!B19) + ('Dimensions & Material Specs'!E6 * 2 * 'Dimensions & Material Specs'!B20)", "Relocate hall bath into old kitchen footprint, converting to a dual-access Jack-and-Jill suite. Taps dynamically into material specs and wet-bar framing sewer connections."],
    ["UL Layout Mod", "Laundry Conversion in Old Hall Bath Footprint", 11500.00, "Transform old bathroom. Run short-duct exterior dryer vent for lint exhaust and relocate 240V high-voltage appliance circuits."],
    ["UL Layout Mod", "Hallway Privacy Partition Assembly", 4200.00, "Construct interior partition frame and hang premium sound-insulated closing door to completely secure back bedroom zone at night."],
    ["UL Cosmetic", "Primary Bathroom Comprehensive Luxury Remodel", "=33000 + ('Dimensions & Material Specs'!E9 * 'Dimensions & Material Specs'!B17) + ('Dimensions & Material Specs'!E9 * 3 * 'Dimensions & Material Specs'!B20)", "Down to studs overhaul of primary suite bathroom calculating premium floor and wall tiles dynamically from Specs."]
  ];
  buildScenarioTab("Scenario 1 - Downstairs South (Slab Cut)", s1Data);

  // ==========================================
  // TAB 4: SCENARIO 2 DATA (REACTIVE FORMULAS INJECTED)
  // ==========================================
  var s2Data = [
    ["LL Structural", "Structural Beam Intrusions & Framing Header", 52000.00, "Identical engineering requirements to Scenario 1 to break open structural wall partition separating the bedroom from the living area below cantilever."],
    ["LL Plumbing", "Vertical Waste Line Stack-Tap Connection", 8200.00, "Zero concrete foundation floor cutting required. Mount plumbing directly through the shared bathroom wall, tapping straight into primary vertical sewer stack."],
    ["LL Architecture", "Utility Line Integration through Utility Spaces", 9500.00, "Run supply plumbing and primary electrical circuits directly behind the shared bath wall into the adjacent crawlspace, stairs storage, and garage."],
    ["UL Layout Mod", "Kitchen to Bedroom/Library Functional Flip", 16000.00, "Identical to Scenario 1: Convert old kitchen zone to a legal bedroom/library to preserve home appraisal valuation."],
    ["UL Layout Mod", "Jack-and-Jill Bathroom Transformation & Relocation", "=25000 + ('Dimensions & Material Specs'!E6 * 'Dimensions & Material Specs'!B19) + ('Dimensions & Material Specs'!E6 * 2 * 'Dimensions & Material Specs'!B20)", "Identical to Scenario 1: Relocate bath to old kitchen zone using wet-bar parameters dynamically."],
    ["UL Layout Mod", "Laundry Conversion in Old Hall Bath Footprint", 11500.00, "Identical to Scenario 1: Reconfigure old hall bath to dedicated laundry suite."],
    ["UL Layout Mod", "Hallway Privacy Partition Assembly", 4200.00, "Identical to Scenario 1: Physical privacy door install across back hallway."],
    ["UL Cosmetic", "Primary Bathroom Comprehensive Luxury Remodel", "=33000 + ('Dimensions & Material Specs'!E9 * 'Dimensions & Material Specs'!B17) + ('Dimensions & Material Specs'!E9 * 3 * 'Dimensions & Material Specs'!B20)", "Identical to Scenario 1: Complete luxury teardown and rebuild of ensuite with live specs variables."]
  ];
  buildScenarioTab("Scenario 2 - Downstairs North (Stack Tap)", s2Data);

  // ==========================================
  // TAB 5: SCENARIO 3 DATA (REACTIVE FORMULAS INJECTED)
  // ==========================================
  var s3Data = [
    ["LL Core Integration", "Lower Level Layout Retention Realities", 0.00, "Lower space footprint left unchanged. Handled entirely via the baseline polish/seal concrete execution and bathroom overhaul."],
    ["UL Structural", "Center Partition Wall Demolition (Door-Sliver Removal)", 9500.00, "Demolish the remaining non-structural partition wall leftover between previous flipper double-door cutouts to establish absolute open-plan visibility."],
    ["UL Architecture", "18-Foot Open-Concept U-Shape Spatial Rebuild", 45000.00, "Re-architect kitchen layout utilizing the entire 18-foot long profile. Install central island fixture. Specify lower cabinets only throughout entire space (no upper cabinets)."],
    ["UL Open Framing", "Exterior Window Relocation & Counter-Height Swap", 14500.00, "Decommission existing kitchen window; reframe opening higher to sit above new counter height. Relocate sink basin to new window zone."],
    ["UL Architecture", "Primary Suite Built-In Cabinet Extraction", 5500.00, "Demolish and pull out the two existing 6-foot glass-front built-in wardrobe cabinets from the primary bathroom space."],
    ["UL Plumbing/Elec", "Primary Suite Laundry Enclosure Integration", 12500.00, "Build laundry inside the old cabinet footprint. Tap plumbing into bathroom wet walls, pull 240V circuit line, and pipe exhaust into existing dryer lint vent located right behind toilet wall."],
    ["UL Cosmetic", "Primary Ensuite Full Premium Remodel", "=33000 + ('Dimensions & Material Specs'!E9 * 'Dimensions & Material Specs'!B17) + ('Dimensions & Material Specs'!E9 * 3 * 'Dimensions & Material Specs'!B20)", "Complete down-to-studs cosmetic overhauling of primary master bathroom with reactive tile integration."],
    ["UL Cosmetic", "Upper Hall Bathroom Full Premium Remodel", "=20000 + ('Dimensions & Material Specs'!E7 * 'Dimensions & Material Specs'!B19) + ('Dimensions & Material Specs'!E7 * 2.5 * 'Dimensions & Material Specs'!B20)", "Complete cosmetic overhaul of the upstairs hall bathroom in its original structural layout, scaling tile material costs natively from Specs."]
  ];
  buildScenarioTab("Scenario 3 - Upstairs U-Shape Open", s3Data);

  // ==========================================
  // TAB 6: SCENARIO 4 DATA (REACTIVE FORMULAS INJECTED)
  // ==========================================
  var s4Data = [
    ["LL Core Integration", "Lower Level Layout Retention Realities", 0.00, "Lower space footprint left unchanged. Handled entirely via the baseline polish/seal concrete execution and bathroom overhaul."],
    ["UL Cabinetry", "In-Kind L-Shape Cabinet & Stone Swap", 28000.00, "Zero wall demolition, zero structural manipulation, and zero plumbing line migration. Rebuild kitchen footprint in existing L-configuration with updated casework and stone countertops."],
    ["UL Architecture", "Primary Suite Built-In Cabinet Extraction", 5500.00, "Identical to Scenario 3: Remove the two 6-foot glass-front built-in wardrobe cabinets from the primary bathroom space."],
    ["UL Plumbing/Elec", "Primary Suite Laundry Enclosure Integration", 12500.00, "Identical to Scenario 3: Construct laundry inside old closet footprint utilizing existing plumbing and the dryer lint vent behind the toilet."],
    ["UL Cosmetic", "Primary Ensuite Full Premium Remodel", "=33000 + ('Dimensions & Material Specs'!E9 * 'Dimensions & Material Specs'!B17) + ('Dimensions & Material Specs'!E9 * 3 * 'Dimensions & Material Specs'!B20)", "Identical to Scenario 3: Complete down-to-studs cosmetic overhauling of primary master bathroom with live formula tracking."],
    ["UL Cosmetic", "Upper Hall Bathroom Full Premium Remodel", "=20000 + ('Dimensions & Material Specs'!E7 * 'Dimensions & Material Specs'!B19) + ('Dimensions & Material Specs'!E7 * 2.5 * 'Dimensions & Material Specs'!B20)", "Identical to Scenario 3: Complete cosmetic overhaul of the upstairs hall bathroom in its original structural layout, tracking tile natively."]
  ];
  buildScenarioTab("Scenario 4 - Upstairs In-Kind L-Shape", s4Data);

  // Auto-activate the specs page first
  ss.setActiveSheet(dimSheet);
}
