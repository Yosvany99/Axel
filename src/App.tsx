import React, { useEffect, useRef, useState, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────
interface Log {
  id: string;
  timestamp: number;
  level: string;
  message: string;
  data?: any;
  model?: string;
  provider?: string;
}

interface Provider {
  id: string;
  type: string;
  models: string[];
}

interface Config {
  primaryProvider?: string;
  primaryModel?: string;
  maxSteps: number;
  maxContextMessages: number;
}

interface State {
  isProcessing: boolean;
  currentModel?: string;
  currentProvider?: string;
}

// ── API helpers ──────────────────────────────────────────
async function api(path: string, opts?: RequestInit) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return res.json();
}

// ── Icons (inline SVG) ────────────────────────────────────
const Icon = ({ d, size = 16, ...p }: { d: string; size?: number; [k: string]: any }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d={d} />
  </svg>
);
const Icons = {
  chat:    "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  logs:    "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  key:     "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  settings:"M12 15a3 3 0 100-6 3 3 0 000 6zm8.485-3A8.485 8.485 0 1112 3.515 8.485 8.485 0 0120.485 12z",
  send:    "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  trash:   "M3 6h18M19 6l-1 14H6L5 6M10 6V4h4v2",
  plus:    "M12 5v14M5 12h14",
  x:       "M18 6L6 18M6 6l12 12",
  check:   "M20 6L9 17l-5-5",
  menu:    "M3 12h18M3 6h18M3 18h18",
  zap:     "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  cpu:     "M18 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2zM9 9h6M9 12h6M9 15h4",
  terminal:"M4 17l6-6-6-6M12 19h8",
  eye:     "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 100 6 3 3 0 000-6z",
  eyeoff:  "M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22",
  loader:  "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83",
};

// ── Log level styles ───────────────────────────────────────
function logStyle(level: string) {
  switch (level) {
    case 'user_message':  return { color: '#e8e8f0', bg: '#7c6aff22', border: '#7c6aff55', label: 'You', dot: '#7c6aff' };
    case 'agent_message': return { color: '#e8e8f0', bg: '#111118', border: '#2a2a3a', label: 'Agent', dot: '#4dd9e8' };
    case 'tool_call':     return { color: '#ffb347', bg: '#ffb34710', border: '#ffb34730', label: 'Tool', dot: '#ffb347' };
    case 'tool_result':   return { color: '#3ddc84', bg: '#3ddc8410', border: '#3ddc8430', label: 'Result', dot: '#3ddc84' };
    case 'thought':       return { color: '#8888a8', bg: '#1a1a24', border: '#2a2a3a', label: 'Thought', dot: '#5555708' };
    case 'error':         return { color: '#ff5f6d', bg: '#ff5f6d10', border: '#ff5f6d30', label: 'Error', dot: '#ff5f6d' };
    case 'warn':          return { color: '#ffb347', bg: '#ffb34710', border: '#ffb34730', label: 'Warn', dot: '#ffb347' };
    default:              return { color: '#5a5a7a', bg: 'transparent', border: 'transparent', label: level, dot: '#5a5a7a' };
  }
}

function shouldShowInChat(log: Log, showThoughts: boolean): boolean {
  if (log.level === 'user_message') return true;
  if (log.level === 'agent_message') return true;
  if (log.level === 'tool_call') return true;
  if (log.level === 'tool_result') return true;
  if (log.level === 'error') return true;
  if (log.level === 'thought') return showThoughts;
  return false;
}

// ── Sub-components ────────────────────────────────────────

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
      <path d={Icons.loader} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

