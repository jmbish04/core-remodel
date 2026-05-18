const API_URL_BASE_WORKER = 'https://core-remodel.hacolby.workers.dev';
const API_URL_CHAT_AGENT = API_URL_BASE_WORKER + '/api/ai/chat';
const API_URL_CHAT_AGENT_STREAM = API_URL_BASE_WORKER + '/api/ai/chat/stream';

function getApiConfig() {
  var scriptProperties = PropertiesService.getScriptProperties();
  return {
    chatApiUrl: scriptProperties.getProperty('API_URL_CHAT_AGENT') || API_URL_CHAT_AGENT,
    chatStreamApiUrl: scriptProperties.getProperty('API_URL_CHAT_AGENT_STREAM') || API_URL_CHAT_AGENT_STREAM
  };
}
