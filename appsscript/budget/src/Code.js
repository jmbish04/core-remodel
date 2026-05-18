/**
 * The Monolith: Sheet Agent Engine with Native Function Calling
 * Runtime: Google Apps Script
 */

// Initialize Custom Menu
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Architect Engine')
    .addItem('Open A2UI Renovation Agent', 'showSidebar')
    .addItem('Export Selected Tab as JSON', 'exportActiveTabAsJson')
    .addToUi();
}

// Inject and Display Sidebar Canvas
function showSidebar() {
  var template = HtmlService.createTemplateFromFile('Sidebar');
  var apiConfig = getApiConfig();
  template.chatApiUrl = apiConfig.chatApiUrl;
  template.chatStreamApiUrl = apiConfig.chatStreamApiUrl;

  var html = template
    .evaluate()
    .setTitle('A2UI Renovation Agent')
    .setWidth(400);
  SpreadsheetApp.getUi().showSidebar(html);
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
    'Created file: ' + file.getName() + '\n' + file.getUrl(),
    ui.ButtonSet.OK
  );
}
