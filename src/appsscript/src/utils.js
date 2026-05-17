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
  existingSheets.forEach(function(sheet) {
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
