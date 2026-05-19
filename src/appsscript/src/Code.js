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

// Get Api config
function getApiConfig() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const API_URL_BASE_WORKER = scriptProperties.getProperty('API_URL_BASE_WORKER');
  https://core-remodel.hacolby.workers.dev/api/sync/google-sheets/pull
  return {
    baseApiUrl: API_URL_BASE_WORKER,
    sheetsPushApiUrl: `${API_URL_BASE_WORKER}/api/sync/google-sheets/push`,
    sheetsPullApiUrl: `${API_URL_BASE_WORKER}/api/sync/google-sheets/pull`,
    sheetsStatusApiUrl: `${API_URL_BASE_WORKER}/api/sync/google-sheets/status`,
    sheetsTemplateApiUrl: `${API_URL_BASE_WORKER}/api/sync/google-sheets/template?includeWorkbook=true`,
    chatApiUrl: `${API_URL_BASE_WORKER}/api/ai/chat`,
    chatStreamApiUrl: `${API_URL_BASE_WORKER}/api/ai/chat/stream`,
  };
}


// Inject and Display Sidebar Canvas
function showSidebar() {
  const template = HtmlService.createTemplateFromFile('Sidebar');
  const apiConfig = getApiConfig();
  template.chatApiUrl = apiConfig.chatApiUrl;
  template.chatStreamApiUrl = apiConfig.chatStreamApiUrl;

  const html = template
    .evaluate()
    .setTitle('A2UI Renovation Agent')
    .setWidth(400);
  SpreadsheetApp.getUi().showSidebar(html);
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
