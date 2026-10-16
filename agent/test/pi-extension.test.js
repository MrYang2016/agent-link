'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { messageText } = require('../followup');
const { install } = require('../install');

function homeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-link-pi-ext-'));
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close() {
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

function loadExtension(home) {
  const file = path.join(home, '.pi', 'agent', 'extensions', 'agent-link.js');
  const extension = require(file);
  const sent = [];
  const registered = [];
  extension({
    on(event, fn) {
      registered.push({ event, fn });
    },
    sendUserMessage(text) {
      sent.push(text);
    },
  });
  assert.equal(registered.length, 1);
  return { sent, handler: registered[0].fn };
}

test('an unbound Pi session does not pull or send', async () => {
  const home = homeDir();
  const requests = [];
  const server = await listen((req, res) => {
    requests.push(req.url);
    res.end(JSON.stringify({ messages: [] }));
  });
  try {
    install({ home, token: 'secret-token', server: server.origin, piOnPath: true });
    const { sent, handler } = loadExtension(home);
    await handler({}, { sessionManager: { getSessionId: () => 'sess-1' } });
    assert.deepEqual(requests, []);
    assert.deepEqual(sent, []);
  } finally {
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a bound Pi session with messages calls sendUserMessage once with messageText', async () => {
  const home = homeDir();
  const requests = [];
  const messages = [
    { id: 'm1', channelId: 'ch-pi', senderUserId: 'user-1', senderUsername: 'ada', body: 'pi-body', createdAt: '2020-01-01T00:00:00.000Z' },
  ];
  const server = await listen((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.end(JSON.stringify({ messages }));
  });
  try {
    install({ home, token: 'secret-token', server: server.origin, piOnPath: true });
    fs.writeFileSync(
      path.join(home, '.agent-link', 'bindings.json'),
      `${JSON.stringify({ 'pi:sess-1': { companyId: 'default', channelId: 'ch-pi' } }, null, 2)}\n`,
    );
    const { sent, handler } = loadExtension(home);
    await handler({}, { sessionManager: { getSessionId: () => 'sess-1' } });
    assert.deepEqual(requests, [{ method: 'POST', url: '/api/channels/ch-pi/pull' }]);
    assert.deepEqual(sent, [messageText(messages)]);
  } finally {
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a bound Pi session with an empty queue does not call sendUserMessage', async () => {
  const home = homeDir();
  const requests = [];
  const server = await listen((req, res) => {
    requests.push(req.url);
    res.end(JSON.stringify({ messages: [] }));
  });
  try {
    install({ home, token: 'secret-token', server: server.origin, piOnPath: true });
    fs.writeFileSync(
      path.join(home, '.agent-link', 'bindings.json'),
      `${JSON.stringify({ 'pi:sess-1': { companyId: 'default', channelId: 'ch-pi' } }, null, 2)}\n`,
    );
    const { sent, handler } = loadExtension(home);
    await handler({}, { sessionManager: { getSessionId: () => 'sess-1' } });
    assert.equal(requests.length, 1);
    assert.deepEqual(sent, []);
  } finally {
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Pi applies a pending bind and pulls that channel once', async () => {
  const home = homeDir();
  const requests = [];
  const server = await listen((req, res) => {
    requests.push(req.url);
    res.end(JSON.stringify({ messages: [] }));
  });
  try {
    install({ home, token: 'secret-token', server: server.origin, piOnPath: true });
    fs.writeFileSync(
      path.join(home, '.agent-link', 'pending-bind.json'),
      `${JSON.stringify({ channelId: 'ch-pi' })}\n`,
    );
    const { handler } = loadExtension(home);
    await handler({}, { sessionManager: { getSessionId: () => 'sess-1' } });
    const bindings = JSON.parse(fs.readFileSync(path.join(home, '.agent-link', 'bindings.json'), 'utf8'));
    assert.deepEqual(bindings['pi:sess-1'], { companyId: 'default', channelId: 'ch-pi' });
    assert.deepEqual(requests, ['/api/channels/ch-pi/pull']);
    assert.equal(fs.existsSync(path.join(home, '.agent-link', 'pending-bind.json')), false);
  } finally {
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('a Pi extension submits socket messageText through sendUserMessage once', async () => {
  const home = homeDir();
  const text = messageText([
    { channelId: 'ch-pi', senderUserId: 'user-1', senderUsername: 'ada', body: 'pi-socket-body', createdAt: '2020-01-01T00:00:00.000Z' },
  ]);
  const server = await listen((req, res) => {
    res.end(JSON.stringify({ messages: [] }));
  });
  const sock = path.join(home, '.agent-link', 'watch.sock');
  const registrations = [];
  const sockets = [];
  fs.mkdirSync(path.dirname(sock), { recursive: true });
  const bridge = net.createServer((socket) => {
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
          socket.write(`${JSON.stringify({ op: 'deliver', messageText: text })}\n`);
        }
      }
    });
  });
  await new Promise((resolve, reject) => {
    bridge.on('error', reject);
    bridge.listen(sock, resolve);
  });
  const sent = [];
  try {
    install({
      home,
      token: 'secret-token',
      server: server.origin,
      piOnPath: true,
      spawn() {
        return { unref() {} };
      },
    });
    const extension = require(path.join(home, '.pi', 'agent', 'extensions', 'agent-link.js'));
    const registered = [];
    extension({
      on(event, fn) {
        registered.push(fn);
      },
      sendUserMessage(value) {
        sent.push(value);
      },
    });
    assert.ok(registered.length >= 1);
    await registered[0]({}, { sessionManager: { getSessionId: () => 'sess-pi' } });
    const started = Date.now();
    while (sent.length < 1) {
      if (Date.now() - started > 3000) {
        throw new Error(`sendUserMessage was not called; registrations=${JSON.stringify(registrations)}`);
      }
      await delay(20);
    }
    await delay(200);
    assert.deepEqual(registrations, [{ op: 'register', client: 'pi', sessionId: 'sess-pi' }]);
    assert.deepEqual(sent, [text]);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => bridge.close(() => resolve()));
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
