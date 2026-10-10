```sql
CREATE DATABASE movies_api;
```

```bash
cp .env.example .env
npm install
npm run dev
```

Set a long, random `JWT_SECRET` (at least 32 characters) and update the MySQL values in `.env`. Sequelize creates the `Users`, `Movies`, and `Messages` tables when the API starts. Existing movie routes are unchanged.

## Chat frontend

Use Node 22.12+ or Node 24 for the React/Vite frontend. Run the API above and, in a second terminal from the repository root:

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

Open http://localhost:5173. Register two accounts in separate browser profiles (or one normal window and one private window), then select the other person and send a message. Existing API accounts can sign in directly. Refresh the people list if an account was created after you signed in.

The frontend uses React, shadcn/ui, Tailwind CSS, and Socket.IO. JWTs are stored in sessionStorage; sign in again when the one-hour session expires. Enter sends a message; Shift + Enter inserts a new line. Messages are saved before delivery, and history is reloaded on reconnect. Earlier history loads in pages of 50. Text messages are limited to 2000 characters.

Vite proxies `/api` and `/socket.io` to http://localhost:3000, so no frontend environment file is needed locally. To use a different API port, set `API_PROXY_TARGET` in the terminal running Vite. The API's `FRONTEND_ORIGIN` defaults to http://localhost:5173.

### Build and hosting

```bash
npm --prefix frontend run build
```

Serve `frontend/dist` using your static host. For a shared origin, proxy `/api` and `/socket.io` to the API, including WebSocket upgrades. For separate origins, set `VITE_API_URL` to the API origin when building the frontend, and set `FRONTEND_ORIGIN` to the exact frontend origin on the API. Use HTTPS in production. The API remains API-only and does not serve the frontend build.

Chat currently runs on one API instance with Socket.IO's in-memory rooms and a per-socket limit of 30 send attempts per minute. Multiple API instances need a shared Socket.IO adapter and shared rate limiting.

### Checks

```bash
npm test
npm --prefix frontend run lint
npm --prefix frontend run build
```

The chat test uses real HTTP and Socket.IO clients with mocked database methods, covering authentication, participant isolation, saving before delivery, multiple tabs, offline history, pagination, validation, storage failures, rate limits, and session expiry. It does not require MySQL.

## Routes

| Method | Route | Body | Auth |
| --- | --- | --- | --- |
| `GET` | `/health` | — | No |
| `POST` | `/api/auth/register` | `{ "email": "you@example.com", "password": "password123" }` | No |
| `POST` | `/api/auth/login` | `{ "email": "you@example.com", "password": "password123" }` | No |
| `GET` | `/api/movies` | — | Bearer token |
| `GET` | `/api/movies/:id` | — | Bearer token |
| `POST` | `/api/movies` | `{ "title": "Alien" }` | Bearer token |
| `PUT` | `/api/movies/:id` | `{ "title": "Aliens" }` | Bearer token |
| `DELETE` | `/api/movies/:id` | — | Bearer token |
| `GET` | `/api/chat/me` | — | Bearer token |
| `GET` | `/api/chat/users` | — | Bearer token |
| `GET` | `/api/chat/messages/:userId?before=:messageId` | — | Bearer token |

Send protected requests with `Authorization: Bearer <token>`.

The user directory returns only IDs and emails, excluding the signed-in user. History only includes messages between the signed-in user and the requested user. `before` is optional; responses are `{ messages, nextCursor }`, ordered oldest to newest within each page.

## Socket.IO events

Connect to the API with `auth: { token }`. The server derives the sender from the verified JWT and joins a private room for that user. A client cannot choose its sender or join other users' rooms. Expired sessions are disconnected.

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', { auth: { token } });
socket.on('message:new', (message) => console.log(message));
const result = await socket.timeout(10000).emitWithAck('message:send', {
  recipientId: 2,
  body: 'Hello!',
});
// result is { message } on success, or { error } on validation/storage failure.
// message: { id, senderId, recipientId, body, createdAt }
```

`message:new` goes only to the sender and recipient, including their other connected tabs. Offline recipients retrieve saved messages from history. An acknowledgement timeout is ambiguous: check history before manually resending; the client does not automatically retry sends.
