
const API_BASE_URL = "https://core-remodel.hacolby.workers.dev/api/sync/google-sheets"; // Replace with actual domain later

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("Architect Engine")
    .addItem("Show Sidebar", "showSidebar")
    .addItem("Pull & Sync Database", "syncAndCompileBudget")
    .addItem("Push Current State", "pushCurrentStateToDatabase")
    .addItem('Export Selected Tab as JSON', 'exportActiveTabAsJson')
    .addToUi();
}


function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile("Sidebar")
    .setTitle("Renovation Agent")
    .setWidth(550);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Used by Sidebar to execute modifications directed by the Edge Agent via WebSocket
 */
function executeAgentCommand(commandJson) {
  try {
    var cmd = JSON.parse(commandJson);
    if (cmd.action === "UPDATE_CELL") {
      // Locate ID and update costExpression
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName("Overview & Portfolio Matrix");
      var data = sheet.getDataRange().getValues();

      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === cmd.params.id) {
          sheet.getRange(i + 1, 5).setValue(cmd.params.costExpression); // Col 5 is Cost Expression
          return JSON.stringify({ success: true, updatedRow: i + 1 });
        }
      }
      return JSON.stringify({ success: false, reason: "ID not found" });
    }
    return JSON.stringify({ success: false, reason: "Unknown command" });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}



