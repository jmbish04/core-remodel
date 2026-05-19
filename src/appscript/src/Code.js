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

