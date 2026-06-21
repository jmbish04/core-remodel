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

function truncateForLog(value, maxLength) {
  var limit = typeof maxLength === 'number' ? maxLength : 400;
  var text = value == null ? '' : String(value);
  if (text.length <= limit) {
    return text;
  }
  return text.slice(0, limit) + '... [truncated ' + (text.length - limit) + ' chars]';
}

function summarizeResponseShape(result) {
  if (result == null) {
    return 'null-or-undefined';
  }
  if (typeof result === 'string') {
    return 'string-response chars=' + result.length;
  }
  if (typeof result !== 'object') {
    return 'non-object response type=' + typeof result;
  }

  var summaryParts = [];
  var keys = Object.keys(result);
  summaryParts.push('keys=' + (keys.length ? keys.join(',') : '(none)'));

  if (Array.isArray(result.choices)) {
    summaryParts.push('choices=' + result.choices.length);
    if (result.choices.length > 0 && result.choices[0] && result.choices[0].message) {
      var messageKeys = Object.keys(result.choices[0].message);
      summaryParts.push('choices[0].messageKeys=' + (messageKeys.length ? messageKeys.join(',') : '(none)'));
    }
  }

  if (result.result && typeof result.result === 'object') {
    var resultKeys = Object.keys(result.result);
    summaryParts.push('result.keys=' + (resultKeys.length ? resultKeys.join(',') : '(none)'));
  }

  if (Array.isArray(result.output)) {
    summaryParts.push('output=' + result.output.length);
  }

  return summaryParts.join(' | ');
}

function pushTextCandidate(candidates, source, value) {
  if (value == null) return;
  var text = coerceAssistantContentToString(value).trim();
  if (!text) return;
  candidates.push({ source: source, text: text });
}

function collectResponseTextCandidates(result) {
  var candidates = [];

  if (typeof result === 'string') {
    pushTextCandidate(candidates, 'raw-string', result);
    return candidates;
  }

  if (!result || typeof result !== 'object') {
    return candidates;
  }

  pushTextCandidate(candidates, 'response', result.response);
  pushTextCandidate(candidates, 'text', result.text);
  pushTextCandidate(candidates, 'description', result.description);
  pushTextCandidate(candidates, 'output_text', result.output_text);

  if (result.result && typeof result.result === 'object') {
    pushTextCandidate(candidates, 'result.response', result.result.response);
    pushTextCandidate(candidates, 'result.text', result.result.text);
    pushTextCandidate(candidates, 'result.description', result.result.description);
    pushTextCandidate(candidates, 'result.output_text', result.result.output_text);
  }

  if (Array.isArray(result.choices) && result.choices.length > 0) {
    var choice = result.choices[0] || {};
    if (choice.message && typeof choice.message === 'object') {
      pushTextCandidate(candidates, 'choices[0].message.content', choice.message.content);
      pushTextCandidate(candidates, 'choices[0].message.text', choice.message.text);
      if (Array.isArray(choice.message.tool_calls) && choice.message.tool_calls.length > 0) {
        pushTextCandidate(
          candidates,
          'choices[0].message.tool_calls',
          'Model returned tool calls without assistant text content.',
        );
      }
    }
    pushTextCandidate(candidates, 'choices[0].text', choice.text);
    if (choice.delta && typeof choice.delta === 'object') {
      pushTextCandidate(candidates, 'choices[0].delta.content', choice.delta.content);
    }
  }

  if (Array.isArray(result.output)) {
    for (var i = 0; i < result.output.length; i += 1) {
      var outputItem = result.output[i];
      if (!outputItem || typeof outputItem !== 'object') continue;

      pushTextCandidate(candidates, 'output[' + i + '].text', outputItem.text);
      pushTextCandidate(candidates, 'output[' + i + '].output_text', outputItem.output_text);

      if (Array.isArray(outputItem.content)) {
        for (var j = 0; j < outputItem.content.length; j += 1) {
          var contentPart = outputItem.content[j];
          if (!contentPart || typeof contentPart !== 'object') continue;
          pushTextCandidate(candidates, 'output[' + i + '].content[' + j + '].text', contentPart.text);
          pushTextCandidate(candidates, 'output[' + i + '].content[' + j + '].content', contentPart.content);
        }
      }
    }
  }

  return candidates;
}

function resolveResponseMessage(result) {
  var candidates = collectResponseTextCandidates(result);
  if (candidates.length > 0) {
    return {
      role: 'assistant',
      content: candidates[0].text,
      source: candidates[0].source,
    };
  }

  return {
    role: 'assistant',
    content: '',
    source: 'none',
  };
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

function callWorkerChatApi_(chatApiUrl, messages, executionLogs) {
  var logs = Array.isArray(executionLogs) ? executionLogs : [];
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
  var payloadJson = JSON.stringify(payload);

  logs.push('Worker model: ' + chatModel);
  logs.push('Outgoing messages count (including system): ' + messages.length);
  logs.push('Request payload chars: ' + payloadJson.length);

  var startedAt = Date.now();

  var response = UrlFetchApp.fetch(chatApiUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + workerApiKey,
    },
    payload: payloadJson,
    muteHttpExceptions: true,
  });

  var durationMs = Date.now() - startedAt;
  var status = response.getResponseCode();
  var responseText = response.getContentText();
  logs.push('Worker HTTP status: ' + status + ' (' + durationMs + ' ms)');
  logs.push('Worker response chars: ' + responseText.length);
  logs.push('Worker response preview: ' + truncateForLog(responseText, 500));

  if (status < 200 || status >= 300) {
    throw new Error('Worker API error (' + status + '): ' + truncateForLog(responseText, 800));
  }

  try {
    return JSON.parse(responseText);
  } catch (_error) {
    logs.push('Worker response was not JSON; using raw text body.');
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

  var executionLogs = [
    'Calling worker chat endpoint: ' + chatApiUrl,
    'Conversation history items included: ' + history.length,
  ];

  try {
    var result = callWorkerChatApi_(chatApiUrl, messages, executionLogs);
    executionLogs.push('Worker response summary: ' + summarizeResponseShape(result));

    var responseMessage = resolveResponseMessage(result);
    executionLogs.push('Assistant text source: ' + responseMessage.source);

    var assistantText = coerceAssistantContentToString(responseMessage.content).trim();
    if (!assistantText) {
      assistantText = 'Worker returned no assistant text. Review execution logs for payload details.';
      executionLogs.push('Assistant text was empty after extraction; inserted fallback text.');
    }
    executionLogs.push('Assistant text chars: ' + assistantText.length);

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
  } catch (error) {
    var errorMessage = error && error.message ? error.message : String(error);
    executionLogs.push('Chat request failed: ' + errorMessage);

    var failureText = 'Chat request failed: ' + errorMessage;
    var updatedHistoryOnError = trimConversationHistory(
      history.concat([
        { role: 'user', content: cleanQuery },
        { role: 'assistant', content: failureText },
      ]),
    );

    return {
      text: failureText,
      uiJson: buildFallbackA2UiSurfaceFromText(failureText),
      updatedHistory: updatedHistoryOnError,
      executionLogs: executionLogs,
    };
  }
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
