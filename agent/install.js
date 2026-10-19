'use strict';

const fs = require('fs');
const path = require('path');

const { startWatchProcess } = require('./watch');

const COPIED_FILES = ['stop.js', 'mcp.js', 'pi-deliver.js', 'followup.js', 'watch.js', 'claude-mod.js'];

function nodeCommand(file, arg) {
  return arg ? `node ${file} ${arg}` : `node ${file}`;
}

function readText(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function writeText(file, next) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = readText(file);
  if (current === next) return;
  if (current !== null) {
    const backup = `${file}.bak`;
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  }
  fs.writeFileSync(file, next);
}

function readJson(file) {
  const text = readText(file);
  if (text === null || text.trim() === '') return {};
  return JSON.parse(text);
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function commandMatches(command, scriptName, clientArg) {
  if (typeof command !== 'string') return false;
  return command.includes(`${scriptName}`) && command.endsWith(` ${clientArg}`) && command.includes('.agent-link/');
}

function upsertCursorHook(doc, eventName, command, scriptName, clientArg) {
  if (doc.version == null) doc.version = 1;
  doc.hooks = doc.hooks && typeof doc.hooks === 'object' ? doc.hooks : {};
  const list = Array.isArray(doc.hooks[eventName]) ? doc.hooks[eventName] : [];
  let found = false;
  for (const hook of list) {
    if (!hook || typeof hook.command !== 'string') continue;
    if (hook.command === command || commandMatches(hook.command, scriptName, clientArg)) {
      found = true;
      if (hook.command !== command) hook.command = command;
    }
  }
  if (!found) list.push({ command });
  doc.hooks[eventName] = list;
  return doc;
}

function upsertNestedStop(doc, eventName, command, scriptClient, scriptName = 'stop.js') {
  doc.hooks = doc.hooks && typeof doc.hooks === 'object' ? doc.hooks : {};
  const groups = Array.isArray(doc.hooks[eventName]) ? doc.hooks[eventName] : [];
  let found = false;
  for (const group of groups) {
    const hooks = group && Array.isArray(group.hooks) ? group.hooks : [];
    for (const hook of hooks) {
      if (!hook || typeof hook.command !== 'string') continue;
      if (hook.command === command || commandMatches(hook.command, scriptName, scriptClient)) {
        found = true;
        if (hook.command !== command) hook.command = command;
      }
    }
  }
  if (!found) groups.push({ hooks: [{ type: 'command', command }] });
  doc.hooks[eventName] = groups;
  return doc;
}

function removePluginDirEnv(doc, pluginDirs) {
  if (!doc.env || typeof doc.env !== 'object') return doc;
  const current = typeof doc.env.CLAUDE_CODE_PLUGIN_DIRS === 'string' ? doc.env.CLAUDE_CODE_PLUGIN_DIRS : '';
  if (!current) return doc;
  const drop = new Set(pluginDirs);
  const parts = current.split(':').filter((part) => part.length > 0 && !drop.has(part));
  if (parts.length === 0) delete doc.env.CLAUDE_CODE_PLUGIN_DIRS;
  else doc.env.CLAUDE_CODE_PLUGIN_DIRS = parts.join(':');
  return doc;
}

function upsertEnabledPlugin(doc, pluginId) {
  doc.enabledPlugins = doc.enabledPlugins && typeof doc.enabledPlugins === 'object' ? doc.enabledPlugins : {};
  doc.enabledPlugins[pluginId] = true;
  return doc;
}

function upsertMcpJson(doc, argsFile) {
  doc.mcpServers = doc.mcpServers && typeof doc.mcpServers === 'object' ? doc.mcpServers : {};
  const current = doc.mcpServers['agent-link'];
  const args = [argsFile];
  if (current && current.command === 'node' && JSON.stringify(current.args) === JSON.stringify(args)) return doc;
  doc.mcpServers['agent-link'] = {
    ...(current && typeof current === 'object' ? current : {}),
    command: 'node',
    args,
  };
  return doc;
}

function tomlString(value) {
  return JSON.stringify(value);
}

function upsertCodexToml(original, mcpFile) {
  const start = '# agent-link:start';
  const end = '# agent-link:end';
  const block = [
    start,
    '[mcp_servers.agent-link]',
    'command = "node"',
    `args = [${tomlString(mcpFile)}]`,
    end,
    '',
  ].join('\n');
  if (original === null || original.trim() === '') return block;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}\\n?`);
  if (pattern.test(original)) return original.replace(pattern, block);
  return `${original.endsWith('\n') ? original : `${original}\n`}${block}`;
}

function renderPiExtension(linkDir) {
  const deliverPath = JSON.stringify(path.join(linkDir, 'pi-deliver.js'));
  const stopPath = JSON.stringify(path.join(linkDir, 'stop.js'));
  const watchPath = JSON.stringify(path.join(linkDir, 'watch.js'));
  const dir = JSON.stringify(linkDir);
  const sock = JSON.stringify(path.join(linkDir, 'watch.sock'));
  return `'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const { deliverIfMessage } = require(${deliverPath});
const { resolveStop } = require(${stopPath});
const { clearBusy } = require(${watchPath});

function sessionIdOf(ctx) {
  const manager = ctx && ctx.sessionManager;
  if (!manager) return '';
  if (typeof manager.getSessionId === 'function') {
    const id = manager.getSessionId();
    if (id) return String(id);
  }
  if (manager.sessionId) return String(manager.sessionId);
  const file = typeof manager.getSessionFile === 'function' ? manager.getSessionFile() : manager.sessionFile;
  if (!file) return '';
  return path.basename(String(file)).replace(/\\.[^.]+$/, '');
}

function listenForDelivery(pi, sessionId) {
  if (!sessionId) return;
  const target = ${sock};
  let socket = null;
  let buffer = '';
  let retry = null;
  const schedule = () => {
    if (retry) return;
    retry = setTimeout(open, 1000);
    if (typeof retry.unref === 'function') retry.unref();
  };
  const open = () => {
    retry = null;
    if (!fs.existsSync(target)) {
      schedule();
      return;
    }
    socket = net.connect(target);
    if (typeof socket.unref === 'function') socket.unref();
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(JSON.stringify({ op: 'register', client: 'pi', sessionId }) + '\\n');
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index = buffer.indexOf('\\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\\n');
        let message = null;
        try {
          message = JSON.parse(line);
        } catch (error) {
          message = null;
        }
        if (!message || message.op !== 'deliver' || typeof message.messageText !== 'string') continue;
        deliverIfMessage(message.messageText, (text) => {
          pi.sendUserMessage(text);
        });
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', schedule);
  };
  if (listenForDelivery.current === sessionId && listenForDelivery.socket) return;
  if (listenForDelivery.socket) listenForDelivery.socket.destroy();
  listenForDelivery.current = sessionId;
  listenForDelivery.socket = null;
  open();
  listenForDelivery.socket = socket;
}

module.exports = function agentLinkExtension(pi) {
  pi.on('agent_settled', async (event, ctx) => {
    const sessionId = sessionIdOf(ctx);
    if (!sessionId) return;
    listenForDelivery(pi, sessionId);
    const dir = ${dir};
    clearBusy({ client: 'pi', stdin: { session_id: sessionId }, dir });
    if (event && event.aborted) return;
    const configPath = path.join(dir, 'config.json');
    if (!fs.existsSync(configPath)) return;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const pendingPath = path.join(dir, 'pending-bind.json');
    const bindingsPath = path.join(dir, 'bindings.json');
    const outcome = await resolveStop({
      client: 'pi',
      stdin: { session_id: sessionId },
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
        fs.writeFileSync(bindingsPath, JSON.stringify(bindings, null, 2) + '\\n');
      },
      async request(url, init) {
        const response = await fetch(url, init);
        const data = await response.json();
        if (!response.ok) {
          const error = new Error(data.error || 'pull_failed');
          throw error;
        }
        return data;
      },
    });
    if (!outcome.pulled) return;
    deliverIfMessage(outcome.messages, (text) => {
      pi.sendUserMessage(text);
    });
  });
};
`;
}

function claudePluginDir(home) {
  return path.join(home, '.claude', 'skills', 'agent-link');
}

function writeClaudeMod(home) {
  const pluginDir = claudePluginDir(home);
  const legacyPluginDir = path.join(home, '.claude', 'plugins', 'agent-link');
  if (fs.existsSync(legacyPluginDir)) {
    fs.rmSync(legacyPluginDir, { recursive: true, force: true });
  }
  writeJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'), {
    name: 'agent-link',
    version: '0.0.2',
    description: 'Deliver agent-link channel messages into this Claude Code session (mods API)',
    defaultEnabled: true,
  });
  // hooks must be a record for Claude Code 2.1.x validate; modules makes this a mod.
  writeJson(path.join(pluginDir, 'hooks', 'hooks.json'), {
    description: 'agent-link Claude Code mod: session.start → watch.sock peer → $.prompt.submit',
    modules: ['./register.js'],
    hooks: {},
  });
  writeText(path.join(pluginDir, 'hooks', 'register.js'), readText(path.join(__dirname, 'claude-register.js')));
  return pluginDir;
}

function install({ home, token, server, piOnPath, spawn }) {
  if (!home) throw new Error('home is required');
  const linkDir = path.join(home, '.agent-link');
  fs.mkdirSync(linkDir, { recursive: true });
  for (const name of COPIED_FILES) {
    fs.copyFileSync(path.join(__dirname, name), path.join(linkDir, name));
  }
  writeJson(path.join(linkDir, 'config.json'), { server, token });
  startWatchProcess({ linkDir, spawn });

  const stopCursor = nodeCommand(path.join(linkDir, 'stop.js'), 'cursor');
  const stopClaude = nodeCommand(path.join(linkDir, 'stop.js'), 'claude-code');
  const stopCodex = nodeCommand(path.join(linkDir, 'stop.js'), 'codex');
  const watchFile = path.join(linkDir, 'watch.js');
  const busyCursor = nodeCommand(watchFile, 'mark-busy cursor');
  const busyClaude = nodeCommand(watchFile, 'mark-busy claude-code');
  const busyCodex = nodeCommand(watchFile, 'mark-busy codex');
  const mcpFile = path.join(linkDir, 'mcp.js');

  writeJson(path.join(home, '.cursor', 'mcp.json'), upsertMcpJson(readJson(path.join(home, '.cursor', 'mcp.json')), mcpFile));
  const cursorHooks = readJson(path.join(home, '.cursor', 'hooks.json'));
  upsertCursorHook(cursorHooks, 'stop', stopCursor, 'stop.js', 'cursor');
  upsertCursorHook(cursorHooks, 'beforeSubmitPrompt', busyCursor, 'watch.js', 'cursor');
  writeJson(path.join(home, '.cursor', 'hooks.json'), cursorHooks);
  const claudeJsonPath = path.join(home, '.claude.json');
  const claudeJson = readJson(claudeJsonPath);
  claudeJson.mcpServers = claudeJson.mcpServers && typeof claudeJson.mcpServers === 'object' ? claudeJson.mcpServers : {};
  writeJson(claudeJsonPath, upsertMcpJson(claudeJson, mcpFile));
  const claudeSettings = readJson(path.join(home, '.claude', 'settings.json'));
  upsertNestedStop(claudeSettings, 'Stop', stopClaude, 'claude-code');
  upsertNestedStop(claudeSettings, 'UserPromptSubmit', busyClaude, 'claude-code', 'watch.js');
  const pluginDir = writeClaudeMod(home);
  // Prefer skills-dir load (every session) over CLAUDE_CODE_PLUGIN_DIRS alone.
  removePluginDirEnv(claudeSettings, [
    pluginDir,
    path.join(home, '.claude', 'plugins', 'agent-link'),
  ]);
  upsertEnabledPlugin(claudeSettings, 'agent-link@skills-dir');
  writeJson(path.join(home, '.claude', 'settings.json'), claudeSettings);
  writeText(path.join(home, '.codex', 'config.toml'), upsertCodexToml(readText(path.join(home, '.codex', 'config.toml')), mcpFile));
  const codexHooks = readJson(path.join(home, '.codex', 'hooks.json'));
  upsertNestedStop(codexHooks, 'Stop', stopCodex, 'codex');
  upsertNestedStop(codexHooks, 'UserPromptSubmit', busyCodex, 'codex', 'watch.js');
  writeJson(path.join(home, '.codex', 'hooks.json'), codexHooks);

  if (piOnPath === true) {
    writeJson(path.join(home, '.pi', 'agent', 'mcp.json'), upsertMcpJson(readJson(path.join(home, '.pi', 'agent', 'mcp.json')), mcpFile));
    writeText(path.join(home, '.pi', 'agent', 'extensions', 'agent-link.js'), renderPiExtension(linkDir));
  }

  return { ok: true };
}

module.exports = { install, writeClaudeMod, claudePluginDir };
