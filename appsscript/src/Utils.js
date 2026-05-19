/**
 * Deletes sheets from a spreadsheet by iterating through existing sheets
 * and checking if their names match any in the provided target array.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - The live spreadsheet instance.
 * @param {string[]} sheetsToClear - Array of sheet names targeted for deletion.
 */
function deleteSheetsByMatchingNames_(ss, sheetsToClear) {
  if (!ss || !Array.isArray(sheetsToClear) || sheetsToClear.length === 0) {
    console.log("Invalid spreadsheet object or empty sheetsToClear array provided.");
    return false;
  }
  var existingSheets = ss.getSheets();
  existingSheets.forEach(function (sheet) {
    var sheetName = sheet.getName();
    if (sheetsToClear.includes(sheetName)) {
      try {
        ss.deleteSheet(sheet);
        console.log(`Successfully deleted sheet: "${sheetName}"`);
      } catch (error) {
        console.log(`Error when trying to delete sheet "${sheetName}". Error: ${error.toString()}`);
      }
    }
  });
  return true;
}

/**
 * Helper function to map a JSON array to a 2D sheet range.
 * * @param {SpreadsheetApp.Spreadsheet} spreadsheet - The active spreadsheet object
 * @param {string} sheetName - The name of the tab to create/update
 * @param {Array<Object>} dataArray - The parsed JSON array
 */
function writeToSheet(spreadsheet, sheetName, dataArray) {
  // Get or create the target sheet
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  } else {
    // Clear existing data if the sheet already exists to ensure a clean overwrite
    sheet.clear(); 
  }

  // Extract column headers dynamically from the first object
  const headers = Object.keys(dataArray[0]);
  
  // Map JSON object data to a 2D array matrix required by Apps Script
  const rows = dataArray.map(obj => {
    return headers.map(header => {
      let val = obj[header];
      
      // Stringify nested arrays (e.g., 'revisions', 'NOTES') using the ' | ' delimiter
      // This mimics the Python formatting we established previously.
      if (Array.isArray(val)) {
        return val.join(" | ");
      }
      
      // Handle null or undefined
      if (val === null || val === undefined) {
        return "";
      }

      return val;
    });
  });

  // Combine headers and rows
  const finalData = [headers].concat(rows);

  // Write to sheet: getRange(row, column, numRows, numColumns)
  sheet.getRange(1, 1, finalData.length, headers.length).setValues(finalData);
  
  // Format the sheet for readability
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold"); // Bold headers
  sheet.getRange(1, 1, 1, headers.length).setBackground("#e0e0e0"); // Light gray header background
  
  // Auto-resize columns to fit the content
  sheet.autoResizeColumns(1, headers.length);
}

function exportActiveTabAsJson() {
  var ui = SpreadsheetApp.getUi();
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getActiveSheet();

  if (!sheet) {
    ui.alert('No active sheet selected.');
    return;
  }

  var values = sheet.getDataRange().getValues();
  var headers = values.length > 0 ? values[0] : [];
  var bodyRows = values.length > 1 ? values.slice(1) : [];

  var rows = bodyRows.map(function(row) {
    var record = {};
    for (var i = 0; i < headers.length; i += 1) {
      var key = headers[i] !== '' ? String(headers[i]) : 'column_' + (i + 1);
      record[key] = row[i];
    }
    return record;
  });

  var payload = {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    sheetName: sheet.getName(),
    exportedAt: new Date().toISOString(),
    headerColumns: headers,
    rowCount: rows.length,
    rows: rows
  };

  var safeSheetName = sheet.getName().replace(/[^a-z0-9-_]+/gi, '_');
  var timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd_HHmmss'
  );
  var fileName = safeSheetName + '_export_' + timestamp + '.json';
  var json = JSON.stringify(payload, null, 2);
  var file = DriveApp.createFile(fileName, json, MimeType.PLAIN_TEXT);

  ui.alert(
    'JSON export complete',
    `Created file:  ${file.getName()} \n ${file.getDownloadUrl()}`,
    ui.ButtonSet.OK
  );
}


// Export current sheet as JSON
function exportActiveTabAsJson() {
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();

  if (!sheet) {
    ui.alert('No active sheet selected.');
    return;
  }

  const values = sheet.getDataRange().getValues();
  const headers = values.length > 0 ? values[0] : [];
  const bodyRows = values.length > 1 ? values.slice(1) : [];

  const rows = bodyRows.map(function(row) {
    const record = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i] !== '' ? String(headers[i]) : 'column_' + (i + 1);
      record[key] = row[i];
    }
    return record;
  });

  const payload = {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    sheetName: sheet.getName(),
    exportedAt: new Date().toISOString(),
    headerColumns: headers,
    rowCount: rows.length,
    rows: rows
  };

  const safeSheetName = sheet.getName().replace(/[^a-z0-9-_]+/gi, '_');
  const timestamp = Utilities.formatDate(
    new Date(),
    'America/Los_Angeles',
    'yyyyMMdd_HHmmss'
  );
  const fileName = safeSheetName + '_export_' + timestamp + '.json';
  const json = JSON.stringify(payload, null, 2);
  const file = DriveApp.createFile(fileName, json, MimeType.PLAIN_TEXT);

  ui.alert(
    'JSON export complete',
    `Created file: ${file.getName()} 
    
    Download here:
    ${file.getDownloadUrl()}
    `,
    ui.ButtonSet.OK
  );
}

// Export all sheets as JSON
function exportAllTabsAsJson() {
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = spreadsheet.getSheets();

  if (!sheets || sheets.length === 0) {
    ui.alert('No sheets found in this spreadsheet.');
    return;
  }

  const allSheetsData = sheets.map(function(sheet) {
    const values = sheet.getDataRange().getValues();
    const headers = values.length > 0 ? values[0] : [];
    const bodyRows = values.length > 1 ? values.slice(1) : [];

    const rows = bodyRows.map(function(row) {
      const record = {};
      for (let i = 0; i < headers.length; i += 1) {
        const key = headers[i] !== '' ? String(headers[i]) : 'column_' + (i + 1);
        record[key] = row[i];
      }
      return record;
    });

    return {
      sheetName: sheet.getName(),
      headerColumns: headers,
      rowCount: rows.length,
      rows: rows
    };
  });

  const payload = {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    exportedAt: new Date().toISOString(),
    totalSheets: sheets.length,
    sheets: allSheetsData
  };

  const safeSpreadsheetName = spreadsheet.getName().replace(/[^a-z0-9-_]+/gi, '_');
  const timestamp = Utilities.formatDate(
    new Date(),
    'America/Los_Angeles',
    'yyyyMMdd_HHmmss'
  );
  const fileName = safeSpreadsheetName + '_all_tabs_export_' + timestamp + '.json';
  const json = JSON.stringify(payload, null, 2);
  const file = DriveApp.createFile(fileName, json, MimeType.PLAIN_TEXT);

  ui.alert(
    'Full JSON export complete',
    `Created file: ${file.getName()}\n\nDownload here:\n${file.getDownloadUrl()}`,
    ui.ButtonSet.OK
  );
}
