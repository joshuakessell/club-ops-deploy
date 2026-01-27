export type EventKind = 'ws-in' | 'ws-out' | 'db';

export type LogEvent = {
  id: string;
  ts: number;
  kind: EventKind;
  channel?: string;
  title: string;
  payload?: unknown;
};

type Listener = (e: LogEvent) => void;

const listeners = new Set<Listener>();

export function emitEvent(e: Omit<LogEvent, 'id' | 'ts'>) {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const event: LogEvent = { id, ts: Date.now(), ...e };
  for (const l of listeners) l(event);
}

export function onEvent(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitDbEvent(title: string, channel?: string, payload?: unknown) {
  emitEvent({ kind: 'db', title, channel, payload });
}
