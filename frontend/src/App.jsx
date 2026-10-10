import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ArrowLeft, ArrowUpRight, LogOut, MessageCircle, RefreshCw, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

const apiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const mergeMessages = (current, incoming) => [...new Map([...current, ...incoming].map((m) => [m.id, m])).values()].sort((a, b) => a.id - b.id);
const time = (date) => new Date(date).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
const errorMessages = {
  'Invalid email or password': 'Correo o contraseña incorrectos.',
  'Email is already registered': 'Este correo ya está registrado.',
  'A valid email and password of 8 to 128 characters are required': 'Ingresa un correo válido y una contraseña de 8 a 128 caracteres.',
  'Validation isEmail on email failed': 'Ingresa un correo válido.',
  'Authentication required': 'Inicia sesión para continuar.',
  'Invalid or expired token': 'Tu sesión expiró. Inicia sesión de nuevo.',
  'Account no longer exists': 'Esta cuenta ya no existe.',
  'User not found': 'No se encontró a la persona.',
  'Invalid user or message cursor': 'No se pudo cargar la conversación.',
  'Too many messages. Wait a minute.': 'Demasiados mensajes. Espera un minuto.',
  'Choose another user and enter 1 to 2000 characters.': 'Selecciona otra persona y escribe de 1 a 2000 caracteres.',
  'Session expired. Sign in again.': 'Tu sesión expiró. Inicia sesión de nuevo.',
  'Message could not be saved. Try again.': 'No se pudo guardar el mensaje. Inténtalo de nuevo.',
  'operation has timed out': 'No se confirmó la entrega. Revisa la conversación antes de enviar de nuevo.',
};
const errorText = (error) => errorMessages[error.message] || 'Ocurrió un error. Inténtalo de nuevo.';

