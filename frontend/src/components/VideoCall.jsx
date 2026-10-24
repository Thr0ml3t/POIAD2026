import { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import { Button } from '@/components/ui/button';

export default function VideoCall({ socket, selectedUser, onActiveChange }) {
  const [view, setView] = useState({ status: 'idle', ready: false, email: '', error: '' });
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [needsPlay, setNeedsPlay] = useState(false);
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const actions = useRef(null);

  useEffect(() => {
    onActiveChange(view.status !== 'idle');
    return () => onActiveChange(false);
  }, [view.status, onActiveChange]);

  useEffect(() => {
    if (localVideo.current) localVideo.current.srcObject = localStream;
    if (remoteVideo.current) {
      remoteVideo.current.srcObject = remoteStream;
      if (remoteStream) remoteVideo.current.play().catch(() => {
        if (remoteVideo.current?.srcObject === remoteStream) setNeedsPlay(true);
      });
    }
  }, [localStream, remoteStream]);

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let peer = null;
    let ready = false;
    let session = null;
    let media = null;
    let connection = null;
    let timer = null;
    const update = (values) => { if (!disposed) setView((current) => ({ ...current, ...values })); };

    async function request(event, payload = {}) {
      if (!socket.connected) throw new Error('No hay conexión.');
      let result;
      try { result = await socket.timeout(5000).emitWithAck(event, payload); }
      catch { throw new Error('No se confirmó la solicitud. Inténtalo de nuevo.'); }
      if (result.error) throw new Error(result.error);
      return result;
    }

    function finish(reason = '', notify = true) {
      const previous = session;
      session = null;
      clearTimeout(timer);
      timer = null;
      const previousConnection = connection;
      connection = null;
      previousConnection?.removeAllListeners();
      previousConnection?.close();
      media?.getTracks().forEach((track) => track.stop());
      media = null;
      if (previous && notify && socket.connected) socket.emit('call:end', { callId: previous.id });
      if (!disposed) { setLocalStream(null); setRemoteStream(null); setNeedsPlay(false); }
      update({ status: 'idle', email: '', error: reason });
    }

    function waitFor(current, message) {
      clearTimeout(timer);
      timer = setTimeout(() => { if (session === current) finish(message); }, 35_000);
    }

    async function getMedia(current) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (disposed || session !== current) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }
      media = stream;
      setLocalStream(stream);
      return stream;
    }

    function fail(current, error) {
      if (session !== current) return;
      const message = error.name === 'NotAllowedError' ? 'Permite el acceso a la cámara y al micrófono.' :
        error.name === 'NotFoundError' ? 'No se encontró una cámara o un micrófono.' :
        error.name === 'NotReadableError' ? 'La cámara o el micrófono están en uso.' :
        error.name === 'TypeError' ? 'No se pudo abrir la cámara. Usa localhost o HTTPS.' : error.message;
      finish(message);
    }

    function bind(current, incomingConnection) {
      if (!incomingConnection) throw new Error('No se pudo iniciar la llamada.');
      connection = incomingConnection;
      waitFor(current, 'No se pudo conectar la llamada.');
      connection.on('stream', (stream) => {
        if (session !== current || connection !== incomingConnection) return;
        clearTimeout(timer);
        setRemoteStream(stream);
        update({ status: 'active' });
        request('call:connected', { callId: current.id }).catch((error) => fail(current, error));
      });
      connection.on('close', () => { if (session === current) finish('La llamada terminó.'); });
      connection.on('error', () => { if (session === current) finish('No se pudo conectar la llamada.'); });
    }

    function disposePeer() {
      ready = false;
      const previous = peer;
      peer = null;
      finish();
      if (previous) {
        if (socket.connected && previous.id) socket.emit('call:unready', { peerId: previous.id });
        previous.removeAllListeners();
        previous.destroy();
      }
      update({ ready: false });
    }

    async function boot() {
      const currentGeneration = ++generation;
      disposePeer();
      try {
        const { peerId } = await request('call:register');
        if (disposed || currentGeneration !== generation) return;
        const instance = new Peer(peerId);
        peer = instance;
        instance.on('open', async () => {
          try {
            await request('call:ready', { peerId });
            if (disposed || peer !== instance) return;
            ready = true;
            update({ ready: true, error: '' });
          } catch (error) {
            if (peer === instance) { disposePeer(); update({ error: error.message }); }
          }
        });
        instance.on('call', (incomingConnection) => {
          const current = session;
          if (!current || current.role !== 'recipient' || !current.accepted || !media || connection ||
              incomingConnection.peer !== current.remotePeerId || incomingConnection.metadata?.callId !== current.id) {
            incomingConnection.close();
            return;
          }
          try { bind(current, incomingConnection); incomingConnection.answer(media); }
          catch { if (session === current) finish('No se pudo conectar la llamada.'); }
        });
        const unavailable = () => {
          if (peer !== instance) return;
          ++generation;
          disposePeer();
          update({ error: 'Las llamadas no están disponibles. Reintenta la conexión.' });
        };
        instance.on('error', unavailable);
        instance.on('disconnected', unavailable);
        instance.on('close', unavailable);
      } catch (error) {
        if (!disposed && currentGeneration === generation) update({ error: error.message });
      }
    }

    function incoming(payload) {
      if (!ready || session) { socket.emit('call:reject', { callId: payload.callId }); return; }
      session = { id: payload.callId, role: 'recipient', remotePeerId: payload.callerPeerId, accepted: false };
      update({ status: 'incoming', email: payload.caller.email, error: '' });
      waitFor(session, 'La llamada ya no está disponible.');
    }

    function accepted(payload) {
      const current = session;
      if (!current || current.id !== payload.callId || current.role !== 'caller' || connection || !media) return;
      current.remotePeerId = payload.recipientPeerId;
      update({ status: 'connecting' });
      try { bind(current, peer.call(current.remotePeerId, media, { metadata: { callId: current.id } })); }
      catch { finish('No se pudo conectar la llamada.'); }
    }

    function ended(payload) { if (session?.id === payload.callId) finish(payload.reason, false); }
    function disconnected() { ++generation; disposePeer(); }

    actions.current = {
      retry: boot,
      end: () => finish(),
      reject: () => {
        if (session) socket.emit('call:reject', { callId: session.id });
        finish('', false);
      },
      start: async (person) => {
        if (!person || !ready || session || !socket.connected) return;
        const current = { id: crypto.randomUUID(), role: 'caller' };
        session = current;
        update({ status: 'ringing', email: person.email, error: '' });
        try {
          if (!(await getMedia(current))) return;
          waitFor(current, 'La persona no respondió.');
          await request('call:invite', { callId: current.id, recipientId: person.id });
        } catch (error) { fail(current, error); }
      },
      accept: async () => {
        const current = session;
        if (!current || current.role !== 'recipient' || current.accepted) return;
        current.accepted = true;
        update({ status: 'connecting' });
        try {
          if (!(await getMedia(current))) return;
          waitFor(current, 'No se pudo conectar la llamada.');
          await request('call:accept', { callId: current.id });
        } catch (error) { fail(current, error); }
      },
    };
    socket.on('connect', boot);
    socket.on('disconnect', disconnected);
    socket.on('call:incoming', incoming);
    socket.on('call:accepted', accepted);
    socket.on('call:ended', ended);
    if (socket.connected) boot();
    return () => {
      disposed = true;
      ++generation;
      disposePeer();
      actions.current = null;
      socket.off('connect', boot);
      socket.off('disconnect', disconnected);
      socket.off('call:incoming', incoming);
      socket.off('call:accepted', accepted);
      socket.off('call:ended', ended);
    };
  }, [socket]);

  const labels = { ringing: 'Llamando…', incoming: 'Llamada entrante', connecting: 'Conectando…', active: 'En llamada' };
  return <section className="video-call" aria-label="Videollamada">
    {view.error && <p className="error" role="alert">{view.error}</p>}
    <div className="call-controls">
      {view.status === 'idle' ? <>
        <Button size="sm" disabled={!selectedUser || !view.ready} onClick={() => actions.current?.start(selectedUser)}>Videollamar</Button>
        {!view.ready && <Button variant="outline" size="sm" onClick={() => actions.current?.retry()}>Reintentar llamadas</Button>}
      </> : <>
        <p role="status">{labels[view.status]} · {view.email}</p>
        {view.status === 'incoming' && <Button size="sm" onClick={() => actions.current?.accept()}>Aceptar</Button>}
        <Button variant="destructive" size="sm" onClick={() => view.status === 'incoming' ? actions.current?.reject() : actions.current?.end()}>{view.status === 'incoming' ? 'Rechazar' : 'Colgar'}</Button>
      </>}
    </div>
    {(localStream || remoteStream) && <div className="call-videos">
      <video ref={remoteVideo} autoPlay playsInline aria-label="Video remoto" />
      <video ref={localVideo} autoPlay playsInline muted aria-label="Tu video" />
    </div>}
    {needsPlay && <Button size="sm" onClick={async () => {
      try { await remoteVideo.current?.play(); setNeedsPlay(false); }
      catch { setView((current) => ({ ...current, error: 'No se pudo reproducir el video.' })); }
    }}>Reproducir</Button>}
  </section>;
}
