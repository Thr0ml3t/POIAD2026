```sql
CREATE DATABASE movies_api;
```

```bash
cp .env.example .env
npm install
npm run dev
```

Set a long, random `JWT_SECRET` and update the MySQL values in `.env`. Sequelize creates the `Users` and `Movies` tables when the API starts.

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

Send protected requests with `Authorization: Bearer <token>`.
