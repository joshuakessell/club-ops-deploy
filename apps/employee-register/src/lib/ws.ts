import { emitEvent } from './eventBus';

function tryParse(x: any) {
  try {
    return typeof x === 'string' ? JSON.parse(x) : x;
  } catch {
    return x;
  }
}

export function createLoggedWebSocket(url: string, protocols?: string | string[]) {
  const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);

  const originalSend = ws.send.bind(ws);
  ws.send = (data: any) => {
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
      payload: String(ev),
    });
  });

  ws.addEventListener?.('message', (msg) => {
    emitEvent({
      kind: 'ws-in',
      channel: url,
      title: 'WS ←',
      payload: tryParse((msg as MessageEvent).data),
    });
  });

  return ws;
}

