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
