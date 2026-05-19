/**
 * Budget Sync & Compilation Engine
 * Dynamically fetches active state parameters from the Hono API backend,
 * reconstructs structural dashboards via Visual Diff parser, and applies conditional formatting.
 */

const API_CONFIG = getApiConfig();

/**
 * Main routine: pulls data and builds dashboard, applying visual delta diffing.
 */
function syncAndCompileBudget() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Tabs to recreate
  const tabsToRecreate = [
    "Overview & Portfolio Matrix",
    "Dimensions & Material Specs",
    "The Baseline (No-Matter-What)",
    "Scenario A - Kitchen Downstairs South (Slab Cut)",
    "Scenario B - Kitchen Downstairs North (U-Shape)",
    "Scenario C - Kitchen Upstairs (U-Shape)", 
    "Scenario D - Kitchen Upstairs (In-Kind, L-Shape)"    
  ];

  let syncLogsSheet = ss.getSheetByName("Sync Logs");

  if (!syncLogsSheet) {
    syncLogsSheet = ss.insertSheet("Sync Logs");
  } else {
    syncLogsSheet.clear();
  }

  syncLogsSheet.appendRow(["Timestamp", "Row ID", "Action", "Details"]);
  let response;
  
  try {
    response = UrlFetchApp.fetch(`${API_CONFIG.sheetsPullApiUrl}`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({}),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      throw new Error("Failed to fetch from /pull: " + response.getContentText());
    }

    const parsedResponse = JSON.parse(response.getContentText());
    const data = parsedResponse.data || parsedResponse.workbook?.tabs?.["Overview & Portfolio Matrix"] || [];

    // Process each tab layout identically for this basic implementation as per requirement
    tabsToRecreate.forEach(function (tabName) {
      const sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);

      // Store old data for visual diffing
      const oldDataMap = {};
      if (sheet.getLastRow() > 1) {
        const oldValues = sheet.getDataRange().getValues();
        for (let i = 1; i < oldValues.length; i++) {
          const rowId = oldValues[i][0];
          if (rowId) {
            oldDataMap[rowId] = {
              category: oldValues[i][1],
              itemName: oldValues[i][2],
              description: oldValues[i][3],
              costExpression: oldValues[i][4],
            };
          }
        }
      }

      // Clear and Build Headers
      sheet.clear();
      sheet.appendRow(["ID", "Category", "Item Name", "Description", "Cost Expression", "Status"]);

      let rowIdx = 2;
      data.forEach(function (record) {
        sheet.appendRow([
          record.id,
          record.category,
          record.itemName,
          record.description,
          record.costExpression,
          record.isActive !== false ? "Active" : "Inactive",
        ]);

        const range = sheet.getRange(rowIdx, 1, 1, 6);

        if (record.isActive === false) {
          range.setBackground("#ffcccc"); // Red for inactive
          syncLogsSheet.appendRow([
            new Date(),
            record.id,
            "INACTIVE",
            "Row flagged as inactive in DB",
          ]);
        } else {
          const oldRecord = oldDataMap[record.id];
          let isChanged = false;

          if (oldRecord) {
            if (oldRecord.costExpression != record.costExpression) {
              isChanged = true;
              syncLogsSheet.appendRow([
                new Date(),
                record.id,
                "MODIFIED",
                `costExpression: ${oldRecord.costExpression} -> ${record.costExpression}`,
              ]);
            }
            if (oldRecord.category != record.category) {
              isChanged = true;
              syncLogsSheet.appendRow([
                new Date(),
                record.id,
                "MODIFIED",
                `category: ${oldRecord.category} -> ${record.category}`,
              ]);
            }
          } else {
            // New record
            isChanged = true;
            syncLogsSheet.appendRow([new Date(), record.id, "NEW", "New row added"]);
          }

          if (isChanged) {
            range.setBackground("#ffffcc"); // Yellow for changed
          } else {
            range.setBackground("#ffffff");
          }
        }

        rowIdx++;
      });
    });

    SpreadsheetApp.getUi().alert("Sync complete. Matrix tabs updated.");
  } catch (error) {
    SpreadsheetApp.getUi().alert(`Error during sync: ${error.toString()}`);
  }
}

/**
 * Pushes spreadsheet cell array matrices to the /push endpoint.
 */
function pushCurrentStateToDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Overview & Portfolio Matrix");

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Matrix sheet not found.");
    return;
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  if (values.length <= 1) return; // Only headers

  const payload = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    payload.push({
      id: row[0].toString(),
      category: row[1].toString(),
      itemName: row[2].toString(),
      description: row[3].toString(),
      costExpression: row[4].toString(), // Can be raw formula strings like '=SUM(A1:B1)'
    });
  }

  let options;

  try {
    options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ data: payload }),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(`${API_CONFIG.sheetsPushApiUrl}`, options);

    if (response.getResponseCode() === 200) {
      SpreadsheetApp.getUi().alert(`Push successful! 🎉 Database transaction complete.`);
    } else {
      SpreadsheetApp.getUi().alert(`Push failed 😒 ${response.getContentText()}`);
    }
  } catch (err) {
    SpreadsheetApp.getUi().alert(`Connection Error: 😤 ${err.toString()}`);
  }
}
