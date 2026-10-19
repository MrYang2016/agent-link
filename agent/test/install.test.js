'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { install, detectGrokBot } = require('../install');

function homeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-link-home-'));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function commandsIn(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (typeof value.command === 'string') found.push(value.command);
  for (const child of Object.values(value)) commandsIn(child, found);
  return found;
}

test('install with piOnPath false returns ok', () => {
  const home = homeDir();
  try {
    const result = install({
      home,
      token: 'secret-token',
      server: 'http://127.0.0.1:3000',
      piOnPath: false,
    });
    assert.equal(result.ok, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install with piOnPath false does not create .pi/agent/mcp.json', () => {
  const home = homeDir();
  try {
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    assert.equal(fs.existsSync(path.join(home, '.pi', 'agent', 'mcp.json')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install with piOnPath false does not create the Pi extension', () => {
  const home = homeDir();
  try {
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    assert.equal(fs.existsSync(path.join(home, '.pi', 'agent', 'extensions', 'agent-link.js')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install with piOnPath true writes the Pi extension', () => {
  const home = homeDir();
  try {
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: true });
    const file = path.join(home, '.pi', 'agent', 'extensions', 'agent-link.js');
    assert.equal(fs.existsSync(file), true);
    assert.ok(fs.statSync(file).size > 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install with piOnPath true writes .pi/agent/mcp.json', () => {
  const home = homeDir();
  try {
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: true });
    const doc = readJson(path.join(home, '.pi', 'agent', 'mcp.json'));
    assert.deepEqual(doc.mcpServers['agent-link'].args, [path.join(home, '.agent-link', 'mcp.js')]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

for (const name of ['stop.js', 'mcp.js', 'pi-deliver.js', 'watch.js', 'claude-mod.js', 'grok-bot-deliver.js']) {
  test(`install copies ${name}`, () => {
    const home = homeDir();
    try {
      install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
      const source = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
      const copied = fs.readFileSync(path.join(home, '.agent-link', name), 'utf8');
      assert.equal(copied, source);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
}

test('install writes a Claude Code skills-dir mod with ESM register', () => {
  const home = homeDir();
  try {
    install({
      home,
      token: 'secret-token',
      server: 'http://127.0.0.1:3000',
      piOnPath: false,
      spawn() {
        return { unref() {} };
      },
    });
    const pluginDir = path.join(home, '.claude', 'skills', 'agent-link');
    const hooksJson = readJson(path.join(pluginDir, 'hooks', 'hooks.json'));
    const register = fs.readFileSync(path.join(pluginDir, 'hooks', 'register.js'), 'utf8');
    const manifest = readJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'));
    const settings = readJson(path.join(home, '.claude', 'settings.json'));
    assert.equal(manifest.name, 'agent-link');
    assert.equal(manifest.defaultEnabled, true);
    assert.deepEqual(hooksJson.modules, ['./register.js']);
    assert.equal(typeof hooksJson.hooks, 'object');
    assert.equal(hooksJson.hooks === null, false);
    assert.equal(Array.isArray(hooksJson.hooks), false);
    assert.match(register, /export function register\s*\(/);
    assert.match(register, /\$\.prompt\.submit/);
    assert.match(register, /\$\.process\.spawn\(\s*\{/);
    assert.match(register, /argv:\s*\[\s*['"]\/usr\/local\/bin\/node['"]/);
    assert.match(register, /await\s+\$\.env\.get\(\s*['"]HOME['"]\s*\)/);
    assert.match(register, /await\s+\$\.env\.get\(\s*['"]AGENT_LINK_HOME['"]\s*\)/);
    assert.match(register, /session\.start/);
    assert.equal(register.includes('createRequire'), false);
    assert.equal(register.includes('require('), false);
    assert.equal(register.includes("spawn(['node'"), false);
    assert.equal(settings.enabledPlugins['agent-link@skills-dir'], true);
    assert.equal(fs.existsSync(path.join(home, '.claude', 'plugins', 'agent-link')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install keeps Claude Stop and UserPromptSubmit command hooks', () => {
  const home = homeDir();
  try {
    install({
      home,
      token: 'secret-token',
      server: 'http://127.0.0.1:3000',
      piOnPath: false,
      spawn() {
        return { unref() {} };
      },
    });
    const commands = commandsIn(readJson(path.join(home, '.claude', 'settings.json')));
    const stop = `node ${path.join(home, '.agent-link', 'stop.js')} claude-code`;
    const busy = `node ${path.join(home, '.agent-link', 'watch.js')} mark-busy claude-code`;
    assert.equal(commands.includes(stop), true);
    assert.equal(commands.includes(busy), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install removes legacy CLAUDE_CODE_PLUGIN_DIRS entries for agent-link', () => {
  const home = homeDir();
  try {
    const settingsPath = path.join(home, '.claude', 'settings.json');
    const legacy = path.join(home, '.claude', 'plugins', 'agent-link');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.mkdirSync(path.join(legacy, 'hooks'), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      `${JSON.stringify(
        {
          env: { CLAUDE_CODE_PLUGIN_DIRS: `${legacy}:/other/plugins` },
          hooks: {},
        },
        null,
        2,
      )}\n`,
    );
    install({
      home,
      token: 'secret-token',
      server: 'http://127.0.0.1:3000',
      piOnPath: false,
      spawn() {
        return { unref() {} };
      },
    });
    const settings = readJson(settingsPath);
    assert.equal(settings.env.CLAUDE_CODE_PLUGIN_DIRS, '/other/plugins');
    assert.equal(fs.existsSync(legacy), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install writes server and token into config.json', () => {
  const home = homeDir();
  try {
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    assert.deepEqual(readJson(path.join(home, '.agent-link', 'config.json')), {
      server: 'http://127.0.0.1:3000',
      token: 'secret-token',
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hook commands do not contain the token', () => {
  const home = homeDir();
  const token = 'super-secret-token-value';
  try {
    install({ home, token, server: 'http://127.0.0.1:3000', piOnPath: false });
    const files = [
      path.join(home, '.cursor', 'hooks.json'),
      path.join(home, '.claude', 'settings.json'),
      path.join(home, '.codex', 'hooks.json'),
    ];
    for (const file of files) {
      assert.equal(fs.readFileSync(file, 'utf8').includes(token), false);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hook files do not contain loop_limit', () => {
  const home = homeDir();
  try {
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    const files = [
      path.join(home, '.cursor', 'hooks.json'),
      path.join(home, '.claude', 'settings.json'),
      path.join(home, '.codex', 'hooks.json'),
    ];
    for (const file of files) {
      assert.equal(fs.readFileSync(file, 'utf8').includes('loop_limit'), false);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('keeps an already-stable Cursor hook command character for character', () => {
  const home = homeDir();
  try {
    const command = `node ${path.join(home, '.agent-link', 'stop.js')} cursor`;
    const hooksPath = path.join(home, '.cursor', 'hooks.json');
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(
      hooksPath,
      `${JSON.stringify({ version: 1, hooks: { stop: [{ command }] } }, null, 2)}\n`,
    );
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    const first = readJson(hooksPath).hooks.stop.map((hook) => hook.command);
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    const second = readJson(hooksPath).hooks.stop.map((hook) => hook.command);
    assert.deepEqual(first, [command]);
    assert.deepEqual(second, [command]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('keeps an already-stable Claude Code hook command character for character', () => {
  const home = homeDir();
  try {
    const command = `node ${path.join(home, '.agent-link', 'stop.js')} claude-code`;
    const hooksPath = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(
      hooksPath,
      `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }, null, 2)}\n`,
    );
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    const first = commandsIn(readJson(hooksPath));
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    const second = commandsIn(readJson(hooksPath));
    const busy = `node ${path.join(home, '.agent-link', 'watch.js')} mark-busy claude-code`;
    assert.deepEqual(first, [command, busy]);
    assert.deepEqual(second, [command, busy]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('keeps an already-stable Codex hook command character for character', () => {
  const home = homeDir();
  try {
    const command = `node ${path.join(home, '.agent-link', 'stop.js')} codex`;
    const hooksPath = path.join(home, '.codex', 'hooks.json');
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(
      hooksPath,
      `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } }, null, 2)}\n`,
    );
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    const first = commandsIn(readJson(hooksPath));
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    const second = commandsIn(readJson(hooksPath));
    const busy = `node ${path.join(home, '.agent-link', 'watch.js')} mark-busy codex`;
    assert.deepEqual(first, [command, busy]);
    assert.deepEqual(second, [command, busy]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('backs up an existing config once and keeps unrelated keys', () => {
  const home = homeDir();
  try {
    const hooksPath = path.join(home, '.cursor', 'hooks.json');
    const original = `${JSON.stringify({ version: 1, hooks: {}, marker: 'original' }, null, 2)}\n`;
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(hooksPath, original);
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    assert.equal(fs.readFileSync(`${hooksPath}.bak`, 'utf8'), original);
    const updated = readJson(hooksPath);
    assert.equal(updated.marker, 'original');
    assert.equal(updated.hooks.stop[0].command, `node ${path.join(home, '.agent-link', 'stop.js')} cursor`);
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    assert.equal(fs.readFileSync(`${hooksPath}.bak`, 'utf8'), original);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('merges an existing Cursor MCP server instead of replacing the file', () => {
  const home = homeDir();
  try {
    const mcpPath = path.join(home, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
    fs.writeFileSync(mcpPath, `${JSON.stringify({ mcpServers: { other: { command: 'other' } } }, null, 2)}\n`);
    install({ home, token: 'secret-token', server: 'http://127.0.0.1:3000', piOnPath: false });
    const doc = readJson(mcpPath);
    assert.equal(doc.mcpServers.other.command, 'other');
    assert.deepEqual(doc.mcpServers['agent-link'], {
      command: 'node',
      args: [path.join(home, '.agent-link', 'mcp.js')],
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function recordingSpawn(calls, pid = process.pid) {
  return (command, args) => {
    calls.push({ command, args: [...(args || [])] });
    return { pid, unref() {} };
  };
}

test('install starts watch.js and does not start mcp.js', () => {
  const home = homeDir();
  const calls = [];
  try {
    const result = install({
      home,
      token: 'secret-token',
      server: 'http://127.0.0.1:3000',
      piOnPath: false,
      spawn: recordingSpawn(calls),
    });
    assert.equal(result.ok, true);
    const watchPath = path.join(home, '.agent-link', 'watch.js');
    assert.deepEqual(calls, [{ command: process.execPath, args: [watchPath] }]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install does not start a second watch.js when the first process is still running', () => {
  const home = homeDir();
  const calls = [];
  try {
    const options = {
      home,
      token: 'secret-token',
      server: 'http://127.0.0.1:3000',
      piOnPath: false,
      spawn: recordingSpawn(calls),
    };
    install(options);
    install(options);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args[0], path.join(home, '.agent-link', 'watch.js'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

for (const [file, client] of [
  [path.join('.cursor', 'hooks.json'), 'cursor'],
  [path.join('.claude', 'settings.json'), 'claude-code'],
  [path.join('.codex', 'hooks.json'), 'codex'],
]) {
  test(`install wires mark-busy ${client} in ${file}`, () => {
    const home = homeDir();
    try {
      install({
        home,
        token: 'secret-token',
        server: 'http://127.0.0.1:3000',
        piOnPath: false,
        spawn() {
          return { unref() {} };
        },
      });
      const command = `node ${path.join(home, '.agent-link', 'watch.js')} mark-busy ${client}`;
      assert.equal(fs.readFileSync(path.join(home, file), 'utf8').includes(command), true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
}

test('detectGrokBot honors explicit flag, client, env, and CURSOR_AGENT', () => {
  assert.equal(detectGrokBot({ grokBot: true, env: {} }), true);
  assert.equal(detectGrokBot({ client: 'grok-bot', env: {} }), true);
  assert.equal(detectGrokBot({ env: { AGENT_LINK_CLIENT: 'grok-bot' } }), true);
  assert.equal(detectGrokBot({ env: { CURSOR_AGENT: '1' } }), true);
  assert.equal(detectGrokBot({ env: { CURSOR_AGENT: '1', NODE_TEST_CONTEXT: '1' } }), false);
  assert.equal(
    detectGrokBot({ env: { CURSOR_AGENT: '1', NODE_TEST_CONTEXT: '1', AGENT_LINK_ALLOW_CURSOR_AGENT: '1' } }),
    true,
  );
  assert.equal(detectGrokBot({ env: {} }), false);
});

test('install with grokBot writes config marker, session file, and inbox dir', () => {
  const home = homeDir();
  try {
    const result = install({
      home,
      token: 'secret-token',
      server: 'http://127.0.0.1:3000',
      piOnPath: false,
      grokBot: true,
      env: { CURSOR_CONVERSATION_ID: 'bc-grok-1' },
      spawn() {
        return { pid: process.pid, unref() {} };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.grokBot, true);
    assert.equal(result.sessionId, 'bc-grok-1');
    assert.deepEqual(readJson(path.join(home, '.agent-link', 'config.json')), {
      server: 'http://127.0.0.1:3000',
      token: 'secret-token',
      grokBot: true,
    });
    assert.deepEqual(readJson(path.join(home, '.agent-link', 'grok-bot-session.json')), {
      sessionId: 'bc-grok-1',
    });
    assert.equal(fs.existsSync(path.join(home, '.agent-link', 'inbox')), true);
    assert.equal(fs.existsSync(path.join(home, '.agent-link', 'grok-bot-deliver.js')), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install with client grok-bot starts watch the same way as other clients', () => {
  const home = homeDir();
  const calls = [];
  try {
    install({
      home,
      token: 'secret-token',
      server: 'http://127.0.0.1:3000',
      piOnPath: false,
      client: 'grok-bot',
      env: {},
      spawn: recordingSpawn(calls),
    });
    assert.deepEqual(calls, [{ command: process.execPath, args: [path.join(home, '.agent-link', 'watch.js')] }]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install without grok signals does not mark config.grokBot', () => {
  const home = homeDir();
  try {
    install({
      home,
      token: 'secret-token',
      server: 'http://127.0.0.1:3000',
      piOnPath: false,
      env: {},
      spawn() {
        return { unref() {} };
      },
    });
    assert.deepEqual(readJson(path.join(home, '.agent-link', 'config.json')), {
      server: 'http://127.0.0.1:3000',
      token: 'secret-token',
    });
    assert.equal(fs.existsSync(path.join(home, '.agent-link', 'grok-bot-session.json')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
