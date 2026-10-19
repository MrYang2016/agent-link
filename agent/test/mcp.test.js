'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { McpServer, getBinding, prepareBind } = require('../mcp');

const TOOL_NAMES = [
  'search_channels',
  'create_channel',
  'join_channel',
  'search_members',
  'send_message',
  'pull_messages',
  'get_binding',
  'prepare_bind',
];

function directory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-link-mcp-'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function tools() {
  return new McpServer().listTools();
}

function tool(name) {
  return tools().find((item) => item.name === name);
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

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function userList(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.users)) return result.users;
  return null;
}

test('registered tool names are exactly the eight channel tools', () => {
  assert.deepEqual(
    tools()
      .map((item) => item.name)
      .sort(),
    [...TOOL_NAMES].sort(),
  );
});

for (const name of ['search_members', 'send_message', 'pull_messages', 'prepare_bind', 'search_channels', 'create_channel', 'join_channel', 'get_binding']) {
  test(`registered tools include ${name}`, () => {
    assert.equal(tools().some((item) => item.name === name), true);
  });
}

test('prepare_bind description says not to call pull_messages', () => {
  assert.equal(tool('prepare_bind').description.includes('也不要调用 `pull_messages`'), true);
});

test('prepare_bind description says to ask the user first', () => {
  assert.equal(tool('prepare_bind').description.includes('先问用户'), true);
});

test('pull_messages description says not to call it when rebind is refused', () => {
  assert.equal(tool('pull_messages').description.includes('用户拒绝改绑时不要调用本工具'), true);
});

test('search_members description says to extract the channel id and nickname', () => {
  assert.equal(tool('search_members').description.includes('从用户这句话提取频道 id 和昵称'), true);
});

test('search_members description says to ask the user first', () => {
  assert.equal(tool('search_members').description.includes('先问用户'), true);
});

test('search_members description says not to send', () => {
  assert.equal(tool('search_members').description.includes('不要发送'), true);
});

