/**
 * Main Orchestration Loop for the Agent.
 * Recursively resolves function calls from the LLM engine.
 */
function handleAgentChat(userMessage, clientHistoryJSON) {
  var scriptProperties = PropertiesService.getScriptProperties();
  
  // Configuration Fallbacks - Replace via File > Project Settings > Script Properties or directly below
  var apiKey = scriptProperties.getProperty('API_KEY') || "YOUR_API_KEY_HERE";
  var gatewayUrl = scriptProperties.getProperty('CF_GATEWAY_URL') || "https://api.openai.com/v1/chat/completions"; 
  // If using Cloudflare AI Gateway, set URL to: https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_name}/openai/chat/completions

  var messages = [];
  
  // Set System Context anchored in the 4-Scenario Renovation Matrix
  messages.push({
    role: "system",
    content: "You are the Colby Renovation Agent, an elite automated systems engineer managing a high-performance home remodel project. " +
             "You have absolute programmatic authority to read, write, update, and clear cells across this spreadsheet using your tools. " +
             "Always verify sheet names before writing data. Be precise, concise, and report actions truthfully."
  });

  // Re-hydrate conversation history from client state
  if (clientHistoryJSON) {
    var history = JSON.parse(clientHistoryJSON);
    messages = messages.concat(history);
  }

  // Append new user intent
  messages.push({ role: "user", content: userMessage });

  // Define tools schema matching the Spreadsheet capability profile
  var tools = [
    {
      type: "function",
      function: {
        name: "getAvailableSheets",
        description: "Retrieves an array of all sheet tab names currently present in the active workbook document.",
        parameters: { type: "object", properties: {} }
      }
    },
    {
      type: "function",
      function: {
        name: "readSheetData",
        description: "Reads cell matrix data from a targeted sheet tab and specific range identifier.",
        parameters: {
          type: "object",
          properties: {
            sheetName: { type: "string", description: "The name of the tab to read from." },
            range: { type: "string", description: "Standard A1 notation range (e.g., 'A1:D10' or 'A:C')." }
          },
          required: ["sheetName", "range"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "updateSheetCell",
        description: "Overwrites or updates a single specific cell coordinates coordinates with a precise new scalar value or programmatic formula.",
        parameters: {
          type: "object",
          properties: {
            sheetName: { type: "string", description: "The name of the target sheet tab." },
            cell: { type: "string", description: "Single cell coordinate in A1 notation (e.g., 'C5')." },
            value: { type: "string", description: "The raw data, string text, or formula string to inject." }
          },
          required: ["sheetName", "cell", "value"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "appendRowToSheet",
        description: "Appends a new line item row of data to the very bottom row of a designated sheet tab layout.",
        parameters: {
          type: "object",
          properties: {
            sheetName: { type: "string", description: "The target sheet tab name." },
            rowDataArray: { 
              type: "array", 
              items: { type: "string" }, 
              description: "An ordered array of strings/numbers representing columns to write (e.g. ['Category', 'Item', '1500', 'Notes'])." 
            }
          },
          required: ["sheetName", "rowDataArray"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "clearSheetRange",
        description: "Clears contents from a specific range inside a designated sheet tab.",
        parameters: {
          type: "object",
          properties: {
            sheetName: { type: "string", description: "The name of the sheet tab." },
            range: { type: "string", description: "A1 notation range to clear completely." }
          },
          required: ["sheetName", "range"]
        }
      }
    }
  ];

  var maxRecursionLoops = 5;
  var currentIteration = 0;
  var agentExecutionLogs = [];

  while (currentIteration < maxRecursionLoops) {
    currentIteration++;

    var payload = {
      model: "google-ai-studio/gemini-3.1-flash", // Can be targeted to specific models upstream via Cloudflare AI Gateway fallbacks
      messages: messages,
      tools: tools,
      tool_choice: "auto",
      temperature: 0.2
    };

    var options = {
      method: "post",
      contentType: "application/json",
      headers: { "cf-aig-authorization": "Bearer " + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(gatewayUrl, options);
    var responseCode = response.getResponseCode();
    var responseText = response.getContentText();

    if (responseCode !== 200) {
      throw new Error("Execution Loop Interrupted. Code: " + responseCode + " | Detail: " + responseText);
    }

    var result = JSON.parse(responseText);
    var choice = result.choices[0];
    var responseMessage = choice.message;

    // Append model response back to internal loop context arrays
    messages.push(responseMessage);

    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      // Execute each requested tool in parallel/sequence
      for (var i = 0; i < responseMessage.tool_calls.length; i++) {
        var toolCall = responseMessage.tool_calls[i];
        var functionName = toolCall.function.name;
        var functionArgs = JSON.parse(toolCall.function.arguments);
        
        agentExecutionLogs.push("Executing: " + functionName + " with parameters " + toolCall.function.arguments);

        var toolExecutionResult = "";
        try {
          toolExecutionResult = executeLocalSpreadsheetTool(functionName, functionArgs);
        } catch (err) {
          toolExecutionResult = "Execution Error: " + err.toString();
        }

        // Return tool output back into messages payload matrix
        messages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: functionName,
          content: toolExecutionResult
        });
      }
      // Continue loop iteration to feed data back to model for next thinking step
    } else {
      // No further tool calls requested, agent has finished formulating final summary statement
      return JSON.stringify({
        finalResponse: responseMessage.content,
        updatedHistory: messages.slice(1), // Omit the long system prompt to optimize storage footprint
        executionLogs: agentExecutionLogs
      });
    }
  }

  return JSON.stringify({
    finalResponse: "Error: Maximum recursive agent safety loop depth exceeded without resolution.",
    updatedHistory: messages.slice(1),
    executionLogs: agentExecutionLogs
  });
}

/**
 * Tool Execution Switch Matrix
 * Direct structural bindings to Google Apps Script Spreadsheet API
 */
function executeLocalSpreadsheetTool(name, args) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  switch (name) {
    case "getAvailableSheets":
      var sheets = ss.getSheets();
      var names = sheets.map(function(s) { return s.getName(); });
      return JSON.stringify({ existingTabs: names });
      
    case "readSheetData":
      var targetSheet = ss.getSheetByName(args.sheetName);
      if (!targetSheet) return "Error: Tab designated as '" + args.sheetName + "' does not exist.";
      var values = targetSheet.getRange(args.range).getValues();
      return JSON.stringify({ rangeData: values });
      
    case "updateSheetCell":
      var targetSheet = ss.getSheetByName(args.sheetName);
      if (!targetSheet) return "Error: Tab designated as '" + args.sheetName + "' does not exist.";
      var range = targetSheet.getRange(args.cell);
      
      if (args.value.toString().startsWith("=")) {
        range.setFormula(args.value);
      } else {
        range.setValue(args.value);
      }
      SpreadsheetApp.flush(); // Enforce layout calculation immediately
      return "Success: Written value into coordinates " + args.cell + " on tab " + args.sheetName;
      
    case "appendRowToSheet":
      var targetSheet = ss.getSheetByName(args.sheetName);
      if (!targetSheet) return "Error: Tab designated as '" + args.sheetName + "' does not exist.";
      targetSheet.appendRow(args.rowDataArray);
      SpreadsheetApp.flush();
      return "Success: Row appended to bottom of " + args.sheetName;
      
    case "clearSheetRange":
      var targetSheet = ss.getSheetByName(args.sheetName);
      if (!targetSheet) return "Error: Tab designated as '" + args.sheetName + "' does not exist.";
      targetSheet.getRange(args.range).clearContent();
      SpreadsheetApp.flush();
      return "Success: Contents stripped out from range " + args.range + " on tab " + args.sheetName;
      
    default:
      throw new Error("Tool function identifier mapping mismatch exception.");
  }
}
