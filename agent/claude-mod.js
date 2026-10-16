'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

function socketPath(explicit) {
  if (explicit) return explicit;
  if (process.env.AGENT_LINK_SOCKET) return process.env.AGENT_LINK_SOCKET;
  const dir = process.env.AGENT_LINK_HOME || path.join(os.homedir(), '.agent-link');
  return path.join(dir, 'watch.sock');
}

function connectClaude({ prompt, sessionId, socketPath: explicit }) {
  if (!sessionId || !prompt || typeof prompt.submit !== 'function') return null;
  const target = socketPath(explicit);
  let socket = null;
  let buffer = '';
  let retry = null;
  let closed = false;

  const schedule = () => {
    if (closed || retry) return;
    retry = setTimeout(() => {
      retry = null;
      open();
    }, 1000);
    if (typeof retry.unref === 'function') retry.unref();
  };

  const open = () => {
    if (closed) return;
    if (!fs.existsSync(target)) {
      schedule();
      return;
    }
    socket = net.connect(target);
    if (typeof socket.unref === 'function') socket.unref();
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ op: 'register', client: 'claude-code', sessionId })}\n`);
    });
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
        if (!message || message.op !== 'deliver' || typeof message.messageText !== 'string') continue;
        if (message.messageText.length === 0) continue;
        Promise.resolve(prompt.submit({ text: message.messageText })).catch(() => undefined);
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      socket = null;
      schedule();
    });
  };

  open();
  return {
    close() {
      closed = true;
      if (retry) clearTimeout(retry);
      if (socket) socket.destroy();
    },
  };
}

function register(on) {
  on('session.start', async ($, event, next) => {
    let sessionId = '';
    try {
      const id = await $.session.id();
      if (id) sessionId = String(id);
    } catch {
      sessionId = '';
    }
    if (sessionId) connectClaude({ prompt: $.prompt, sessionId });
    if (typeof next === 'function') return next(event);
    return undefined;
  });
}

module.exports = { register, connectClaude, socketPath };
