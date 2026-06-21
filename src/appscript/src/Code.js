/**
 * The Monolith: Sheet Agent Engine with Native Function Calling
 * Runtime: Google Apps Script
 */

// Initialize Custom Menu
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Architect Engine')
    .addItem('Open A2UI Renovation Agent', 'showSidebar')
    .addItem('Open A2A Agent V2 (Grid)', 'showSidebarV2')
    .addItem('Export Selected Tab as JSON', 'exportActiveTabAsJson')
    .addItem('Export All Tabs as JSON', 'exportAllTabsAsJson')
    .addToUi();
}

// Get Api config
function getApiConfig() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const API_URL_BASE_WORKER = scriptProperties.getProperty('API_URL_BASE_WORKER');
  
  return {
    baseApiUrl: API_URL_BASE_WORKER,
    sheetsPushApiUrl: `${API_URL_BASE_WORKER}/api/sync/google-sheets/push`,
    sheetsPullApiUrl: `${API_URL_BASE_WORKER}/api/sync/google-sheets/pull`,
    sheetsStatusApiUrl: `${API_URL_BASE_WORKER}/api/sync/google-sheets/status`,
    sheetsTemplateApiUrl: `${API_URL_BASE_WORKER}/api/sync/google-sheets/template?includeWorkbook=true`,
    chatApiUrl: `${API_URL_BASE_WORKER}/api/ai/chat`,
    chatStreamApiUrl: `${API_URL_BASE_WORKER}/api/ai/chat/stream`,
    a2aV2Url: `${API_URL_BASE_WORKER}/a2a-v2`,
  };
}


// Inject and Display Sidebar Canvas
function showSidebar() {
  const template = HtmlService.createTemplateFromFile('Sidebar');
  const apiConfig = getApiConfig();
  
  // Convert the configuration object into a JSON string
  template.apiConfigJson = JSON.stringify(apiConfig);

  const html = template
    .evaluate()
    .setTitle('A2UI Renovation Agent')
    .setWidth(400);
  SpreadsheetApp.getUi().showSidebar(html);
}

function showSidebarV2() {
  const template = HtmlService.createTemplateFromFile('SidebarV2');
  const apiConfig = getApiConfig();

  template.apiConfigJson = JSON.stringify(apiConfig);

  const html = template
    .evaluate()
    .setTitle('A2A Agent V2 - Grid Sync')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

function parseGridCsv_(csvText) {
  try {
    const parsed = Utilities.parseCsv(csvText);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (_error) {
    // Fall through to resilient parser.
  }

  const lines = String(csvText || '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  return lines.map((line) => [line]);
}

function normalizeGridRows_(rows) {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    const next = row.slice();
    while (next.length < width) next.push('');
    return next;
  });
}

/**
 * Writes <sheet-grid> CSV payload to the active range. Falls back to single-cell text.
 * @param {string} rawPayload
 */
function writeGridToSheet(rawPayload) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const activeCell = sheet.getActiveCell();
  const payload = String(rawPayload || '');

  const gridMatch = payload.match(/<sheet-grid>([\s\S]*?)<\/sheet-grid>/i);
  if (!gridMatch || !gridMatch[1]) {
    activeCell.setValue(payload.trim() || 'No grid payload found.');
    return;
  }

  const csvContent = gridMatch[1].trim();
  if (!csvContent) {
    activeCell.setValue('Grid payload was empty.');
    return;
  }

  const parsedRows = parseGridCsv_(csvContent);
  if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
    activeCell.setValue(csvContent);
    return;
  }

  const normalized = normalizeGridRows_(parsedRows);
  const startRow = activeCell.getRow();
  const startCol = activeCell.getColumn();
  const numRows = normalized.length;
  const numCols = normalized[0] ? normalized[0].length : 0;

  if (numCols === 0) {
    activeCell.setValue('Grid payload was empty.');
    return;
  }

  const target = sheet.getRange(startRow, startCol, numRows, numCols);
  target.clearContent();
  target.setValues(normalized);
  target.setBackground('#d4edda');
  SpreadsheetApp.flush();
  Utilities.sleep(300);
  target.setBackground(null);
}
