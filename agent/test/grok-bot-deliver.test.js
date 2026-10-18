'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { messageText } = require('../followup');
const { writeInboxMessage, peekInbox, drainInbox, inboxPath } = require('../grok-bot-deliver');

function directory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-link-grok-inbox-'));
}

const messages = [
  {
    id: 'm1',
    channelId: 'ch-1',
    senderUserId: 'user-1',
    senderUsername: 'ada',
    body: 'hello-grok',
    createdAt: '2020-01-01T00:00:00.000Z',
  },
];

test('writeInboxMessage appends jsonl and writes latest', () => {
  const dir = directory();
  try {
    assert.equal(writeInboxMessage({ dir, channelId: 'ch-1', messages }), true);
    const entries = peekInbox(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].channelId, 'ch-1');
    assert.equal(entries[0].messageText, messageText(messages));
    assert.equal(fs.existsSync(path.join(dir, 'inbox', 'grok-bot.latest.json')), true);
    assert.equal(fs.existsSync(inboxPath(dir)), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('drainInbox returns entries and clears the active inbox', () => {
  const dir = directory();
  try {
    writeInboxMessage({ dir, channelId: 'ch-1', messageText: 'one' });
    writeInboxMessage({ dir, channelId: 'ch-1', messageText: 'two' });
    const drained = drainInbox(dir);
    assert.equal(drained.length, 2);
    assert.deepEqual(
      drained.map((entry) => entry.messageText),
      ['one', 'two'],
    );
    assert.deepEqual(peekInbox(dir), []);
    assert.equal(fs.existsSync(inboxPath(dir)), false);
    assert.equal(fs.existsSync(path.join(dir, 'inbox', 'grok-bot.processed.jsonl')), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeInboxMessage returns false for empty text', () => {
  const dir = directory();
  try {
    assert.equal(writeInboxMessage({ dir, messages: [] }), false);
    assert.equal(fs.existsSync(inboxPath(dir)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
