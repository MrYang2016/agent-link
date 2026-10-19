// Claude Code hooks module (ESM). No Node APIs — bridge via $.process.spawn → claude-mod.js.

function startPeerBridge($, sessionId) {
  void readPeerDeliveries($, sessionId);
}

async function readPeerDeliveries($, sessionId) {
  let dir = $.env.get('AGENT_LINK_HOME');
  if (!dir) {
    const home = $.env.get('HOME');
    if (!home) return;
    dir = `${home}/.agent-link`;
  }
  const script = `${dir}/claude-mod.js`;
  try {
    const child = await $.process.spawn(['node', script, sessionId]);
    let buffer = '';
    for await (const chunk of child.stdout) {
      buffer += typeof chunk === 'string' ? chunk : String(chunk);
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
        // submit waits for idle; do not await inside the stream loop
        void Promise.resolve($.prompt.submit({ text: message.messageText })).catch(() => undefined);
      }
    }
  } catch {
    // Peer bridge failed; Stop-hook delivery remains the fallback.
  }
}

export function register(on) {
  on('session.start', async ($, event, next) => {
    let sessionId = '';
    try {
      const id = await $.session.id();
      if (id) sessionId = String(id);
    } catch {
      sessionId = '';
    }
    if (sessionId) startPeerBridge($, sessionId);
    if (typeof next === 'function') return next(event);
    return undefined;
  });
}
