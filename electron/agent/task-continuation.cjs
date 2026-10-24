const continuationRequest = /^(?:please\s+)?(?:continue(?:\s+(?:the\s+)?task)?|keep\s+going|carry\s+on|resume(?:\s+the\s+task)?|finish(?:\s+(?:it|the\s+task))?|complete\s+(?:it|the\s+task)|go\s+on|proceed)[.!…\s]*$/i;

function isContinuationRequest(value) {
  return typeof value === 'string' && continuationRequest.test(value.trim());
}

module.exports = { isContinuationRequest };
