# Library Management System - Backend API

Express.js API server for the Des2 Library Management System. Provides RESTful endpoints for book management, user authentication, reviews, analytics, and AI recommendations.

![Node.js](https://img.shields.io/badge/Node.js-v18+-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-13+-blue)

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Available Scripts](#available-scripts)

---

## Features

- **Authentication** — JWT-based auth with Passport.js sessions
- **Book CRUD** — Full book management with PDF/image upload to GCS or Cloudinary
- **Reviews & Ratings** — User reviews with star ratings
- **User Management** — Profile, avatar upload, admin roles
- **Analytics Dashboard** — Real-time stats for admins
- **AI Recommendations** — Book suggestions via HuggingFace API
- **Chatbot** — Rule-based book finder assistant
- **Newsletter** — Email subscription system

---

## Tech Stack

- **Runtime:** Node.js (Express.js v5.1.0)
- **Database:** PostgreSQL (Supabase)
- **Authentication:** Passport.js + JSON Web Tokens
- **File Upload:** Multer (memory storage)
- **PDF Storage:** Google Cloud Storage (primary) / Cloudinary (fallback)
- **Image Storage:** Cloudinary
- **Email:** Resend / Gmail / SendGrid / Brevo
- **Logging:** Winston

---

## Quick Start

### Prerequisites
- Node.js v18+
- PostgreSQL database
- Cloudinary account
- Google Cloud Storage (optional)
- Email service account

### Installation

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✔ | PostgreSQL connection string |
| `SESSION_SECRET` | ✔ | Random string for sessions |
| `JWT_SECRET` | ✔ | Random string for JWT signing |
| `PORT` | - | Server port (default: 3000) |
| `BACKEND_URL` | ✔ | Your backend URL |
| `FRONTEND_URL` | ✔ | Your frontend URL (for CORS) |
| `ADMIN_USERNAME` | ✔ | Default admin username |
| `ADMIN_PASSWORD` | ✔ | Default admin password |
| `ADMIN_EMAIL` | ✔ | Default admin email |
| `CLOUDINARY_*` | ✔ | Cloudinary credentials |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | - | GCS service account JSON |
| `GOOGLE_STORAGE_BUCKET` | - | GCS bucket name |
| `RESEND_API_KEY` / `GMAIL_*` / etc. | ✔ | Email provider credentials |

### Run

```bash
npm run dev      # Development with nodemon
npm start        # Production
```

---

## API Reference

All endpoints relative to your backend URL. Protected routes accept `Authorization: Bearer <token>`.

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/register` | — | Create account |
| `POST` | `/login` | — | Login (returns JWT) |
| `POST` | `/logout` | — | End session |
| `GET` | `/verify-email` | — | Verify email token |
| `POST` | `/resend-verification` | — | Resend verification |
| `POST` | `/request-password-reset` | — | Request reset |
| `GET` | `/validate-reset-token/:token` | — | Validate token |
| `POST` | `/reset-password` | — | Set new password |
| `GET` | `/current-user` | User | Get user info |
| `GET` | `/checkAuthStatus` | — | Check auth |

### Books

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/books` | Optional | Search/list books |
| `GET` | `/books/:id` | — | Get single book |
| `POST` | `/books` | Admin | Create book (multipart) |
| `POST` | `/books/:id/like` | User | Like book |
| `POST` | `/books/:id/dislike` | User | Dislike book |

### Reviews

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/books/:bookId/reviews` | — | Get reviews |
| `POST` | `/books/:bookId/reviews` | User | Submit review |

### Users

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/users` | Admin | List users |
| `POST` | `/users/upload-profile-picture` | User | Upload avatar |
| `GET` | `/users/activity` | User | Get activity feed |
| `GET` | `/users/my-reviews` | User | Get own reviews |
| `POST` | `/users/:id/grant-admin` | Seed Admin | Grant admin |
| `POST` | `/users/:id/revoke-admin` | Seed Admin | Revoke admin |
| `DELETE` | `/users/:id` | Seed Admin | Delete user |

### Other

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/download/:bookId` | Get PDF URL |
| `GET` | `/recommendations` | AI book suggestions |
| `POST` | `/subscribe` | Newsletter signup |
| `POST` | `/api/chat` | Chatbot message (accepts JWT for personalized responses) |
| `POST` | `/api/chat/reset` | Reset chatbot session |
| `GET` | `/api/chat/health` | Chatbot health check |
| `GET` | `/health` | Health check |

### Chatbot Capabilities

The LibBot chatbot is a **context-aware assistant** built specifically for Des2 Library:

| Category | What it knows |
|---|---|
| **Books** | Real-time book counts, genre listings, searching by title/author/genre |
| **Account** | Login flow, registration, password reset, email verification |
| **Profile** | How to access/edit profile, favorites, password changes |
| **Downloads** | Download instructions with login context awareness |
| **Reviews** | Rating system (1-5 stars), review submission |
| **Recommendations** | Personalized book suggestions (requires login) |

The chatbot has security guardrails to prevent revealing credentials, environment variables, or admin backend details.

### Analytics (Admin)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/analytics/stats` | Overview stats |
| `GET` | `/analytics/popular-books` | Popular books |
| `GET` | `/analytics/genre-stats` | Genre distribution |
| `GET` | `/analytics/top-reviewers` | Top reviewers |

---

## Deployment

### Render

1. Create Web Service
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Add all environment variables
5. Set `NODE_ENV=production`

---

## Available Scripts

```bash
npm start                          # Production server
npm run dev                        # Development server
npm test                           # Run tests
npm run test:watch                 # Tests in watch mode
npm run test:connection            # Test DB connection
npm run diagnose                   # Connection diagnostics
npm run test-email your@email.com    # Test email
```

---

*Deployed automatically from this repository.