'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');
const { messageText } = require('./followup');

const CLIENTS = new Set(['cursor', 'claude-code', 'codex', 'pi']);
const SOCKET_CLIENTS = new Set(['claude-code', 'pi']);

function homeDir() {
  return process.env.AGENT_LINK_HOME || path.join(os.homedir(), '.agent-link');
}

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

function sessionIdentity(client, input) {
  const sessionId = client === 'cursor' ? input.conversation_id : input.session_id;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  return { sessionId, key: `${client}:${sessionId}` };
}

function invokedByCursor(client, input) {
  return client !== 'cursor' && input && typeof input.cursor_version === 'string' && input.cursor_version.length > 0;
}

function readJsonFile(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function statePath(dir, explicit) {
  return explicit || path.join(dir, 'session-state.json');
}

function markBusy({ client, stdin, dir, statePath: explicit }) {
  const input = parseStdin(stdin);
  if (invokedByCursor(client, input)) return false;
  const identity = sessionIdentity(client, input);
  if (!identity) return false;
  const file = statePath(dir || homeDir(), explicit);
  const state = readJsonFile(file);
  state[identity.key] = 'busy';
  writeJsonFile(file, state);
  return true;
}

function clearBusy({ client, stdin, dir, statePath: explicit }) {
  const input = parseStdin(stdin);
  if (invokedByCursor(client, input)) return false;
  const identity = sessionIdentity(client, input);
  if (!identity) return false;
  const file = statePath(dir || homeDir(), explicit);
  if (!fs.existsSync(file)) return false;
  const state = readJsonFile(file);
  if (!Object.hasOwn(state, identity.key)) return false;
  delete state[identity.key];
  writeJsonFile(file, state);
  return true;
}

function parseBindingKey(key) {
  const index = key.indexOf(':');
  if (index <= 0 || index === key.length - 1) return null;
  const client = key.slice(0, index);
  const sessionId = key.slice(index + 1);
  if (!CLIENTS.has(client) || sessionId.length === 0) return null;
  return { client, sessionId, key };
}

function findBinding(bindings, channelId) {
  if (!bindings || typeof bindings !== 'object') return null;
  for (const key of Object.keys(bindings)) {
    const value = bindings[key];
    if (!value || typeof value !== 'object') continue;
    if (value.channelId !== channelId) continue;
    const companyId = value.companyId || 'default';
    if (companyId !== 'default') continue;
    const parsed = parseBindingKey(key);
    if (!parsed) continue;
    return parsed;
  }
  return null;
}

async function readValue(value, reader) {
  if (typeof reader === 'function') return reader();
  return value;
}

function peerReady(peers, client, sessionId) {
  if (typeof peers === 'function') return peers(client, sessionId) === true;
  const key = `${client}:${sessionId}`;
  if (!peers) return false;
  if (peers instanceof Map) return peers.has(key);
  if (typeof peers.has === 'function' && typeof peers.get === 'function') return peers.has(key);
  return Object.prototype.hasOwnProperty.call(peers, key) && peers[key] != null && peers[key] !== false;
}

function peerSocket(peers, client, sessionId) {
  const key = `${client}:${sessionId}`;
  if (!peers) return null;
  if (typeof peers.get === 'function') return peers.get(key) || null;
  const value = peers[key];
  return value && typeof value === 'object' ? value : null;
}

function defaultSpawn(command, args, options) {
  const child = spawn(command, args, {
    ...(options || {}),
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => undefined);
  child.unref();
  return child;
}

async function readPayload(result) {
  let payload = result;
  if (payload && typeof payload.json === 'function') payload = await payload.json();
  if (payload && payload.data && Array.isArray(payload.data.messages)) return payload.data;
  return payload || {};
}

async function defaultRequest(url, init) {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'pull_failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function submitCommand(client, sessionId, text, spawnProcess) {
  if (client === 'cursor') {
    spawnProcess('agent', [`--resume=${sessionId}`, '-p', text]);
    return true;
  }
  if (client === 'codex') {
    spawnProcess('codex', ['exec', 'resume', sessionId, text]);
    return true;
  }
  return false;
}

function submitPeer(peers, sendToPeer, client, sessionId, text) {
  if (typeof sendToPeer === 'function') return sendToPeer(client, sessionId, text) !== false;
  const socket = peerSocket(peers, client, sessionId);
  if (!socket || typeof socket.write !== 'function') return false;
  socket.write(`${JSON.stringify({ op: 'deliver', messageText: text })}\n`);
  return true;
}

async function deliverChannel(options) {
  const channelId = options.channelId;
  if (typeof channelId !== 'string' || channelId.length === 0) return { pulled: false, submitted: false };
  const bindings = (await readValue(options.bindings, options.readBindings)) || {};
  const binding = findBinding(bindings, channelId);
  if (!binding) return { pulled: false, submitted: false, reason: 'unbound' };

  const sessionState = (await readValue(options.sessionState, options.readSessionState)) || {};
  if (sessionState[binding.key] === 'busy') return { pulled: false, submitted: false, reason: 'busy' };

  if (SOCKET_CLIENTS.has(binding.client) && !peerReady(options.peers, binding.client, binding.sessionId)) {
    return { pulled: false, submitted: false, reason: 'peer' };
  }

  const config = options.config || {};
  const server = String(config.server || '').replace(/\/+$/, '');
  const request = options.request || defaultRequest;
  const url = `${server}/api/channels/${encodeURIComponent(channelId)}/pull`;
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
  if (messages.length === 0) return { pulled: true, submitted: false, messages };

  const text = messageText(messages);
  const spawnProcess = options.spawn || defaultSpawn;
  if (binding.client === 'cursor' || binding.client === 'codex') {
    submitCommand(binding.client, binding.sessionId, text, spawnProcess);
    return { pulled: true, submitted: true, messages };
  }
  const sent = submitPeer(options.peers, options.sendToPeer, binding.client, binding.sessionId, text);
  return { pulled: true, submitted: sent, messages };
}

function openEventStream({ url, token, onEvent }) {
  const target = new URL(url);
  const lib = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = lib.request(
      target,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`events_${response.statusCode}`));
          return;
        }
        response.setEncoding('utf8');
        let buffer = '';
        const take = (raw) => {
          const lines = raw.split(/\r?\n/);
          const data = [];
          for (const line of lines) {
            if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
          }
          if (data.length === 0) return;
          try {
            const payload = JSON.parse(data.join('\n'));
            if (payload && typeof payload.channelId === 'string') onEvent(payload);
          } catch {
            // Ignore a frame that is not the channel notice.
          }
        };
        response.on('data', (chunk) => {
          buffer += chunk;
          let split = buffer.indexOf('\n\n');
          while (split >= 0) {
            const raw = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            split = buffer.indexOf('\n\n');
            take(raw);
          }
        });
        response.on('end', () => resolve());
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function startPeerServer(socketPath, peers) {
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  if (fs.existsSync(socketPath)) fs.rmSync(socketPath, { force: true });
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    let key = '';
    const drop = () => {
      if (key && peers.get(key) === socket) peers.delete(key);
    };
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
        let message = null;
        try {
          message = JSON.parse(line);
        } catch {
          message = null;
        }
        if (!message || message.op !== 'register') continue;
        if (typeof message.client !== 'string' || typeof message.sessionId !== 'string') continue;
        if (!SOCKET_CLIENTS.has(message.client) || message.sessionId.length === 0) continue;
        if (key && peers.get(key) === socket) peers.delete(key);
        key = `${message.client}:${message.sessionId}`;
        peers.set(key, socket);
      }
    });
    socket.on('end', drop);
    socket.on('close', drop);
    socket.on('error', drop);
  });
  server.on('error', () => undefined);
  server.listen(socketPath);
  return server;
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

