// Claude Code hooks module (ESM). Bridge via $.process.spawn → claude-mod.js (keepAlive).

function unwrapString(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && typeof raw.value === 'string') return raw.value;
  if (typeof raw === 'object' && typeof raw.text === 'string') return raw.text;
  return String(raw);
}

async function logLine($, text) {
  try {
    const home = unwrapString(await $.env.get('HOME'));
    if (!home) return;
    const path = `${home}/.agent-link/peer.log`;
    let prev = '';
    try {
      const existing = await $.fs.read(path);
      if (typeof existing === 'string') prev = existing;
      else if (existing && typeof existing.text === 'string') prev = existing.text;
      else if (existing && typeof existing.value === 'string') prev = existing.value;
    } catch {
      prev = '';
    }
    await $.fs.write(path, `${prev}${text}\n`);
  } catch {
    // ignore
  }
}

async function consumeLines($, stream) {
  let buffer = '';
  for await (const chunk of stream) {
    const piece =
      typeof chunk === 'string'
        ? chunk
        : chunk && typeof chunk === 'object' && typeof chunk.text === 'string'
          ? chunk.text
          : chunk && typeof chunk === 'object' && typeof chunk.value === 'string'
            ? chunk.value
            : typeof chunk === 'object' && chunk && typeof chunk.messageText === 'string'
              ? null
              : String(chunk);
    if (piece == null) {
      void Promise.resolve($.prompt.submit({ text: chunk.messageText })).catch(() => undefined);
      continue;
    }
    buffer += piece;
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
      if (!message.messageText) continue;
      void Promise.resolve($.prompt.submit({ text: message.messageText })).catch(() => undefined);
    }
  }
}

async function readPeerDeliveries($, sessionId) {
  let dir = unwrapString(await $.env.get('AGENT_LINK_HOME'));
  if (!dir) {
    const home = unwrapString(await $.env.get('HOME'));
    if (!home) return;
    dir = `${home}/.agent-link`;
  }
  const script = `${dir}/claude-mod.js`;
  await logLine($, `${new Date().toISOString()} spawn session=${sessionId}`);
  try {
    const child = $.process.spawn({
      argv: ['/usr/local/bin/node', script, sessionId],
    });
    const stream = (child && child.stdout) || child;
    await logLine($, `${new Date().toISOString()} consuming peer stdout session=${sessionId}`);
    await consumeLines($, stream);
    await logLine($, `${new Date().toISOString()} peer ended session=${sessionId}`);
  } catch (error) {
    await logLine(
      $,
      `${new Date().toISOString()} spawn fail ${error && error.message ? error.message : String(error)}`,
    );
  }
}

export function register(on) {
  on('session.start', async ($, event, next) => {
    let sessionId = '';
    try {
      sessionId = unwrapString(await $.session.id());
    } catch {
      sessionId = '';
    }
    await logLine($, `${new Date().toISOString()} session.start id=${sessionId || '(empty)'}`);
    if (sessionId) void readPeerDeliveries($, sessionId);
    if (typeof next === 'function') return next(event);
    return undefined;
  });
}
