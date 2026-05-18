/**
 * Budget Sync & Compilation Engine
 * Dynamically fetches active state parameters from the Hono API backend,
 * reconstructs structural dashboards via Visual Diff parser, and applies conditional formatting.
 */



/**
 * Main routine: pulls data and builds dashboard, applying visual delta diffing.
 */
function syncAndCompileBudget() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Tabs to recreate
  var tabsToRecreate = [
    "Overview & Portfolio Matrix",
    "Dimensions & Material Specs",
    "The Baseline (No-Matter-What)",
    "Scenario A - Kitchen Upstairs",
    "Scenario B - Kitchen Downstairs",
  ];

  var syncLogsSheet = ss.getSheetByName("Sync Logs");

  if (!syncLogsSheet) {
    syncLogsSheet = ss.insertSheet("Sync Logs");
  } else {
    syncLogsSheet.clear();
  }

  syncLogsSheet.appendRow(["Timestamp", "Row ID", "Action", "Details"]);

  try {
    var response = UrlFetchApp.fetch(`${API_BASE_URL}/pull`, {
      method: "get",
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      throw new Error("Failed to fetch from /pull: " + response.getContentText());
    }

    var data = JSON.parse(response.getContentText()).data;

    // Process each tab layout identically for this basic implementation as per requirement
    tabsToRecreate.forEach(function (tabName) {
      var sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);

      // Store old data for visual diffing
      var oldDataMap = {};
      if (sheet.getLastRow() > 1) {
        var oldValues = sheet.getDataRange().getValues();
        for (var i = 1; i < oldValues.length; i++) {
          var rowId = oldValues[i][0];
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

      var rowIdx = 2;
      data.forEach(function (record) {
        sheet.appendRow([
          record.id,
          record.category,
          record.itemName,
          record.description,
          record.costExpression,
          record.isActive ? "Active" : "Inactive",
        ]);

        var range = sheet.getRange(rowIdx, 1, 1, 6);

        if (!record.isActive) {
          range.setBackground("#ffcccc"); // Red for inactive
          syncLogsSheet.appendRow([
            new Date(),
            record.id,
            "INACTIVE",
            "Row flagged as inactive in DB",
          ]);
        } else {
          var oldRecord = oldDataMap[record.id];
          var isChanged = false;

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
    SpreadsheetApp.getUi().alert("Error during sync: " + error.message);
  }
}

/**
 * Pushes spreadsheet cell array matrices to the /push endpoint.
 */
function pushCurrentStateToDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Overview & Portfolio Matrix");

  if (!sheet) {
    SpreadsheetApp.getUi().alert("Matrix sheet not found.");
    return;
  }

  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();

  if (values.length <= 1) return; // Only headers

  var payload = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    payload.push({
      id: row[0].toString(),
      category: row[1].toString(),
      itemName: row[2].toString(),
      description: row[3].toString(),
      costExpression: row[4].toString(), // Can be raw formula strings like '=SUM(A1:B1)'
    });
  }

  try {
    var options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ data: payload }),
      muteHttpExceptions: true,
    };

    var response = UrlFetchApp.fetch(`${API_BASE_URL}/push`, options);

    if (response.getResponseCode() === 200) {
      SpreadsheetApp.getUi().alert("Push successful. Database transaction complete.");
    } else {
      SpreadsheetApp.getUi().alert("Push failed: " + response.getContentText());
    }
  } catch (err) {
    SpreadsheetApp.getUi().alert("Connection Error: " + err.message);
  }
}