async function runWatch(options = {}) {
  const dir = options.dir || homeDir();
  const config = options.config || readJsonFile(path.join(dir, 'config.json'));
  const peers = options.peers instanceof Map ? options.peers : new Map();
  const socketPath = options.socketPath || path.join(dir, 'watch.sock');
  const server = options.listen === false ? null : startPeerServer(socketPath, peers);
  const connect = options.connect || openEventStream;
  const readBindings =
    options.readBindings ||
    (() => readJsonFile(path.join(dir, 'bindings.json')));
  const readSessionState =
    options.readSessionState ||
    (() => readJsonFile(path.join(dir, 'session-state.json')));
  let tail = Promise.resolve();
  const onEvent = (event) => {
    if (!event || typeof event.channelId !== 'string') return;
    tail = tail
      .then(() =>
        deliverChannel({
          channelId: event.channelId,
          config,
          readBindings,
          readSessionState,
          peers,
          request: options.request,
          spawn: options.spawn,
          sendToPeer: options.sendToPeer,
        }),
      )
      .catch(() => undefined);
    return tail;
  };
  try {
    const url = `${String(config.server || '').replace(/\/+$/, '')}/api/events`;
    do {
      if (options.dir && !fs.existsSync(path.join(dir, 'config.json')) && !options.config) return;
      try {
        await connect({ url, token: config.token, onEvent });
        await tail;
      } catch {
        await delay(1000);
      }
    } while (!options.once);
    await tail;
  } finally {
    if (server) server.close();
    if (server && fs.existsSync(socketPath)) fs.rmSync(socketPath, { force: true });
  }
}

function readLivePid(pidFile) {
  if (!fs.existsSync(pidFile)) return null;
  const pid = Number(String(fs.readFileSync(pidFile, 'utf8')).trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function startWatchProcess({ linkDir, spawn: spawnImpl }) {
  const pidFile = path.join(linkDir, 'watch.pid');
  const running = readLivePid(pidFile);
  if (running) return { started: false, pid: running, script: path.join(linkDir, 'watch.js') };
  const script = path.join(linkDir, 'watch.js');
  const launch = typeof spawnImpl === 'function' ? spawnImpl : defaultSpawn;
  const child = launch(process.execPath, [script], {
    cwd: linkDir,
    env: {
      ...process.env,
      AGENT_LINK_HOME: linkDir,
      AGENT_LINK_WATCH_CONNECT: process.env.NODE_TEST_CONTEXT ? '0' : '1',
    },
  });
  const pid = child && typeof child.pid === 'number' ? child.pid : null;
  if (pid) fs.writeFileSync(pidFile, `${pid}\n`);
  if (child && typeof child.unref === 'function') child.unref();
  return { started: true, pid, script };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const dir = homeDir();
  if (process.argv[2] === 'mark-busy') {
    const client = process.argv[3];
    if (client !== 'cursor' && client !== 'claude-code' && client !== 'codex') {
      console.error('usage: node watch.js mark-busy <cursor|claude-code|codex>');
      process.exit(1);
    }
    markBusy({ client, stdin: await readStdin(), dir });
    return;
  }
  if (process.env.AGENT_LINK_WATCH_CONNECT === '0') return;
  await runWatch({ dir });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  deliverChannel,
  markBusy,
  clearBusy,
  openEventStream,
  defaultSpawn,
  runWatch,
  startWatchProcess,
  sessionIdentity,
  invokedByCursor,
};
