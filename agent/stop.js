'use strict';

const { formatStopOutput } = require('./followup');
const { clearBusy } = require('./watch');

function parseStdin(stdin) {
  if (stdin && typeof stdin === 'object') return stdin;
  if (typeof stdin !== 'string') return {};
  const text = stdin.trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function callMaybe(fn) {
  if (typeof fn !== 'function') return undefined;
  return fn();
}

function sessionKey(client, input) {
  const sessionId = client === 'cursor' ? input.conversation_id : input.session_id;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  return { sessionId, key: `${client}:${sessionId}` };
}

async function readPayload(result) {
  let payload = result;
  if (payload && typeof payload.json === 'function') payload = await payload.json();
  if (payload && payload.data && Array.isArray(payload.data.messages)) return payload.data;
  return payload || {};
}

async function resolveStop({ client, stdin, config, readPending, clearPending, readBindings, writeBindings, request }) {
  const input = parseStdin(stdin);
  if (client === 'cursor' && input.status === 'aborted') {
    return { pulled: false, messages: [] };
  }
  const identity = sessionKey(client, input);
  if (!identity) return { pulled: false, messages: [] };

  let bindings = (await callMaybe(readBindings)) || {};
  if (typeof bindings !== 'object') bindings = {};
  const pending = await callMaybe(readPending);
  if (pending && typeof pending.channelId === 'string' && pending.channelId.length > 0) {
    const channelId = pending.channelId;
    const next = { ...bindings };
    for (const key of Object.keys(next)) {
      const value = next[key];
      if (!value || typeof value !== 'object') continue;
      if (key === identity.key) continue;
      const companyId = value.companyId || 'default';
      if (value.channelId === channelId && companyId === 'default') delete next[key];
    }
    next[identity.key] = { companyId: 'default', channelId };
    bindings = next;
    await writeBindings(bindings);
    await clearPending();
  }

  const current = bindings[identity.key];
  if (!current || typeof current.channelId !== 'string' || current.channelId.length === 0) {
    return { pulled: false, messages: [] };
  }

  const server = String(config.server || '').replace(/\/+$/, '');
  const url = `${server}/api/channels/${encodeURIComponent(current.channelId)}/pull`;
  const result = await request(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
  });
  const payload = await readPayload(result);
  if (typeof payload.status === 'number' && payload.status >= 400) {
    throw new Error(payload.error || 'pull_failed');
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  return { pulled: true, messages };
}

async function runStop(options) {
  const outcome = await resolveStop(options);
  return formatStopOutput(options.client, outcome.messages);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const client = process.argv[2];
  if (client !== 'cursor' && client !== 'claude-code' && client !== 'codex') {
    console.error('usage: node stop.js <cursor|claude-code|codex>');
    process.exit(1);
  }
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const dir = process.env.AGENT_LINK_HOME || path.join(os.homedir(), '.agent-link');
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  const pendingPath = path.join(dir, 'pending-bind.json');
  const bindingsPath = path.join(dir, 'bindings.json');
  const stdin = await readStdin();
  const output = await runStop({
    client,
    stdin,
    config,
    readPending() {
      if (!fs.existsSync(pendingPath)) return null;
      return JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
    },
    clearPending() {
      fs.rmSync(pendingPath, { force: true });
    },
    readBindings() {
      if (!fs.existsSync(bindingsPath)) return {};
      return JSON.parse(fs.readFileSync(bindingsPath, 'utf8'));
    },
    writeBindings(bindings) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(bindingsPath, `${JSON.stringify(bindings, null, 2)}\n`);
    },
    async request(url, init) {
      const response = await fetch(url, init);
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error || 'pull_failed');
        error.status = response.status;
        throw error;
      }
      return data;
    },
  });
  process.stdout.write(`${JSON.stringify(output)}\n`);
  clearBusy({ client, stdin, dir });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { runStop, resolveStop };
