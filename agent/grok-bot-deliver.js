'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { messageText } = require('./followup');

function homeDir() {
  return process.env.AGENT_LINK_HOME || path.join(os.homedir(), '.agent-link');
}

function inboxDir(dir) {
  return path.join(dir || homeDir(), 'inbox');
}

function inboxPath(dir) {
  return path.join(inboxDir(dir), 'grok-bot.jsonl');
}

function latestPath(dir) {
  return path.join(inboxDir(dir), 'grok-bot.latest.json');
}

function processedPath(dir) {
  return path.join(inboxDir(dir), 'grok-bot.processed.jsonl');
}

function writeInboxMessage(options = {}) {
  const dir = options.dir || homeDir();
  const messages = options.messages;
  const text =
    typeof options.messageText === 'string' && options.messageText.length > 0
      ? options.messageText
      : messageText(Array.isArray(messages) ? messages : []);
  if (!text) return false;

  const channelId =
    (typeof options.channelId === 'string' && options.channelId) ||
    (Array.isArray(messages) && messages[0] && messages[0].channelId) ||
    '';
  const entry = {
    id:
      (typeof options.id === 'string' && options.id) ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    channelId,
    receivedAt: (typeof options.receivedAt === 'string' && options.receivedAt) || new Date().toISOString(),
    messageText: text,
  };

  const file = inboxPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  fs.writeFileSync(latestPath(dir), `${JSON.stringify(entry, null, 2)}\n`);
  return true;
}

function peekInbox(dir) {
  const file = inboxPath(dir || homeDir());
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.length > 0);
  const out = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object') out.push(value);
    } catch {
      // skip a corrupt line
    }
  }
  return out;
}

function drainInbox(dir) {
  const root = dir || homeDir();
  const file = inboxPath(root);
  const entries = peekInbox(root);
  if (fs.existsSync(file)) {
    fs.appendFileSync(processedPath(root), fs.readFileSync(file));
    fs.rmSync(file, { force: true });
  }
  const latest = latestPath(root);
  if (fs.existsSync(latest)) fs.rmSync(latest, { force: true });
  return entries;
}

async function main() {
  const action = process.argv[2] || 'peek';
  const dir = homeDir();
  if (action === 'peek') {
    process.stdout.write(`${JSON.stringify(peekInbox(dir), null, 2)}\n`);
    return;
  }
  if (action === 'drain') {
    process.stdout.write(`${JSON.stringify(drainInbox(dir), null, 2)}\n`);
    return;
  }
  console.error('usage: node grok-bot-deliver.js <peek|drain>');
  process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  writeInboxMessage,
  peekInbox,
  drainInbox,
  inboxPath,
  latestPath,
  homeDir,
};
