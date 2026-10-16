'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const DEFAULT_COMPANY_ID = 'default';

const TOOLS = [
  {
    name: 'search_channels',
    description: '按名称或描述搜索全部频道。返回频道 id、名称和描述。搜索本身不加入，也不绑定。',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '名称或描述的子串' },
        page: { type: 'number', description: '页码，从 1 开始' },
      },
    },
  },
  {
    name: 'create_channel',
    description: '建立频道并让当前用户成为成员。本机还没有这个频道的绑定时，写入待绑定文件，等本轮结束再记到当前会话。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['id', 'name', 'description'],
    },
  },
  {
    name: 'join_channel',
    description: '加入一个已有频道。若该频道已绑在本机其他会话，返回 bound_to_other_session，不写待绑定文件。没有冲突时才写待绑定文件。',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'search_members',
    description:
      '从用户这句话提取频道 id 和昵称再调用。在该频道成员里按昵称做不区分大小写的子串搜索，返回用户列表。返回列表不是恰好一人时先问用户，不要发送。',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: '频道 id' },
        nickname: { type: 'string', description: '昵称，即注册用户名' },
      },
      required: ['channelId', 'nickname'],
    },
  },
  {
    name: 'send_message',
    description: '把一条消息写入接收者在该频道下的队列。接收者必须已经是成员。',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        recipientUserId: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['channelId', 'recipientUserId', 'body'],
    },
  },
  {
    name: 'pull_messages',
    description: '拉取当前用户在该频道队列里的全部消息。只调用服务端 pull，不读、不写本机绑定。用户拒绝改绑时不要调用本工具。',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'get_binding',
    description: '只读本机 bindings.json。频道已有会话 id 时返回 bound，否则返回 none。不请求服务端。',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'prepare_bind',
    description:
      '准备把频道绑到当前这场本地会话。该频道已绑在本机其他会话，或这场对话已经绑着另一个频道时，先问用户；用户不同意则不要调用 `replace: true`，也不要调用 `pull_messages`。这不影响其他用户的本机绑定。',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        replace: { type: 'boolean' },
      },
      required: ['channelId'],
    },
  },
];

function agentHome() {
  return process.env.AGENT_LINK_HOME || path.join(os.homedir(), '.agent-link');
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function getBinding(channelId, dir = agentHome()) {
  const bindings = readJson(path.join(dir, 'bindings.json'), {});
  if (!bindings || typeof bindings !== 'object') return { state: 'none' };
  for (const [key, value] of Object.entries(bindings)) {
    if (!value || typeof value !== 'object') continue;
    if (value.channelId !== channelId) continue;
    if ((value.companyId || DEFAULT_COMPANY_ID) !== DEFAULT_COMPANY_ID) continue;
    const colon = key.indexOf(':');
    if (colon <= 0) continue;
    return {
      state: 'bound',
      client: key.slice(0, colon),
      sessionId: key.slice(colon + 1),
    };
  }
  return { state: 'none' };
}

function writePending(dir, channelId) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pending-bind.json'), `${JSON.stringify({ channelId })}\n`);
}

function prepareBind(channelId, replace, dir = agentHome()) {
  const existing = getBinding(channelId, dir);
  if (replace !== true && existing.state === 'bound') {
    return {
      state: 'bound_to_other_session',
      client: existing.client,
      sessionId: existing.sessionId,
    };
  }
  writePending(dir, channelId);
  return { state: 'pending', channelId };
}

function loadConfig(dir) {
  const file = path.join(dir, 'config.json');
  if (!fs.existsSync(file)) {
    const error = new Error('missing_config');
    error.code = 'missing_config';
    throw error;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function api(config, method, pathname, { query, body } = {}) {
  const url = new URL(pathname, config.server);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: 'invalid_response' };
    }
  }
  if (Array.isArray(data)) {
    return { status: response.status, users: data, isError: response.status >= 400 };
  }
  return { status: response.status, ...data, isError: response.status >= 400 };
}

function homeOf(options) {
  return (options && options.home) || agentHome();
}

async function callTool(name, args = {}, options = {}) {
  const home = homeOf(options);
  if (name === 'get_binding') return getBinding(args.channelId, home);
  if (name === 'prepare_bind') return prepareBind(args.channelId, args.replace, home);

  const config = loadConfig(home);
  if (name === 'search_channels') {
    return api(config, 'GET', '/api/channels', { query: { q: args.q || '', page: args.page || 1 } });
  }
  if (name === 'create_channel') {
    const result = await api(config, 'POST', '/api/channels', {
      body: { id: args.id, name: args.name, description: args.description },
    });
    if (result.status === 201 && getBinding(args.id, home).state === 'none') {
      writePending(home, args.id);
      return { ...result, pendingBind: true };
    }
    return result;
  }
  if (name === 'join_channel') {
    const result = await api(config, 'POST', `/api/channels/${encodeURIComponent(args.channelId)}/join`);
    if (result.status < 200 || result.status >= 300) return result;
    const binding = getBinding(args.channelId, home);
    if (binding.state === 'bound') {
      return { ...result, state: 'bound_to_other_session', client: binding.client, sessionId: binding.sessionId };
    }
    writePending(home, args.channelId);
    return { ...result, state: 'pending', channelId: args.channelId };
  }
  if (name === 'search_members') {
    const result = await api(config, 'GET', `/api/channels/${encodeURIComponent(args.channelId)}/members`, {
      query: { q: args.nickname },
    });
    if (result && Array.isArray(result.users) && !result.isError) return result.users;
    return result;
  }
  if (name === 'send_message') {
    return api(config, 'POST', `/api/channels/${encodeURIComponent(args.channelId)}/messages`, {
      body: { recipientUserId: args.recipientUserId, body: args.body },
    });
  }
  if (name === 'pull_messages') {
    return api(config, 'POST', `/api/channels/${encodeURIComponent(args.channelId)}/pull`);
  }
  const error = new Error(`unknown_tool:${name}`);
  error.code = 'unknown_tool';
  throw error;
}

function listTools() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

class McpServer {
  listTools() {
    return listTools();
  }

  callTool(name, args, options) {
    return callTool(name, args, options);
  }
}

async function handleRpc(server, message) {
  if (!message || message.jsonrpc !== '2.0' || message.id === undefined) return null;
  try {
    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'agent-link', version: '0.1.0' },
        },
      };
    }
    if (message.method === 'ping') {
      return { jsonrpc: '2.0', id: message.id, result: {} };
    }
    if (message.method === 'tools/list') {
      return { jsonrpc: '2.0', id: message.id, result: { tools: server.listTools() } };
    }
    if (message.method === 'tools/call') {
      const params = message.params || {};
      const result = await server.callTool(params.name, params.arguments || {});
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: Boolean(result && result.isError),
        },
      };
    }
    return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
  } catch (error) {
    return { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } };
  }
}

function startStdio() {
  const server = new McpServer();
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    handleRpc(server, message)
      .then((response) => {
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      })
      .catch((error) => {
        console.error(error);
      });
  });
}

if (require.main === module) startStdio();

module.exports = {
  McpServer,
  TOOLS,
  tools: TOOLS,
  listTools,
  callTool,
  getBinding,
  prepareBind,
  agentHome,
};
