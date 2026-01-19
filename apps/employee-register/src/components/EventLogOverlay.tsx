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
    const unsubscribe = onEvent((e) => {
      if (paused) return;
      setEvents((prev) => [...prev, e].slice(-MAX_EVENTS));
    });
    return () => {
      unsubscribe();
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
    <div style={outer}>
      <div style={header}>
        <strong>Event Log</strong>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={input} />
          <label style={pill}>
            <input
              type="checkbox"
              checked={filterWSIn}
              onChange={(e) => setFilterWSIn(e.target.checked)}
            />{' '}
            WS In
          </label>
          <label style={pill}>
            <input
              type="checkbox"
              checked={filterWSOut}
              onChange={(e) => setFilterWSOut(e.target.checked)}
            />{' '}
            WS Out
          </label>
          <label style={pill}>
            <input type="checkbox" checked={filterDB} onChange={(e) => setFilterDB(e.target.checked)} /> DB
          </label>
          <button onClick={() => setPaused((p) => !p)} style={btn}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={() => void navigator.clipboard.writeText(JSON.stringify(filtered, null, 2))}
            style={btn}
          >
            Copy
          </button>
          <button onClick={() => setEvents([])} style={btn}>
            Clear
          </button>
          <button onClick={() => setShow(false)} style={btn}>
            Hide
          </button>
        </div>
      </div>

      <div style={list}>
        {filtered.map((e) => (
          <div key={e.id} style={{ ...row, borderLeft: `4px solid ${colorFor(e.kind)}` }}>
            <div style={rowTop}>
              <span style={tag(colorFor(e.kind))}>{e.kind}</span>
              <span style={{ opacity: 0.8 }}>{new Date(e.ts).toLocaleTimeString()}</span>
              {e.channel && <span style={{ opacity: 0.8 }}>· {e.channel}</span>}
              <strong>· {e.title}</strong>
            </div>

            {e.payload !== undefined && <pre style={pre}>{safeStringify(e.payload)}</pre>}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const outer: React.CSSProperties = {
  position: 'fixed',
  right: 12,
  bottom: 12,
  width: 420,
  maxHeight: '60vh',
  background: 'rgba(20,20,24,0.9)',
  color: '#fff',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
  backdropFilter: 'blur(6px)',
  overflow: 'hidden',
  zIndex: 999999,
};

const header: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 10px',
  background: 'rgba(255,255,255,0.06)',
};

const list: React.CSSProperties = {
  overflow: 'auto',
  maxHeight: 'calc(60vh - 42px)',
  padding: 8,
};

const row: React.CSSProperties = {
  padding: '6px 8px',
  marginBottom: 6,
  background: 'rgba(255,255,255,0.04)',
  borderRadius: 6,
};

const rowTop: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  marginBottom: 4,
  flexWrap: 'wrap',
};

const pre: React.CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: 'rgba(0,0,0,0.35)',
  padding: 6,
  borderRadius: 4,
};

const input: React.CSSProperties = {
  height: 24,
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(0,0,0,0.4)',
  color: '#fff',
  padding: '0 8px',
};

const btn: React.CSSProperties = {
  height: 24,
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
  padding: '0 8px',
  cursor: 'pointer',
};

const pill: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'rgba(255,255,255,0.08)',
  padding: '2px 6px',
  borderRadius: 999,
};

function colorFor(k: LogEvent['kind']) {
  if (k === 'ws-in') return '#79ffa1';
  if (k === 'ws-out') return '#7db3ff';
  return '#ffd279';
}

function tag(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: '#111',
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 999,
    textTransform: 'uppercase',
  };
}

function safeStringify(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

