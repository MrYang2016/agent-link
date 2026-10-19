'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { connectClaude, runPeerCli } = require('../claude-mod');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listenSocket(sockPath) {
  const registrations = [];
  const sockets = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let split = buffer.indexOf('\n');
      while (split >= 0) {
        const line = buffer.slice(0, split);
        buffer = buffer.slice(split + 1);
        split = buffer.indexOf('\n');
        if (!line) continue;
        const message = JSON.parse(line);
        registrations.push(message);
        if (message.op === 'register') {
          socket.write(`${JSON.stringify({ op: 'deliver', messageText: 'claude-socket-text' })}\n`);
        }
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(sockPath, () => {
      resolve({
        registrations,
        close() {
          for (const socket of sockets) socket.destroy();
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

test('claude mod submits the delivered messageText once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-link-claude-mod-'));
  const sock = path.join(dir, 'watch.sock');
  const bridge = await listenSocket(sock);
  const submits = [];
  const connection = connectClaude({
    prompt: {
      submit(payload) {
        submits.push(payload);
      },
    },
    sessionId: 'sess-c',
    socketPath: sock,
  });
  try {
    const started = Date.now();
    while (submits.length < 1) {
      if (Date.now() - started > 3000) {
        throw new Error(`prompt.submit was not called; registrations=${JSON.stringify(bridge.registrations)}`);
      }
      await delay(20);
    }
    await delay(200);
    assert.deepEqual(bridge.registrations, [{ op: 'register', client: 'claude-code', sessionId: 'sess-c' }]);
    assert.deepEqual(submits, [{ text: 'claude-socket-text' }]);
  } finally {
    connection.close();
    await bridge.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('claude-mod peer CLI writes deliver lines to stdout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-link-claude-peer-'));
  const sock = path.join(dir, 'watch.sock');
  const bridge = await listenSocket(sock);
  const lines = [];
  const stderr = [];
  const previous = process.env.AGENT_LINK_SOCKET;
  process.env.AGENT_LINK_SOCKET = sock;
  let connection = null;
  try {
    const result = runPeerCli(['sess-cli'], {
      stdout: {
        write(chunk) {
          lines.push(String(chunk));
        },
      },
      stderr: {
        write(chunk) {
          stderr.push(String(chunk));
        },
      },
    });
    connection = result.connection;
    assert.equal(result.code, 0);
    const started = Date.now();
    while (lines.length < 1) {
      if (Date.now() - started > 3000) {
        throw new Error(`peer CLI wrote nothing; stderr=${stderr.join('')} registrations=${JSON.stringify(bridge.registrations)}`);
      }
      await delay(20);
    }
    assert.deepEqual(bridge.registrations, [{ op: 'register', client: 'claude-code', sessionId: 'sess-cli' }]);
    assert.deepEqual(
      lines.map((line) => JSON.parse(line.trim())),
      [{ op: 'deliver', messageText: 'claude-socket-text' }],
    );
  } finally {
    if (connection) connection.close();
    if (previous === undefined) delete process.env.AGENT_LINK_SOCKET;
    else process.env.AGENT_LINK_SOCKET = previous;
    await bridge.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