function LogCard({ log }: { log: Log }) {
  const s = logStyle(log.level);
  const [expanded, setExpanded] = useState(false);
  const isUser = log.level === 'user_message';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '10px',
    }}>
      <div style={{
        maxWidth: '85%',
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        padding: '10px 14px',
        position: 'relative',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, opacity: 0.7 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, flexShrink: 0, display: 'inline-block' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: s.dot }}>
            {s.label}{log.model ? ` · ${log.model.split('/').pop()}` : ''}
          </span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text2)' }}>
            {new Date(log.timestamp).toLocaleTimeString()}
          </span>
        </div>

        {/* Message */}
        <div style={{ color: s.color, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 13.5 }}>
          {log.message}
        </div>

        {/* Data (tool args / results) */}
        {log.data && typeof log.data !== 'object' ? (
          <div style={{
            marginTop: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            background: '#0a0a0f',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 10px',
            color: s.color,
            whiteSpace: 'pre-wrap',
            maxHeight: expanded ? 'none' : '200px',
            overflow: 'hidden',
          }}>
            {log.data}
          </div>
        ) : log.data && typeof log.data === 'object' && Object.keys(log.data).length > 0 ? (
          <div style={{ marginTop: 8 }}>
            <div
              onClick={() => setExpanded(e => !e)}
              style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text2)', marginBottom: 4, userSelect: 'none' }}
            >
              {expanded ? '▾' : '▸'} {log.level === 'tool_call' ? 'Arguments' : log.level === 'agent_message' ? 'Tokens' : 'Data'}
            </div>
            {expanded && (
              <pre style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                background: '#0a0a0f',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '8px 10px',
                color: 'var(--text2)',
                overflow: 'auto',
                maxHeight: 300,
              }}>
                {JSON.stringify(log.data, null, 2)}
              </pre>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────
type Tab = 'chat' | 'logs' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [logs, setLogs] = useState<Log[]>([]);
  const [state, setState] = useState<State>({ isProcessing: false });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [config, setConfig] = useState<Config>({ maxSteps: 50, maxContextMessages: 60 });

  const [input, setInput] = useState('');
  const [showThoughts, setShowThoughts] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Provider form
  const [newKey, setNewKey] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [addingKey, setAddingKey] = useState(false);
  const [keyError, setKeyError] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottomRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Polling
  useEffect(() => {
    let mounted = true;
    async function poll() {
      try {
        const [logsData, statusData] = await Promise.all([
          fetch('/api/logs').then(r => r.json()),
          fetch('/api/status').then(r => r.json()),
        ]);
        if (!mounted) return;
        setLogs(logsData);
        setState(statusData.state);
        setProviders(statusData.providers);
        setConfig(statusData.config);
      } catch { /* server not ready */ }
    }
    poll();
    const id = setInterval(poll, 1000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Auto scroll
  useEffect(() => {
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    atBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
  };

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || state.isProcessing) return;
    setInput('');
    await api('/api/chat', { method: 'POST', body: JSON.stringify({ text }) });
    atBottomRef.current = true;
  }, [input, state.isProcessing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const addProvider = async () => {
    if (!newKey.trim()) return;
    setAddingKey(true);
    setKeyError('');
    try {
      const result = await api('/api/providers', { method: 'POST', body: JSON.stringify({ apiKey: newKey.trim() }) });
      if (result.error) { setKeyError(result.error); return; }
      setNewKey('');
    } catch { setKeyError('Failed to add provider'); }
    finally { setAddingKey(false); }
  };

  const removeProvider = async (id: string) => {
    await api(`/api/providers/${id}`, { method: 'DELETE' });
    // If this was the selected provider, clear config
    if (config.primaryProvider === id) {
      await api('/api/config', { method: 'PATCH', body: JSON.stringify({ primaryProvider: undefined, primaryModel: undefined }) });
    }
  };

  const updateConfig = async (patch: Partial<Config>) => {
    const updated = { ...config, ...patch };
    setConfig(updated);
    await api('/api/config', { method: 'PATCH', body: JSON.stringify(patch) });
  };

  const chatLogs = logs.filter(l => shouldShowInChat(l, showThoughts));

  // ── Render ────────────────────────────────────────────────

  const sidebarWidth = 220;

  return (
    <div style={{ height: '100dvh', display: 'flex', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 10 }}
        />
      )}

      {/* Sidebar */}
      <aside style={{
        width: sidebarWidth,
        flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0, left: 0, bottom: 0,
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform .2s ease',
        zIndex: 20,
      }}>
        {/* Logo */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', display: 'grid', placeItems: 'center' }}>
            <Icon d={Icons.zap} size={14} color="#fff" />
          </div>
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 800, fontSize: 16, letterSpacing: -0.5 }}>Agent</span>
          <button onClick={() => setSidebarOpen(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer' }}>
            <Icon d={Icons.x} />
          </button>
        </div>

        {/* Nav */}
        <nav style={{ padding: '12px 10px', flex: 1 }}>
          {([
            ['chat', Icons.chat, 'Chat'],
            ['logs', Icons.logs, 'Logs'],
            ['settings', Icons.settings, 'Settings'],
          ] as const).map(([t, icon, label]) => (
            <button key={t} onClick={() => { setTab(t); setSidebarOpen(false); }} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: '9px 12px', borderRadius: 8,
              background: tab === t ? 'var(--accent)' + '22' : 'transparent',
              border: tab === t ? `1px solid ${'' + 'var(--accent)' + '44'}` : '1px solid transparent',
              color: tab === t ? 'var(--accent2)' : 'var(--text2)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13,
              marginBottom: 2, textAlign: 'left',
            }}>
              <Icon d={icon} size={15} />
              {label}
            </button>
          ))}
        </nav>

        {/* Status */}
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: state.isProcessing ? 'var(--green)' : 'var(--border2)', flexShrink: 0, display: 'inline-block', boxShadow: state.isProcessing ? '0 0 6px var(--green)' : 'none' }} />
            <span style={{ color: state.isProcessing ? 'var(--green)' : 'var(--text2)' }}>
              {state.isProcessing ? `${state.currentProvider}/${state.currentModel?.split('/').pop() ?? ''}` : 'Idle'}
            </span>
          </div>
          {config.primaryModel && (
            <div style={{ color: 'var(--text2)', marginTop: 4, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {config.primaryModel.split('/').pop()}
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, marginLeft: 0 }}>

        {/* Top bar */}
        <header style={{
          height: 52, display: 'flex', alignItems: 'center', padding: '0 16px',
          borderBottom: '1px solid var(--border)', background: 'var(--surface)',
          gap: 12, flexShrink: 0,
        }}>
          <button onClick={() => setSidebarOpen(true)} style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', padding: 4, display: 'flex' }}>
            <Icon d={Icons.menu} />
          </button>
          <span style={{ fontWeight: 800, fontSize: 15, fontFamily: 'var(--font-sans)', letterSpacing: -0.3 }}>
            {tab === 'chat' ? 'Chat' : tab === 'logs' ? 'Logs' : 'Settings'}
          </span>

          {/* Chat tab controls */}
          {tab === 'chat' && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, color: 'var(--text2)', userSelect: 'none' }}>
                <input type="checkbox" checked={showThoughts} onChange={e => setShowThoughts(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                Thoughts
              </label>
              <button onClick={async () => { await api('/api/logs', { method: 'DELETE' }); setLogs([]); }} style={smallBtn} title="Limpiar chat visual">
                <Icon d={Icons.eye} size={13} /> Chat
              </button>
              <button onClick={async () => { await api('/api/history', { method: 'DELETE' }); await api('/api/logs', { method: 'DELETE' }); setLogs([]); }} style={{ ...smallBtn, color: 'var(--red)' }} title="Limpiar chat + contexto del modelo">
                <Icon d={Icons.trash} size={13} /> Todo
              </button>
            </div>
          )}
          {tab === 'logs' && (
            <button onClick={async () => { await api('/api/logs', { method: 'DELETE' }); setLogs([]); }} style={{ ...smallBtn, marginLeft: 'auto' }}>
              <Icon d={Icons.trash} size={13} /> Clear
            </button>
          )}
        </header>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

          {/* ── CHAT ── */}
          {tab === 'chat' && (
            <>
              <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflow: 'auto', padding: '16px 16px 8px' }}>
                {chatLogs.length === 0 ? (
                  <Empty icon={Icons.chat} text="Send a message to start" />
                ) : (
                  chatLogs.map(log => <LogCard key={log.id} log={log} />)
                )}
                {state.isProcessing && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text2)', padding: '6px 0', fontSize: 12 }}>
                    <Spinner /> Processing…
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div style={{ padding: '10px 16px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '8px 8px 8px 14px' }}>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Message the agent… (Enter to send, Shift+Enter for newline)"
                    rows={1}
                    style={{
                      flex: 1, background: 'none', border: 'none', outline: 'none',
                      color: 'var(--text)', fontFamily: 'var(--font-sans)', fontSize: 13.5,
                      resize: 'none', maxHeight: 120, lineHeight: 1.5,
                    }}
                    onInput={e => {
                      const el = e.currentTarget;
                      el.style.height = 'auto';
                      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                    }}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() || state.isProcessing}
                    style={{
                      width: 34, height: 34, borderRadius: 8, border: 'none',
                      background: !input.trim() || state.isProcessing ? 'var(--border)' : 'var(--accent)',
                      color: '#fff', cursor: !input.trim() || state.isProcessing ? 'default' : 'pointer',
                      display: 'grid', placeItems: 'center', flexShrink: 0, transition: 'background .15s',
                    }}
                  >
                    {state.isProcessing ? <Spinner /> : <Icon d={Icons.send} size={14} />}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── LOGS ── */}
          {tab === 'logs' && (
            <div style={{ flex: 1, overflow: 'auto', padding: 12, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {logs.length === 0 ? <Empty icon={Icons.terminal} text="No logs yet" /> : (
                logs.map(log => {
                  const s = logStyle(log.level);
                  return (
                    <div key={log.id} style={{ display: 'flex', gap: 10, padding: '3px 6px', borderRadius: 4, marginBottom: 1 }}>
                      <span style={{ color: 'var(--text2)', flexShrink: 0 }}>
                        {new Date(log.timestamp).toISOString().slice(11, 23)}
                      </span>
                      <span style={{ color: s.dot, flexShrink: 0, width: 90, fontWeight: 700 }}>
                        {log.level.toUpperCase()}
                      </span>
                      <span style={{ color: s.color, whiteSpace: 'pre-wrap', flex: 1, wordBreak: 'break-all' }}>
                        {log.message}
                        {log.data && (
                          <span style={{ color: 'var(--text2)', display: 'block', marginTop: 2 }}>
                            {typeof log.data === 'string' ? log.data : JSON.stringify(log.data).slice(0, 200)}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ── SETTINGS ── */}
          {tab === 'settings' && (
            <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
              <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>

                {/* Add provider */}
                <Section title="API Keys" icon={Icons.key}>
                  <p style={{ color: 'var(--text2)', fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
                    Add your Google AI or OpenRouter API key. Keys are detected automatically.
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <input
                        type={keyVisible ? 'text' : 'password'}
                        value={newKey}
                        onChange={e => setNewKey(e.target.value)}
                        placeholder="AIza... or sk-or-..."
                        onKeyDown={e => e.key === 'Enter' && addProvider()}
                        style={inputStyle}
                      />
                      <button onClick={() => setKeyVisible(v => !v)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer' }}>
                        <Icon d={keyVisible ? Icons.eyeoff : Icons.eye} size={14} />
                      </button>
                    </div>
                    <button onClick={addProvider} disabled={addingKey || !newKey.trim()} style={primaryBtn}>
                      {addingKey ? <Spinner /> : <Icon d={Icons.plus} size={14} />}
                      Add
                    </button>
                  </div>
                  {keyError && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{keyError}</div>}

                  {providers.length > 0 && (
                    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {providers.map(p => (
                        <div key={p.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent2)', textTransform: 'uppercase', letterSpacing: 1 }}>{p.type}</span>
                            <button onClick={() => removeProvider(p.id)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer' }}>
                              <Icon d={Icons.trash} size={13} />
                            </button>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {p.models.map(m => (
                              <button key={m} onClick={() => updateConfig({ primaryProvider: p.id, primaryModel: m })} style={{
                                padding: '3px 8px', borderRadius: 6, fontSize: 10, fontFamily: 'var(--font-mono)',
                                background: config.primaryProvider === p.id && config.primaryModel === m ? 'var(--accent)' : 'var(--surface)',
                                border: `1px solid ${config.primaryProvider === p.id && config.primaryModel === m ? 'var(--accent)' : 'var(--border)'}`,
                                color: config.primaryProvider === p.id && config.primaryModel === m ? '#fff' : 'var(--text2)',
                                cursor: 'pointer',
                              }}>
                                {m.split('/').pop()}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                {/* Agent config */}
                <Section title="Agent" icon={Icons.cpu}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div>
                      <label style={labelStyle}>Max Steps</label>
                      <input type="number" min={1} max={200} value={config.maxSteps}
                        onChange={e => updateConfig({ maxSteps: parseInt(e.target.value) || 50 })}
                        style={inputStyle} />
                      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>Tool-use iterations per message</div>
                    </div>
                    <div>
                      <label style={labelStyle}>Context Window (messages)</label>
                      <input type="number" min={10} max={200} value={config.maxContextMessages}
                        onChange={e => updateConfig({ maxContextMessages: parseInt(e.target.value) || 60 })}
                        style={inputStyle} />
                      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>Messages sent to the model</div>
                    </div>
                  </div>
                </Section>

              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────
const smallBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)',
  background: 'var(--surface2)', color: 'var(--text2)', cursor: 'pointer', fontSize: 12,
  fontFamily: 'var(--font-sans)',
};

const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 8, border: 'none',
  background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 13,
  fontFamily: 'var(--font-sans)', fontWeight: 600, flexShrink: 0,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  background: 'var(--surface2)', border: '1px solid var(--border)',
  color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12,
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text2)',
  textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6,
};

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Icon d={icon} size={15} color="var(--accent2)" />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 12, color: 'var(--text2)', opacity: 0.5 }}>
      <Icon d={icon} size={32} />
      <span style={{ fontSize: 13 }}>{text}</span>
    </div>
  );
}
