import { emitEvent } from './eventBus';

type WsSendData = Parameters<WebSocket['send']>[0];

function tryParse(x: unknown): unknown {
  try {
    return typeof x === 'string' ? JSON.parse(x) : x;
  } catch {
    return x;
  }
}

export function createLoggedWebSocket(url: string, protocols?: string | string[]) {
  const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);

  const originalSend = ws.send.bind(ws);
  ws.send = (data: WsSendData) => {
    emitEvent({
      kind: 'ws-out',
      channel: url,
      title: 'WS →',
      payload: tryParse(data),
    });
    return originalSend(data);
  };

  ws.addEventListener?.('open', () => {
    emitEvent({ kind: 'ws-in', channel: url, title: 'WS open' });
  });

  ws.addEventListener?.('close', (ev) => {
    emitEvent({
      kind: 'ws-in',
      channel: url,
      title: 'WS close',
      payload: { code: ev.code, reason: ev.reason },
    });
  });

  ws.addEventListener?.('error', (ev) => {
    emitEvent({
      kind: 'ws-in',
      channel: url,
      title: 'WS error',
      payload: { type: ev.type },
    });
  });

  ws.addEventListener?.('message', (msg: MessageEvent) => {
    emitEvent({
      kind: 'ws-in',
      channel: url,
      title: 'WS ←',
      payload: tryParse(msg.data),
    });
  });

  return ws;
}

