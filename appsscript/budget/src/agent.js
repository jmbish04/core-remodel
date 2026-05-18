function resolveResponseMessage(result) {
  if (result && result.choices && result.choices.length > 0 && result.choices[0].message) {
    return result.choices[0].message;
  }

  if (result && result.result && typeof result.result.response === 'string') {
    return { role: 'assistant', content: result.result.response };
  }

  if (result && typeof result.response === 'string') {
    return { role: 'assistant', content: result.response };
  }

  if (typeof result === 'string') {
    return { role: 'assistant', content: result };
  }

  return {
    role: 'assistant',
    content: JSON.stringify(result || { error: 'Empty response payload' }),
  };
}

function coerceAssistantContentToString(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map(function(part) {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return JSON.stringify(part);
      })
      .join('\n');
  }
  if (content && typeof content.text === 'string') {
    return content.text;
  }
  if (content == null) {
    return '';
  }
  return JSON.stringify(content);
}

function stripJsonFence(value) {
  if (!value) return '';
  return String(value)
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/, '')
    .trim();
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function looksLikeA2UiUpdate(value) {
  if (!value || typeof value !== 'object') return false;
  return Boolean(value.beginRendering || value.surfaceUpdate || value.dataModelUpdate);
}

function normalizeA2UiPayload(value) {
  if (Array.isArray(value) && value.every(looksLikeA2UiUpdate)) {
    return value;
  }
  if (looksLikeA2UiUpdate(value)) {
    return [value];
  }
  return null;
}

function parseA2UiPayload(rawText) {
  var text = typeof rawText === 'string' ? rawText.trim() : '';
  var marker = '---a2ui_JSON---';

  if (!text) {
    return { text: 'No response from agent.', uiJson: null };
  }

  if (text.indexOf(marker) >= 0) {
    var chunks = text.split(marker);
    var summaryText = chunks[0].trim();
    var jsonCandidate = stripJsonFence(chunks.slice(1).join(marker));
    var parsed = normalizeA2UiPayload(tryParseJson(jsonCandidate));
    if (parsed) {
      return { text: summaryText, uiJson: parsed };
    }
    return { text: summaryText || text, uiJson: null };
  }

  var entireParsed = normalizeA2UiPayload(tryParseJson(stripJsonFence(text)));
  if (entireParsed) {
    return { text: 'Structured response rendered.', uiJson: entireParsed };
  }

  return { text: text, uiJson: null };
}

function buildFallbackA2UiSurfaceFromText(text) {
  var safeText = (text || 'No response generated.').trim();
  return [
    {
      beginRendering: {
        surfaceId: 'default',
        root: 'root-column',
        styles: {
          primaryColor: '#0f766e',
          font: 'Inter',
        },
      },
    },
    {
      surfaceUpdate: {
        surfaceId: 'default',
        components: [
          {
            id: 'root-column',
            component: {
              Column: {
                children: {
                  explicitList: ['title-text', 'body-card'],
                },
              },
            },
          },
          {
            id: 'title-text',
            component: {
              Text: {
                usageHint: 'h2',
                text: { path: 'title' },
              },
            },
          },
          {
            id: 'body-card',
            component: {
              Card: {
                child: 'body-text',
              },
            },
          },
          {
            id: 'body-text',
            component: {
              Text: {
                usageHint: 'body',
                text: { path: 'body' },
              },
            },
          },
        ],
      },
    },
    {
      dataModelUpdate: {
        surfaceId: 'default',
        path: '/',
        contents: [
          { key: 'title', valueString: 'Renovation Agent' },
          { key: 'body', valueString: safeText },
        ],
      },
    },
  ];
}

function normalizeConversationHistory(clientHistoryJSON) {
  if (!clientHistoryJSON) return [];
  try {
    var parsed = JSON.parse(clientHistoryJSON);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(function(entry) {
        return entry && typeof entry === 'object' && typeof entry.role === 'string';
      })
      .map(function(entry) {
        return {
          role: entry.role,
          content: coerceAssistantContentToString(entry.content),
        };
      });
  } catch (_error) {
    return [];
  }
}

function trimConversationHistory(history) {
  var maxMessages = 24;
  if (!Array.isArray(history) || history.length <= maxMessages) {
    return history || [];
  }
  return history.slice(history.length - maxMessages);
}

