'use strict';

const { messageText } = require('./followup');

function deliverIfMessage(messages, sendUserMessage) {
  if (typeof messages === 'string') {
    if (messages.length === 0) return;
    sendUserMessage(messages);
    return;
  }
  if (!Array.isArray(messages) || messages.length === 0) return;
  sendUserMessage(messageText(messages));
}

module.exports = { deliverIfMessage };
