'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { messageText } = require('../followup');
const { deliverChannel, markBusy, runWatch } = require('../watch');
const { peekInbox, inboxPath } = require('../grok-bot-deliver');

const messages = [
  {
    id: 'm1',
    channelId: 'ch-1',
    senderUserId: 'user-1',
    senderUsername: 'ada',
    body: 'early-body',
    createdAt: '2020-01-01T00:00:00.000Z',
  },
  {
    id: 'm2',
    channelId: 'ch-1',
    senderUserId: 'user-2',
    senderUsername: 'bea',
    body: 'late-body',
    createdAt: '2020-01-02T00:00:00.000Z',
  },
];

function directory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-link-watch-'));
}

function binding(client, sessionId, channelId = 'ch-1') {
  return { [`${client}:${sessionId}`]: { companyId: 'default', channelId } };
}

function recorder() {
  const pulls = [];
  const spawns = [];
  return {
    pulls,
    spawns,
    async request(url, init) {
      pulls.push({
        url: String(url),
        authorization: init && init.headers ? init.headers.Authorization : '',
      });
      return { messages };
    },
    spawn(command, args) {
      spawns.push({ command, args: [...(args || [])] });
      return { unref() {} };
    },
  };
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

test('deliverChannel does not pull when the bound session is busy', async () => {
  const seen = recorder();
  const result = await deliverChannel({
    channelId: 'ch-1',
    bindings: binding('cursor', 'conv-1'),
    sessionState: { 'cursor:conv-1': 'busy' },
    config: { server: 'http://watch.example', token: 'secret-token' },
    request: seen.request,
    spawn: seen.spawn,
  });
  assert.equal(result.pulled, false);
  assert.deepEqual(seen.pulls, []);
  assert.deepEqual(seen.spawns, []);
});

test('deliverChannel does not pull when this machine has no binding for the channel', async () => {
  const seen = recorder();
  const result = await deliverChannel({
    channelId: 'ch-1',
    bindings: binding('cursor', 'conv-1', 'ch-other'),
    sessionState: {},
    config: { server: 'http://watch.example', token: 'secret-token' },
    request: seen.request,
    spawn: seen.spawn,
  });
  assert.equal(result.pulled, false);
  assert.deepEqual(seen.pulls, []);
});

test('deliverChannel does not pull for an idle Pi session that has not registered', async () => {
  const seen = recorder();
  const result = await deliverChannel({
    channelId: 'ch-1',
    bindings: binding('pi', 'sess-1'),
    sessionState: {},
    peers: new Map(),
    config: { server: 'http://watch.example', token: 'secret-token' },
    request: seen.request,
    spawn: seen.spawn,
  });
  assert.equal(result.pulled, false);
  assert.deepEqual(seen.pulls, []);
});

test('deliverChannel does not pull for an idle Claude Code session that has not registered', async () => {
  const seen = recorder();
  const result = await deliverChannel({
    channelId: 'ch-1',
    bindings: binding('claude-code', 'sess-1'),
    sessionState: {},
    peers: new Map(),
    config: { server: 'http://watch.example', token: 'secret-token' },
    request: seen.request,
    spawn: seen.spawn,
  });
  assert.equal(result.pulled, false);
  assert.deepEqual(seen.pulls, []);
});

test('deliverChannel pulls once when an idle cursor session can receive', async () => {
  const seen = recorder();
  const result = await deliverChannel({
    channelId: 'ch-1',
    bindings: binding('cursor', 'conv-1'),
    sessionState: {},
    config: { server: 'http://watch.example', token: 'secret-token' },
    request: seen.request,
    spawn: seen.spawn,
  });
  assert.equal(result.pulled, true);
  assert.deepEqual(seen.pulls, [
    {
      url: 'http://watch.example/api/channels/ch-1/pull',
      authorization: 'Bearer secret-token',
    },
  ]);
});

test('deliverChannel submits messageText once to an idle cursor session', async () => {
  const seen = recorder();
  const result = await deliverChannel({
    channelId: 'ch-1',
    bindings: binding('cursor', 'conv-1'),
    sessionState: {},
    config: { server: 'http://watch.example', token: 'secret-token' },
    request: seen.request,
    spawn: seen.spawn,
  });
  assert.equal(result.submitted, true);
  assert.deepEqual(seen.spawns, [
    { command: 'agent', args: ['--resume=conv-1', '-p', messageText(messages)] },
  ]);
});

test('deliverChannel pulls once and does not submit when the queue is empty', async () => {
  const pulls = [];
  const spawns = [];
  const result = await deliverChannel({
    channelId: 'ch-1',
    bindings: binding('cursor', 'conv-1'),
    sessionState: {},
    config: { server: 'http://watch.example', token: 'secret-token' },
    async request(url) {
      pulls.push(String(url));
      return { messages: [] };
    },
    spawn(command, args) {
      spawns.push({ command, args });
    },
  });
  assert.equal(result.pulled, true);
  assert.equal(result.submitted, false);
  assert.deepEqual(pulls, ['http://watch.example/api/channels/ch-1/pull']);
  assert.deepEqual(spawns, []);
});

test('deliverChannel submits messageText once to an idle codex session', async () => {
  const seen = recorder();
  await deliverChannel({
    channelId: 'ch-1',
    bindings: binding('codex', 'sess-9'),
    sessionState: {},
    config: { server: 'http://watch.example', token: 'secret-token' },
    request: seen.request,
    spawn: seen.spawn,
  });
  assert.equal(seen.pulls.length, 1);
  assert.deepEqual(seen.spawns, [
    { command: 'codex', args: ['exec', 'resume', 'sess-9', messageText(messages)] },
  ]);
});

test('deliverChannel pulls once and delivers messageText once to a registered Pi session', async () => {
  const seen = recorder();
  const writes = [];
  const peers = new Map([['pi:sess-1', { write(line) { writes.push(String(line)); } }]]);
  const result = await deliverChannel({
    channelId: 'ch-1',
    bindings: binding('pi', 'sess-1'),
    sessionState: {},
    peers,
    config: { server: 'http://watch.example', token: 'secret-token' },
    request: seen.request,
    spawn: seen.spawn,
  });
  assert.equal(result.pulled, true);
  assert.equal(result.submitted, true);
  assert.equal(seen.pulls.length, 1);
  assert.deepEqual(seen.spawns, []);
  assert.deepEqual(writes, [`${JSON.stringify({ op: 'deliver', messageText: messageText(messages) })}\n`]);
});

test('deliverChannel pulls once and delivers messageText once to a registered Claude Code session', async () => {
  const seen = recorder();
  const writes = [];
  const peers = new Map([['claude-code:sess-1', { write(line) { writes.push(String(line)); } }]]);
  const result = await deliverChannel({
    channelId: 'ch-1',
    bindings: binding('claude-code', 'sess-1'),
    sessionState: {},
    peers,
    config: { server: 'http://watch.example', token: 'secret-token' },
    request: seen.request,
    spawn: seen.spawn,
  });
  assert.equal(result.pulled, true);
  assert.equal(seen.pulls.length, 1);
  assert.deepEqual(writes, [`${JSON.stringify({ op: 'deliver', messageText: messageText(messages) })}\n`]);
  assert.equal(result.submitted, true);
});

test('deliverChannel writes messageText once to the Grok Bot inbox', async () => {
  const dir = directory();
  const seen = recorder();
  try {
    const result = await deliverChannel({
      channelId: 'ch-1',
      bindings: binding('grok-bot', 'bc-1'),
      sessionState: {},
      dir,
      config: { server: 'http://watch.example', token: 'secret-token' },
      request: seen.request,
      spawn: seen.spawn,
    });
    assert.equal(result.pulled, true);
    assert.equal(result.submitted, true);
    assert.equal(seen.pulls.length, 1);
    assert.deepEqual(seen.spawns, []);
    const entries = peekInbox(dir);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].messageText, messageText(messages));
    assert.equal(entries[0].channelId, 'ch-1');
    assert.equal(fs.existsSync(inboxPath(dir)), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deliverChannel still writes the Grok Bot inbox when the session is busy', async () => {
  const dir = directory();
  const seen = recorder();
  try {
    const result = await deliverChannel({
      channelId: 'ch-1',
      bindings: binding('grok-bot', 'bc-1'),
      sessionState: { 'grok-bot:bc-1': 'busy' },
      dir,
      config: { server: 'http://watch.example', token: 'secret-token' },
      request: seen.request,
      spawn: seen.spawn,
    });
    assert.equal(result.pulled, true);
    assert.equal(result.submitted, true);
    assert.equal(peekInbox(dir).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runWatch pulls once and writes the Grok Bot inbox from SSE', async () => {
  const dir = directory();
  const pulls = [];
  const server = await listen((req, res) => {
    assert.equal(req.url, '/api/events');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ channelId: 'ch-1' })}\n\n`);
  });
  try {
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      `${JSON.stringify({ server: server.origin, token: 'secret-token', grokBot: true })}\n`,
    );
    fs.writeFileSync(path.join(dir, 'bindings.json'), `${JSON.stringify(binding('grok-bot', 'bc-9'))}\n`);
    fs.writeFileSync(path.join(dir, 'session-state.json'), '{}\n');
    await runWatch({
      dir,
      once: true,
      async request(url, init) {
        pulls.push({
          url: String(url),
          authorization: init.headers.Authorization,
        });
        return { messages };
      },
      spawn() {
        return { unref() {} };
      },
    });
    assert.deepEqual(pulls, [
      {
        url: `${server.origin}/api/channels/ch-1/pull`,
        authorization: 'Bearer secret-token',
      },
    ]);
    assert.equal(peekInbox(dir)[0].messageText, messageText(messages));
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a later pull that returns no messages does not submit again', async () => {
  const spawns = [];
  let calls = 0;
  const options = {
    channelId: 'ch-1',
    bindings: binding('cursor', 'conv-1'),
    sessionState: {},
    config: { server: 'http://watch.example', token: 'secret-token' },
    async request() {
      calls += 1;
      return { messages: calls === 1 ? messages : [] };
    },
    spawn(command, args) {
      spawns.push({ command, args: [...args] });
    },
  };
  const first = await deliverChannel(options);
  const second = await deliverChannel(options);
  assert.equal(first.submitted, true);
  assert.equal(second.pulled, true);
  assert.equal(second.submitted, false);
  assert.equal(calls, 2);
  assert.equal(spawns.length, 1);
});

test('runWatch pulls once and submits messageText when SSE names an idle cursor session', async () => {
  const dir = directory();
  const pulls = [];
  const spawns = [];
  const server = await listen((req, res) => {
    assert.equal(req.url, '/api/events');
    assert.equal(req.headers.authorization, 'Bearer secret-token');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ channelId: 'ch-1' })}\n\n`);
  });
  try {
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      `${JSON.stringify({ server: server.origin, token: 'secret-token' })}\n`,
    );
    fs.writeFileSync(path.join(dir, 'bindings.json'), `${JSON.stringify(binding('cursor', 'conv-1'))}\n`);
    fs.writeFileSync(path.join(dir, 'session-state.json'), '{}\n');
    await runWatch({
      dir,
      once: true,
      async request(url, init) {
        pulls.push({
          url: String(url),
          authorization: init.headers.Authorization,
        });
        return { messages };
      },
      spawn(command, args) {
        spawns.push({ command, args: [...args] });
        return { unref() {} };
      },
    });
    assert.deepEqual(pulls, [
      {
        url: `${server.origin}/api/channels/ch-1/pull`,
        authorization: 'Bearer secret-token',
      },
    ]);
    assert.deepEqual(spawns, [
      { command: 'agent', args: ['--resume=conv-1', '-p', messageText(messages)] },
    ]);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mark-busy cursor writes that session as busy and keeps another session', () => {
  const dir = directory();
  try {
    fs.writeFileSync(path.join(dir, 'session-state.json'), `${JSON.stringify({ 'cursor:other': 'busy' })}\n`);
    assert.equal(markBusy({ client: 'cursor', stdin: { conversation_id: 'conv-9' }, dir }), true);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'session-state.json'), 'utf8'));
    assert.equal(state['cursor:conv-9'], 'busy');
    assert.equal(state['cursor:other'], 'busy');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mark-busy claude-code ignores a Cursor payload', () => {
  const dir = directory();
  try {
    assert.equal(
      markBusy({
        client: 'claude-code',
        stdin: { session_id: 'conv-9', cursor_version: '3.24.12' },
        dir,
      }),
      false,
    );
    assert.equal(fs.existsSync(path.join(dir, 'session-state.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mark-busy claude-code writes that session as busy', () => {
  const dir = directory();
  try {
    assert.equal(markBusy({ client: 'claude-code', stdin: { session_id: 'sess-c' }, dir }), true);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'session-state.json'), 'utf8'));
    assert.equal(state['claude-code:sess-c'], 'busy');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('node watch.js mark-busy codex writes session-state.json from stdin', async () => {
  const dir = directory();
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(__dirname, '..', 'watch.js'), 'mark-busy', 'codex'], {
        env: { ...process.env, AGENT_LINK_HOME: dir },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`mark-busy timed out\n${stderr}`));
      }, 5000);
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, stderr });
      });
      child.stdin.end(JSON.stringify({ session_id: 'sess-x' }));
    });
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'session-state.json'), 'utf8'));
    assert.equal(state['codex:sess-x'], 'busy');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