test('get_binding returns none when the channel is absent and does not create a file', () => {
  const dir = directory();
  try {
    assert.deepEqual(getBinding('missing', dir), { state: 'none' });
    assert.equal(fs.existsSync(path.join(dir, 'bindings.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('get_binding returns the bound session and client', () => {
  const dir = directory();
  try {
    writeJson(path.join(dir, 'bindings.json'), {
      'cursor:S1': { companyId: 'default', channelId: 'ch-1' },
    });
    assert.deepEqual(getBinding('ch-1', dir), { state: 'bound', sessionId: 'S1', client: 'cursor' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('prepare_bind returns bound_to_other_session when replace is false', async () => {
  const dir = directory();
  try {
    writeJson(path.join(dir, 'bindings.json'), {
      'cursor:S1': { companyId: 'default', channelId: 'ch-1' },
    });
    const result = await new McpServer().callTool('prepare_bind', { channelId: 'ch-1', replace: false }, { home: dir });
    assert.equal(result.state, 'bound_to_other_session');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('prepare_bind returns bound_to_other_session when replace is omitted', async () => {
  const dir = directory();
  try {
    writeJson(path.join(dir, 'bindings.json'), {
      'cursor:S1': { companyId: 'default', channelId: 'ch-1' },
    });
    const result = await new McpServer().callTool('prepare_bind', { channelId: 'ch-1' }, { home: dir });
    assert.equal(result.state, 'bound_to_other_session');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('prepare_bind leaves the channel bound to S1 when replace is not true', async () => {
  const dir = directory();
  try {
    writeJson(path.join(dir, 'bindings.json'), {
      'cursor:S1': { companyId: 'default', channelId: 'ch-1' },
    });
    await new McpServer().callTool('prepare_bind', { channelId: 'ch-1', replace: false }, { home: dir });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'bindings.json'), 'utf8')), {
      'cursor:S1': { companyId: 'default', channelId: 'ch-1' },
    });
    assert.equal(fs.existsSync(path.join(dir, 'pending-bind.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('prepare_bind with replace true writes pending-bind.json and does not rewrite bindings', () => {
  const dir = directory();
  try {
    const bindingsFile = path.join(dir, 'bindings.json');
    writeJson(bindingsFile, { 'cursor:S1': { companyId: 'default', channelId: 'ch-1' } });
    const before = fs.readFileSync(bindingsFile, 'utf8');
    const result = prepareBind('ch-1', true, dir);
    assert.equal(result.state, 'pending');
    assert.equal(fs.readFileSync(bindingsFile, 'utf8'), before);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'pending-bind.json'), 'utf8')), { channelId: 'ch-1' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('prepare_bind writes pending-bind.json when the channel is unbound', () => {
  const dir = directory();
  try {
    prepareBind('ch-9', false, dir);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'pending-bind.json'), 'utf8')), { channelId: 'ch-9' });
    assert.equal(fs.existsSync(path.join(dir, 'bindings.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('prepare_bind on Grok Bot writes bindings immediately without pending', () => {
  const dir = directory();
  const previousConversation = process.env.CURSOR_CONVERSATION_ID;
  const previousSession = process.env.AGENT_LINK_SESSION_ID;
  delete process.env.CURSOR_CONVERSATION_ID;
  delete process.env.AGENT_LINK_SESSION_ID;
  try {
    writeJson(path.join(dir, 'config.json'), {
      server: 'http://127.0.0.1:3000',
      token: 'secret-token',
      grokBot: true,
    });
    writeJson(path.join(dir, 'grok-bot-session.json'), { sessionId: 'bc-bind-1' });
    const result = prepareBind('ch-9', false, dir);
    assert.deepEqual(result, {
      state: 'bound',
      client: 'grok-bot',
      sessionId: 'bc-bind-1',
      channelId: 'ch-9',
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'bindings.json'), 'utf8')), {
      'grok-bot:bc-bind-1': { companyId: 'default', channelId: 'ch-9' },
    });
    assert.equal(fs.existsSync(path.join(dir, 'pending-bind.json')), false);
  } finally {
    if (previousConversation === undefined) delete process.env.CURSOR_CONVERSATION_ID;
    else process.env.CURSOR_CONVERSATION_ID = previousConversation;
    if (previousSession === undefined) delete process.env.AGENT_LINK_SESSION_ID;
    else process.env.AGENT_LINK_SESSION_ID = previousSession;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('create_channel on Grok Bot binds immediately', async () => {
  const dir = directory();
  const previousConversation = process.env.CURSOR_CONVERSATION_ID;
  const previousSession = process.env.AGENT_LINK_SESSION_ID;
  delete process.env.CURSOR_CONVERSATION_ID;
  delete process.env.AGENT_LINK_SESSION_ID;
  const server = await listen(async (req, res) => {
    await readBody(req);
    res.statusCode = 201;
    res.end(JSON.stringify({ id: 'ch-new', name: 'n', description: 'd' }));
  });
  try {
    writeJson(path.join(dir, 'config.json'), {
      server: server.origin,
      token: 'secret-token',
      grokBot: true,
    });
    writeJson(path.join(dir, 'grok-bot-session.json'), { sessionId: 'bc-create-1' });
    const result = await new McpServer().callTool(
      'create_channel',
      { id: 'ch-new', name: 'n', description: 'd' },
      { home: dir },
    );
    assert.equal(result.status, 201);
    assert.equal(result.pendingBind, false);
    assert.equal(result.state, 'bound');
    assert.equal(result.client, 'grok-bot');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'bindings.json'), 'utf8')), {
      'grok-bot:bc-create-1': { companyId: 'default', channelId: 'ch-new' },
    });
    assert.equal(fs.existsSync(path.join(dir, 'pending-bind.json')), false);
  } finally {
    if (previousConversation === undefined) delete process.env.CURSOR_CONVERSATION_ID;
    else process.env.CURSOR_CONVERSATION_ID = previousConversation;
    if (previousSession === undefined) delete process.env.AGENT_LINK_SESSION_ID;
    else process.env.AGENT_LINK_SESSION_ID = previousSession;
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('create_channel writes pending-bind.json only when the channel is unbound', async () => {
  const dir = directory();
  const requests = [];
  const server = await listen(async (req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    await readBody(req);
    res.statusCode = 201;
    res.end(JSON.stringify({ id: 'ch-new', name: 'n', description: 'd' }));
  });
  try {
    writeJson(path.join(dir, 'config.json'), { server: server.origin, token: 'secret-token' });
    const result = await new McpServer().callTool(
      'create_channel',
      { id: 'ch-new', name: 'n', description: 'd' },
      { home: dir },
    );
    assert.equal(result.status, 201);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'pending-bind.json'), 'utf8')), { channelId: 'ch-new' });
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/channels');
    assert.equal(requests[0].authorization, 'Bearer secret-token');
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('create_channel does not write pending-bind.json when the channel is already bound', async () => {
  const dir = directory();
  const server = await listen(async (req, res) => {
    await readBody(req);
    res.statusCode = 201;
    res.end(JSON.stringify({ id: 'ch-new', name: 'n', description: 'd' }));
  });
  try {
    writeJson(path.join(dir, 'config.json'), { server: server.origin, token: 'secret-token' });
    writeJson(path.join(dir, 'bindings.json'), {
      'cursor:S1': { companyId: 'default', channelId: 'ch-new' },
    });
    await new McpServer().callTool('create_channel', { id: 'ch-new', name: 'n', description: 'd' }, { home: dir });
    assert.equal(fs.existsSync(path.join(dir, 'pending-bind.json')), false);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('create_channel does not write pending-bind.json when the server rejects the id', async () => {
  const dir = directory();
  const server = await listen(async (req, res) => {
    await readBody(req);
    res.statusCode = 409;
    res.end(JSON.stringify({ error: 'channel_exists' }));
  });
  try {
    writeJson(path.join(dir, 'config.json'), { server: server.origin, token: 'secret-token' });
    const result = await new McpServer().callTool(
      'create_channel',
      { id: 'ch-new', name: 'n', description: 'd' },
      { home: dir },
    );
    assert.equal(result.status, 409);
    assert.equal(fs.existsSync(path.join(dir, 'pending-bind.json')), false);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('join_channel returns bound_to_other_session and does not write pending-bind.json', async () => {
  const dir = directory();
  const server = await listen(async (req, res) => {
    res.statusCode = 200;
    res.end(JSON.stringify({ channelId: 'ch-1', userId: 'user-1' }));
  });
  try {
    writeJson(path.join(dir, 'config.json'), { server: server.origin, token: 'secret-token' });
    writeJson(path.join(dir, 'bindings.json'), {
      'cursor:S1': { companyId: 'default', channelId: 'ch-1' },
    });
    const before = fs.readFileSync(path.join(dir, 'bindings.json'), 'utf8');
    const result = await new McpServer().callTool('join_channel', { channelId: 'ch-1' }, { home: dir });
    assert.equal(result.state, 'bound_to_other_session');
    assert.equal(fs.existsSync(path.join(dir, 'pending-bind.json')), false);
    assert.equal(fs.readFileSync(path.join(dir, 'bindings.json'), 'utf8'), before);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('join_channel writes pending-bind.json when the channel is unbound', async () => {
  const dir = directory();
  const server = await listen(async (req, res) => {
    res.statusCode = 200;
    res.end(JSON.stringify({ channelId: 'ch-1', userId: 'user-1' }));
  });
  try {
    writeJson(path.join(dir, 'config.json'), { server: server.origin, token: 'secret-token' });
    const result = await new McpServer().callTool('join_channel', { channelId: 'ch-1' }, { home: dir });
    assert.equal(result.state, 'pending');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'pending-bind.json'), 'utf8')), { channelId: 'ch-1' });
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('join_channel does not write pending-bind.json when the channel is missing', async () => {
  const dir = directory();
  const server = await listen(async (req, res) => {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'channel_not_found' }));
  });
  try {
    writeJson(path.join(dir, 'config.json'), { server: server.origin, token: 'secret-token' });
    const result = await new McpServer().callTool('join_channel', { channelId: 'missing' }, { home: dir });
    assert.equal(result.status, 404);
    assert.equal(fs.existsSync(path.join(dir, 'pending-bind.json')), false);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('search_members calls the member query and returns the user list', async () => {
  const dir = directory();
  const requests = [];
  const users = [{ userId: 'user-zhang', username: '张三' }];
  const server = await listen(async (req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.end(JSON.stringify(users));
  });
  try {
    writeJson(path.join(dir, 'config.json'), { server: server.origin, token: 'secret-token' });
    const result = await new McpServer().callTool(
      'search_members',
      { channelId: 'ch-1', nickname: '张' },
      { home: dir },
    );
    const url = new URL(requests[0].url, server.origin);
    assert.equal(requests[0].method, 'GET');
    assert.equal(url.pathname, '/api/channels/ch-1/members');
    assert.equal(url.searchParams.get('q'), '张');
    assert.deepEqual(userList(result), users);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pull_messages posts to pull and does not change local binding files', async () => {
  const dir = directory();
  const requests = [];
  const server = await listen(async (req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.end(JSON.stringify({ messages: [] }));
  });
  try {
    writeJson(path.join(dir, 'config.json'), { server: server.origin, token: 'secret-token' });
    writeJson(path.join(dir, 'bindings.json'), {
      'cursor:S1': { companyId: 'default', channelId: 'ch-1' },
    });
    const before = fs.readFileSync(path.join(dir, 'bindings.json'), 'utf8');
    const result = await new McpServer().callTool('pull_messages', { channelId: 'ch-1' }, { home: dir });
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/channels/ch-1/pull');
    assert.deepEqual(result.messages, []);
    assert.equal(fs.readFileSync(path.join(dir, 'bindings.json'), 'utf8'), before);
    assert.equal(fs.existsSync(path.join(dir, 'pending-bind.json')), false);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('search_channels does not write a binding file', async () => {
  const dir = directory();
  const server = await listen(async (req, res) => {
    res.end(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }));
  });
  try {
    writeJson(path.join(dir, 'config.json'), { server: server.origin, token: 'secret-token' });
    await new McpServer().callTool('search_channels', { q: '需求', page: 1 }, { home: dir });
    assert.equal(fs.existsSync(path.join(dir, 'bindings.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 'pending-bind.json')), false);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
