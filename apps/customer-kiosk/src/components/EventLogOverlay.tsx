import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LogEvent, onEvent } from '../lib/eventBus';

const MAX_EVENTS = 500;

export default function EventLogOverlay() {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [show, setShow] = useState(import.meta.env.MODE !== 'production');
  const [paused, setPaused] = useState(false);

  const [filterWSIn, setFilterWSIn] = useState(true);
  const [filterWSOut, setFilterWSOut] = useState(true);
  const [filterDB, setFilterDB] = useState(true);
  const [q, setQ] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = onEvent((e) => {
      if (paused) return;
      setEvents((prev) => [...prev, e].slice(-MAX_EVENTS));
    });
    return () => {
      off();
    };
  }, [paused]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const filtered = useMemo(() => {
    const kinds = new Set<string>();
    if (filterWSIn) kinds.add('ws-in');
    if (filterWSOut) kinds.add('ws-out');
    if (filterDB) kinds.add('db');

    const s = q.trim().toLowerCase();

    return events.filter((e) => {
      if (!kinds.has(e.kind)) return false;
      if (!s) return true;

      const hay = [
        e.title,
        e.channel ?? '',
        (() => {
          try {
            return JSON.stringify(e.payload ?? '');
          } catch {
            return '[Unserializable payload]';
          }
        })(),
      ]
        .join(' ')
        .toLowerCase();

      return hay.includes(s);
    });
  }, [events, filterWSIn, filterWSOut, filterDB, q]);

  if (!show) return null;

  return (
    <div className="cs-event-log">
      <div className="cs-event-log__header">
        <strong>Event Log</strong>
        <div className="cs-event-log__controls">
          <input
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="cs-event-log__input"
          />
          <label className="cs-event-log__pill">
            <input
              type="checkbox"
              checked={filterWSIn}
              onChange={(e) => setFilterWSIn(e.target.checked)}
            />{' '}
            WS In
          </label>
          <label className="cs-event-log__pill">
            <input
              type="checkbox"
              checked={filterWSOut}
              onChange={(e) => setFilterWSOut(e.target.checked)}
            />{' '}
            WS Out
          </label>
          <label className="cs-event-log__pill">
            <input
              type="checkbox"
              checked={filterDB}
              onChange={(e) => setFilterDB(e.target.checked)}
            />{' '}
            DB
          </label>
          <button onClick={() => setPaused((p) => !p)} className="cs-event-log__button">
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={() => void navigator.clipboard.writeText(JSON.stringify(filtered, null, 2))}
            className="cs-event-log__button"
          >
            Copy
          </button>
          <button onClick={() => setEvents([])} className="cs-event-log__button">
            Clear
          </button>
          <button onClick={() => setShow(false)} className="cs-event-log__button">
            Hide
          </button>
        </div>
      </div>

      <div className="cs-event-log__list">
        {filtered.map((e) => (
          <div
            key={e.id}
            className="cs-event-log__row"
            style={{ '--event-color': colorFor(e.kind) } as React.CSSProperties}
          >
            <div className="cs-event-log__row-top">
              <span className="cs-event-log__tag">{e.kind}</span>
              <span className="cs-event-log__meta">
                {new Date(e.ts).toLocaleTimeString()}
              </span>
              {e.channel && <span className="cs-event-log__meta">· {e.channel}</span>}
              <strong>· {e.title}</strong>
            </div>

            {e.payload !== undefined && (
              <pre className="cs-event-log__payload">{safeStringify(e.payload)}</pre>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function colorFor(k: LogEvent['kind']) {
  if (k === 'ws-in') return '#79ffa1';
  if (k === 'ws-out') return '#7db3ff';
  return '#ffd279';
}

function safeStringify(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
