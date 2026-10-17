import {randomUUID} from 'crypto';
import {User} from './user.js';

export function attachVideoCall(io) {
    const endpoints = new Map();
    const calls = new Map();
    const busy = new Map();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const alive = (endpoint) => endpoint && io.sockets.sockets.get(endpoint)?.data.expiresAt > Date.now();

    function finishCall(call, reason) {
        if (!call || calls.get(call.id) !== call) return;

        calls.delete(call.id);
        clearTimeout(call.timeout);
        for(const person of [call.caller, call.recipient]) {
            if(busy.get(person.id) === call.id) busy.delete(person.id);

            io.to(person.socketId).emit('call-ended', {callId: call.id, reason});
        }
    }

    io.on('connection', (socket) => {
        const userId = socket.data.userId;
        let windowsStart = Date.now();
        let attempts = 0;

        function unready(peerId) {
            const endpoint = endpoints.get(userId);

            if(endpoint?.socketId !== peerId) return;

            endpoint.delete(userId);
            finishCall(calls.get(busy.get(userId)), 'peer-unready');
        }

        function handle(event,action){
            socket.on(event, async (payload,ack) => {
                if(typeof ack !== 'function') return;

                if(Date.now() >= socket.data.expiresAt) return ack({error: 'session-expired'});

                try{
                    ack(await action(payload));
                } catch (error) {
                    console.error(`Error handling ${event} for ${userId}:`, error);
                    ack({error: error.message});
                }
            });
        }

        function ownedCall(payload,recipientOnly = false) {
            const call = typeof payload?.callId === 'string' ? calls.get(payload.callId) : null;

            if(!call) return null;
            if(recipientOnly ? call.recipient.socketId !== socket.id : ![call.caller.socketId,call.recipient.socketId].includes(socket.id)) return null;
            return call;
        }

        handle('call-register', async () => {
            if(busy.has(userId)) return {error: 'user-busy'};

            const user = await User.findById(userId);

            if(!user || Date.now() >= socket.data.expiresAt) return {error: 'user-not-found'};

            if(busy.has(userId)) return {error: 'user-busy'};

            const existing = enpoints.get(userId);

            if(existing && alive(existing) && existing.socketId !== socket.id) {
                return {error: 'user-already-registered'};
            }

            unready();
            socket.data.callPeerId = randomUUID();
            socket.data.callEmail = user.email;
            return {peerId: socket.data.callPeerId}
        });

        handler('call:ready', async (payload) => {
            if(!socket.data.callPeerId || payload?.peerId !== socket.data.callPeerId) return {error: 'invalid-peer-id'};

            const existing = endypoints.get(userId);

            if(existing && alive(existing) && existing.socketId !== socket.id) {
                return {error: 'user-already-registered'};
            }

            endpoints.set(userId,{
                userId,
                socketId: socket.id,
                peerId: socket.data.callPeerId,
                email: socket.data.callEmail
            })

            return {ok: true};
        });

        handle('call:unready', async (payload) => {
            if(typeof payload?.peerId !== 'string') return {error: 'invalid-peer-id'};

            unready();
            return {ok: true};
        });

        handle('call:invite', async (payload) => {
            if(Date.now() - windowStart >= 60_000){
                windowSatart = Date.now();
                attempts = 0;
            }

            if(++attempts >= 5) return {error: 'too-many-attempts'};

            const {callId,recipientId} = payload || {};

            if(typeof callId !== 'string' ||
                 !uuid.test(callId) ||
                  !Number.isSafeInteger(recipientId) ||
                recipientId < 1 || recipientId === userId || calls.has(callId)
                ){
                     return {error: 'invalid-payload'};
                }

            const caller = endpoints.get(userId);
            const recipient = endpoints.get(recipientId);

            if(caller?.socketId !== socket.id || !alive(caller)) return {error: 'caller-not-registered'};
            if(!recipient || !alive(recipient)) return {error: 'recipient-not-registered'};
            if(busy.has(userId) || busy.has(recipientId)) return {error: 'user-busy'};

            const call = {
                id: callId,
                caller,
                recipient,
                status: 'ringing',
                connected: new Set()
            }

            calls.set(callId,call);
            busy.set(userId,callId);
            busy.set(recipientId,callId);

            call.timeout = setTimeout(() => {
                finishCall(call,'timeout');
            }, 30_000);
        });


        io.to(recipient.socketId).emit('call:incoming', {
            callId: call.id,
            caller: {
                id: userId,
                email: caller.email,
                peerId: caller.peerId
            }
        });

        return {ok: true};
    });

    handle('call:connected', async (payload) => {
        const call = ownedCall(payload,true);
        if(!call || call.status !== 'ringing') return {error: 'call-not-found'};

        call.connected.add(socket.id);
        if(call.connected.size === 2) {
            call.status = 'active';
            clearTimeout(call.timeout);
        }
    });

    handle('call:reject',async (payload) => {
        const call = ownedCall(payload,true);
        if(!call || call.status !== 'ringing') return {error: 'call-not-found'};

        finishCall(call,'rejected');
        return {ok: true};
    });

    handle('call:end', async (payload) => {
        const call = ownedCall(payload);
        if(!call) return {error: 'call-not-found'};
        finishCall(call,'ended');
        return {ok: true};
        
    });
    socket.on('disconnect', () => unready());
}