async function request(path, token, options = {}) {
  const response = await fetch(`${apiUrl}/api/${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error);
    error.status = response.status;
    throw error;
  }
  return data;
}

function PersonAvatar({ email, className = '' }) {
  return <Avatar className={`person-avatar ${className}`}><AvatarFallback>{email.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>;
}

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('chat-token'));
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authBusy, setAuthBusy] = useState(false);
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [messages, setMessages] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const socketRef = useRef(null);
  const selectedRef = useRef(null);
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const scrollToBottom = useRef(true);
  const historyVersion = useRef(0);

  function selectPerson(person) {
    selectedRef.current = person?.id ?? null;
    historyVersion.current++;
    setSelected(person); setMessages([]); setCursor(null); setDraft(''); setError(''); setHistoryFailed(false); setLoading(Boolean(person));
  }

  function reloadHistory() {
    historyVersion.current++;
    setMessages([]); setCursor(null); setLoading(Boolean(selectedRef.current)); setHistoryFailed(false); setError('');
    setRefresh((n) => n + 1);
  }

  function logout() {
    socketRef.current?.disconnect();
    sessionStorage.removeItem('chat-token');
    setToken(null); setUser(null); setUsers([]); selectPerson(null); setConnected(false);
  }

  function handleError(err) {
    if (err.status === 401) logout();
    setError(errorText(err));
  }

  async function authenticate(event) {
    event.preventDefault();
    setAuthBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const data = await request(`auth/${authMode}`, null, { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
      sessionStorage.setItem('chat-token', data.token);
      setUser(data.user); setToken(data.token);
    } catch (err) { setError(errorText(err)); }
    finally { setAuthBusy(false); }
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([request('chat/me', token), request('chat/users', token)])
      .then(([me, people]) => { if (!cancelled) { setUser(me); setUsers(people); } })
      .catch((err) => { if (!cancelled) handleError(err); });
    const socket = io(apiUrl || undefined, { auth: { token }, autoConnect: false });
    socketRef.current = socket;
    socket.on('connect', () => { setConnected(true); reloadHistory(); });
    socket.on('disconnect', (reason) => {
      setConnected(false);
      if (reason === 'io server disconnect') { logout(); setError('Tu sesión expiró. Inicia sesión de nuevo.'); }
    });
    socket.on('connect_error', (err) => {
      setConnected(false);
      if (err.message === 'Invalid or expired token') { logout(); setError(errorText(err)); }
      else setError('No se pudo conectar. Inténtalo de nuevo.');
    });
    socket.on('message:new', (message) => {
      const peer = selectedRef.current;
      if (message.senderId === peer || message.recipientId === peer) {
        const area = scrollRef.current;
        scrollToBottom.current = message.senderId !== peer || !area || area.scrollHeight - area.scrollTop - area.clientHeight < 100;
        setMessages((current) => mergeMessages(current, [message]));
      }
    });
    socket.connect();
    return () => { cancelled = true; socket.removeAllListeners(); socket.disconnect(); socketRef.current = null; };
  }, [token]);

  useEffect(() => {
    if (!selected || !token) return;
    let cancelled = false;
    const version = historyVersion.current;
    request(`chat/messages/${selected.id}`, token)
      .then((data) => {
        if (cancelled || historyVersion.current !== version) return;
        scrollToBottom.current = true;
        setMessages((current) => mergeMessages(current, data.messages)); setCursor(data.nextCursor);
      })
      .catch((err) => { if (!cancelled && historyVersion.current === version) { setHistoryFailed(true); handleError(err); } })
      .finally(() => { if (!cancelled && historyVersion.current === version) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, token, refresh]);

  useEffect(() => {
    if (scrollToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function loadOlder() {
    const peer = selected.id;
    const version = historyVersion.current;
    const area = scrollRef.current;
    const height = area?.scrollHeight || 0;
    setLoading(true);
    try {
      const data = await request(`chat/messages/${peer}?before=${cursor}`, token);
      if (historyVersion.current !== version) return;
      scrollToBottom.current = false;
      setMessages((current) => mergeMessages(current, data.messages)); setCursor(data.nextCursor);
      requestAnimationFrame(() => { if (area) area.scrollTop += area.scrollHeight - height; });
    } catch (err) { if (historyVersion.current === version) handleError(err); }
    finally { if (historyVersion.current === version) setLoading(false); }
  }

  async function send(event) {
    event.preventDefault();
    if (!draft.trim() || !connected || sending) return;
    const recipientId = selected.id;
    setSending(true); setError('');
    try {
      const result = await socketRef.current.timeout(10000).emitWithAck('message:send', { recipientId, body: draft });
      if (result.error) throw new Error(result.error);
      if (selectedRef.current === recipientId) {
        scrollToBottom.current = true;
        setMessages((current) => mergeMessages(current, [result.message])); setDraft('');
      }
    } catch (err) {
      if (selectedRef.current === recipientId) setError(errorText(err));
    } finally { setSending(false); }
  }

  if (!token) return <main className="auth-page">
    <form onSubmit={authenticate} className="auth-form">
      <div className="brand"><MessageCircle /> POI <span> / chat</span></div>
      <h1>{authMode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h1>
      <label htmlFor="email">Correo electrónico</label><Input id="email" name="email" type="email" autoComplete="email" placeholder="tu@ejemplo.com" maxLength={254} required />
      <label htmlFor="password">Contraseña</label><Input id="password" name="password" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={authMode === 'register' ? 8 : undefined} maxLength={128} required />
      {error && <p className="error" role="alert">{error}</p>}
      <Button disabled={authBusy} className="auth-submit">{authBusy ? 'Espera…' : authMode === 'login' ? 'Entrar' : 'Crear cuenta'}</Button>
      <div className="switch-auth"><Button type="button" variant="link" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setError(''); }}>{authMode === 'login' ? 'Crear cuenta' : 'Iniciar sesión'}</Button></div>
    </form>
  </main>;

  const people = users.filter((person) => person.email.toLowerCase().includes(search.toLowerCase()));
  return <main className={`chat-shell ${selected ? 'has-selection' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><MessageCircle /> POI <span> / chat</span></div>
      <div className="sidebar-heading"><h1>Personas</h1><Button variant="ghost" size="icon" aria-label="Actualizar personas" title="Actualizar personas" onClick={() => request('chat/users', token).then(setUsers).catch(handleError)}><RefreshCw size={17} /></Button></div>
      <div className="search"><Search size={16} /><Input aria-label="Buscar persona" placeholder="Buscar persona…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <p className="list-label">INICIA UNA CONVERSACIÓN</p>
      <nav className="people" aria-label="Personas">{people.map((person) => <button key={person.id} className={`person ${selected?.id === person.id ? 'active' : ''}`} onClick={() => selectPerson(person)} aria-pressed={selected?.id === person.id}>
        <PersonAvatar email={person.email} /><span><strong>{person.email.split('@')[0]}</strong><small>{person.email}</small></span><ArrowUpRight size={16} />
      </button>)}{!people.length && <p className="muted empty-people">{users.length ? 'No se encontraron personas.' : 'Aún no hay otras cuentas. Registra una segunda cuenta para conversar.'}</p>}</nav>
      <div className="account">{user && <><PersonAvatar email={user.email} /><span><strong>{user.email.split('@')[0]}</strong><small>Tu cuenta</small></span></>}<Button variant="ghost" size="icon" aria-label="Cerrar sesión" onClick={logout}><LogOut size={18} /></Button></div>
    </aside>
    <section className="conversation" aria-label="Conversación">
      <header className="conversation-header"><div className="recipient">{selected ? <><Button className="back" variant="ghost" size="icon" aria-label="Volver a personas" onClick={() => selectPerson(null)}><ArrowLeft size={18} /></Button><PersonAvatar email={selected.email} /><div><h2>{selected.email.split('@')[0]}</h2><p>{selected.email}</p></div></> : <h2>Tus conversaciones</h2>}</div>
        <div className="connection"><span className={`connection ${connected ? 'connected' : ''}`} role="status"><i />{connected ? 'Conectado' : 'Desconectado'}</span>{!connected && <Button variant="ghost" size="icon" aria-label="Reintentar conexión" onClick={() => socketRef.current?.connect()}><RefreshCw size={15} /></Button>}</div>
      </header>
      {error && <div className="chat-error error" role="alert">{error}</div>}
      {selected ? <>
        <div className="message-list" ref={scrollRef} role="log" aria-label={`Mensajes con ${selected.email}`} aria-live="polite">
          {cursor && <Button variant="outline" size="sm" className="older" disabled={loading} onClick={loadOlder}>Cargar mensajes anteriores</Button>}
          {loading && <p className="message-status" role="status">Cargando mensajes…</p>}
          {historyFailed && <Button variant="outline" className="older" onClick={reloadHistory}>Reintentar carga de mensajes</Button>}
          {!loading && !historyFailed && !messages.length && <div className="conversation-start"><PersonAvatar email={selected.email} /><h3>Saluda a {selected.email.split('@')[0]}</h3><p>Aquí comienza su conversación.</p></div>}
          {messages.map((message, index) => <div key={message.id}>
            {(index === 0 || new Date(messages[index - 1].createdAt).toDateString() !== new Date(message.createdAt).toDateString()) && <p className="date-divider">{new Date(message.createdAt).toLocaleDateString('es-MX', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
            <div className={`message ${message.senderId === user?.id ? 'mine' : ''}`}><div className="bubble">{message.body}</div><time dateTime={message.createdAt}>{time(message.createdAt)}</time></div>
          </div>)}<div ref={bottomRef} />
        </div>
        <form className="composer" onSubmit={send}><label className="sr-only" htmlFor="message">Mensaje</label><Textarea id="message" placeholder={`Escribe a ${selected.email.split('@')[0]}…`} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} disabled={sending} rows={2} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }} /><Button type="submit" size="icon" aria-label="Enviar mensaje" disabled={!connected || !draft.trim() || sending}><Send size={18} /></Button><small>{sending ? 'Enviando…' : 'Enter para enviar · Shift + Enter para un salto de línea'}</small></form>
      </> : <div className="welcome"><div className="welcome-mark"><MessageCircle size={38} /></div><h2>Tus conversaciones</h2><p>Selecciona a una persona para empezar.</p></div>}
    </section>
  </main>;
}
