'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { messageText } = require('../followup');
const { deliverIfMessage } = require('../pi-deliver');

const messages = [
  { channelId: 'ch-1', senderUsername: 'ada', senderUserId: 'user-1', body: 'hello' },
];

test('deliverIfMessage does not call sendUserMessage for an empty array', () => {
  let calls = 0;
  deliverIfMessage([], () => {
    calls += 1;
  });
  assert.equal(calls, 0);
});

test('deliverIfMessage calls sendUserMessage once when messages exist', () => {
  let calls = 0;
  deliverIfMessage(messages, () => {
    calls += 1;
  });
  assert.equal(calls, 1);
});

test('deliverIfMessage passes messageText(messages)', () => {
  let received = null;
  deliverIfMessage(messages, (text) => {
    received = text;
  });
  assert.equal(received, messageText(messages));
});