function callWorkerChatApi_(chatApiUrl, messages) {
  var scriptProperties = PropertiesService.getScriptProperties();
  var workerApiKey = scriptProperties.getProperty('WORKER_API_KEY') || scriptProperties.getProperty('API_KEY') || '';
  var chatModel = scriptProperties.getProperty('CHAT_MODEL') || '@cf/openai/gpt-oss-120b';

  if (!workerApiKey) {
    throw new Error('Missing WORKER_API_KEY script property.');
  }
  if (!chatApiUrl) {
    throw new Error('Missing worker chat API URL.');
  }

  var payload = {
    model: chatModel,
    messages: messages,
  };

  var response = UrlFetchApp.fetch(chatApiUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + workerApiKey,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var status = response.getResponseCode();
  var responseText = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error('Worker API error (' + status + '): ' + responseText);
  }

  try {
    return JSON.parse(responseText);
  } catch (_error) {
    return { response: responseText };
  }
}

function processUserRequest(userQuery, clientHistoryJSON, chatApiUrlFromTemplate) {
  var apiConfig = getApiConfig();
  var chatApiUrl = chatApiUrlFromTemplate || apiConfig.chatApiUrl;
  var prompt = getRenovationAgentSystemPrompt();
  var history = normalizeConversationHistory(clientHistoryJSON);
  var cleanQuery = (userQuery || '').trim();

  if (!cleanQuery) {
    return {
      text: 'Please enter a request.',
      uiJson: buildFallbackA2UiSurfaceFromText('Please enter a request.'),
      updatedHistory: history,
      executionLogs: [],
    };
  }

  var messages = [{ role: 'system', content: prompt }]
    .concat(history)
    .concat([{ role: 'user', content: cleanQuery }]);

  var executionLogs = ['Calling worker chat endpoint: ' + chatApiUrl];
  var result = callWorkerChatApi_(chatApiUrl, messages);
  var responseMessage = resolveResponseMessage(result);
  var assistantText = coerceAssistantContentToString(responseMessage.content).trim();
  var parsed = parseA2UiPayload(assistantText);

  var updatedHistory = trimConversationHistory(
    history.concat([
      { role: 'user', content: cleanQuery },
      { role: 'assistant', content: assistantText },
    ]),
  );

  return {
    text: parsed.text,
    uiJson: parsed.uiJson || buildFallbackA2UiSurfaceFromText(parsed.text),
    updatedHistory: updatedHistory,
    executionLogs: executionLogs,
  };
}

function handleAgentChat(userMessage, clientHistoryJSON, chatApiUrlFromTemplate) {
  var response = processUserRequest(userMessage, clientHistoryJSON, chatApiUrlFromTemplate);
  return JSON.stringify({
    finalResponse: response.text,
    updatedHistory: response.updatedHistory,
    executionLogs: response.executionLogs || [],
    uiJson: response.uiJson || null,
  });
}

function executeLocalSpreadsheetTool(name, args) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  switch (name) {
    case 'getAvailableSheets': {
      var sheets = ss.getSheets();
      var names = sheets.map(function(s) {
        return s.getName();
      });
      return JSON.stringify({ existingTabs: names });
    }
    case 'readSheetData': {
      var targetSheet = ss.getSheetByName(args.sheetName);
      if (!targetSheet) return "Error: Tab designated as '" + args.sheetName + "' does not exist.";
      var values = targetSheet.getRange(args.range).getValues();
      return JSON.stringify({ rangeData: values });
    }
    case 'updateSheetCell': {
      var updateSheet = ss.getSheetByName(args.sheetName);
      if (!updateSheet) return "Error: Tab designated as '" + args.sheetName + "' does not exist.";
      var range = updateSheet.getRange(args.cell);
      if (args.value.toString().startsWith('=')) {
        range.setFormula(args.value);
      } else {
        range.setValue(args.value);
      }
      SpreadsheetApp.flush();
      return 'Success: Written value into coordinates ' + args.cell + ' on tab ' + args.sheetName;
    }
    case 'appendRowToSheet': {
      var appendSheet = ss.getSheetByName(args.sheetName);
      if (!appendSheet) return "Error: Tab designated as '" + args.sheetName + "' does not exist.";
      appendSheet.appendRow(args.rowDataArray);
      SpreadsheetApp.flush();
      return 'Success: Row appended to bottom of ' + args.sheetName;
    }
    case 'clearSheetRange': {
      var clearSheet = ss.getSheetByName(args.sheetName);
      if (!clearSheet) return "Error: Tab designated as '" + args.sheetName + "' does not exist.";
      clearSheet.getRange(args.range).clearContent();
      SpreadsheetApp.flush();
      return 'Success: Contents stripped out from range ' + args.range + ' on tab ' + args.sheetName;
    }
    default:
      throw new Error('Tool function identifier mapping mismatch exception.');
  }
}
