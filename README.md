# Sweety — Personal Diabetes Management Platform

A full-stack glucose and wellness tracker built for the Kenpath Junior Full Stack Developer assignment. Sweety includes account authentication, per-user glucose records, reporting, lifestyle journaling, a health timeline, medication reminders, OCR-assisted entry, multilingual navigation, privacy controls, exports, Mochi the optional AI companion, and private doctor appointment requests.

> **Important health disclaimer:** Sweety is a personal record-keeping and data-explanation tool. It is not a medical device, does not diagnose, and does not recommend treatment or medication changes. Users should discuss clinical interpretation with their healthcare professional. OCR suggestions must be checked against the original meter before saving.

## Tech stack

- React 18 + Vite, responsive CSS, Recharts, Lucide icons
- Node.js + Express REST API
- PostgreSQL 16 + Prisma ORM
- bcrypt password hashing, JWT authentication, Zod validation
- Tesseract.js OCR (browser-side), jsPDF, CSV/JSON export
- Optional OpenAI-compatible assistant (disabled unless an API key is configured)

## Requirements

- Node.js 20 or newer
- Docker Desktop (recommended for local PostgreSQL) or a PostgreSQL 14+ instance
- npm

## Run locally on macOS

1. Unzip the project and open Terminal in the `sweety` folder.
2. Install dependencies:

   ```bash
   npm install
   npm --prefix server install
   npm --prefix client install
   ```

3. Create your local environment file:

   ```bash
   cp .env.example server/.env
   ```

   The server loads `server/.env`; the example database URL and Docker credentials are preconfigured. Change `JWT_SECRET` to a long random value before using real data.

4. Start PostgreSQL:

   ```bash
   docker compose up -d db
   ```

5. Create the database tables and demo data:

   ```bash
   npm run db:push
   npm run db:seed
   ```

6. Start the frontend and backend:

   ```bash
   npm run dev
   ```

7. Open **http://localhost:5173**. The API health endpoint is **http://localhost:4000/api/health**.

### Demo account

- Email: `demo@sweety.health`
- Password: `SweetyDemo123!`

Or register a new account. Demo readings are synthetic sample data and are not medical guidance.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret used to sign session tokens |
| `PORT` | API port (default 4000) |
| `CLIENT_ORIGIN` | Allowed frontend origin |
| `OPENAI_API_KEY` | Optional key to enable AI explanations |
| `OPENAI_MODEL` | Optional model name (default `gpt-4o-mini`) |

Never commit `.env` or real credentials.

## Features

### Assignment requirements

- Sign up and log in; bcrypt-hashed passwords; JWT-protected routes.
- User-scoped glucose readings with create, list, edit and delete.
- Four supported slots: Morning (fasting), After breakfast, After lunch and After dinner.
- Validation: integer value from 40 to 600 mg/dL, no future dates, no duplicate slot per day, maximum four readings per day.
- Daily, month-to-date and previous-month reports with count, highest, lowest, average (one decimal) and daily reading details.
- PostgreSQL unique constraint on `(userId, date, slot)` and index on `(userId, date)`.

### Additional features

- Dashboard with monthly average chart and descriptive statistical insights.
- Pagination and filtering support on `GET /api/readings?page=1&limit=20&from=YYYY-MM-DD&to=YYYY-MM-DD&slot=MORNING`.
- Lifestyle journal for meals, activity, sleep and notes; combined health timeline.
- Medication schedule records and browser notification reminders while the app is open. Browser permission is required; this is not a background/push notification service.
- OCR-assisted glucose value suggestion from an uploaded image using Tesseract.js. The candidate is never saved automatically and must be verified by the user.
- English, Telugu and Hindi navigation labels.
- Consistency calendar and engagement milestones (tracking consistency is a data-completeness indicator, not a health score).
- CSV readings export, printable/downloadable PDF report and JSON personal-data export.
- Privacy controls to export data or delete the account and associated records.
- Optional AI assistant. Without an API key, the app still works and returns a local data summary. The AI is constrained to explaining app data, not medical advice.

## API overview

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Current user |
| PATCH | `/api/auth/profile` | Update name/language |
| GET/POST | `/api/readings` | List/create readings |
| GET/PUT/DELETE | `/api/readings/:id` | Read/update/delete a reading |
| GET | `/api/reports/daily` | Daily report |
| GET | `/api/reports/month-to-date` | Month-to-date report |
| GET | `/api/reports/monthly` | Previous-month report |
| GET | `/api/reports/insights` | Descriptive statistics |
| GET/POST | `/api/lifestyle` | List/create journal entries |
| GET | `/api/timeline` | Combined timeline |
| GET/POST | `/api/medications` | List/create medications |
| GET/POST/DELETE | `/api/appointments` | Create/list/cancel private appointment requests |
| GET | `/api/privacy/export` | Export account data |
| DELETE | `/api/privacy/account` | Delete account and associated data |
| POST | `/api/assistant` | Optional data explainer |

All endpoints except health and authentication require `Authorization: Bearer <token>`.

## Tests

Run:

```bash
npm test
```

The included lightweight Node test suite checks glucose range invariants. Before production use, expand it into integration tests for authentication, per-user access control, duplicate-slot race conditions, report date boundaries and all validation rules.

## Assumptions and known limitations

- Dates are stored as PostgreSQL `DATE` values and interpreted as calendar dates; the app currently uses the browser's local date for display and UTC date strings for API boundaries.
- Medication reminders are browser notifications while the app is open. Reliable background reminders require a service worker/push provider and explicit notification infrastructure.
- OCR is best-effort. Image layouts vary; every candidate value must be verified before saving.
- The AI assistant is optional and should not receive unnecessary personal information. Do not add real patient data to a third-party AI service without appropriate consent and compliance review.
- PDF reports are generated client-side from the selected report. The user should review the report before sharing it with a clinician.
- This is an assessment/demo project, not a HIPAA-certified or production clinical system. Production deployment needs security review, stronger session handling (prefer secure HttpOnly cookies), audit logging, backups, monitoring, consent workflows and a clinical/privacy compliance assessment.

## Suggested next improvements

- Add integration tests using a disposable PostgreSQL database and Supertest.
- Add transactional handling for concurrent reading creation and explicit API error codes.
- Add a server-side PDF report endpoint and signed, expiring share links.
- Add background medication reminders through a service worker and push subscription.
- Add clinician-approved configurable reference ranges only if the product scope and clinical review support them.
- Add accessibility testing, end-to-end tests and deployment automation.

## Sweety Complete UI update

The current UI uses a shared responsive design system across the dashboard, glucose tracker, reports, lifestyle journal, timeline, medication centre, Mochi assistant, care-team requests, privacy centre and settings. Light and midnight-navy dark themes are available from the top bar and the selected theme is remembered in the browser. Mochi is a small CSS-drawn companion so the UI does not depend on an external mascot image asset.

### Care-team appointment requests

The **Contact care team** page lets a patient enter their own clinician/clinic contact details, choose a phone consultation or clinic visit, select a preferred date and time, and submit a private appointment request with a reason. Requests are stored against the authenticated user and displayed with a `PENDING` status. The app does not claim that an appointment is confirmed, does not invent doctor availability, and does not place calls or send email. Use the displayed `tel:` / `mailto:` links to contact the clinic directly. The patient can share reports separately when they choose.

The appointment request table is part of the Prisma schema. After updating an existing local database, run:

```bash
npm run db:push
```

The privacy JSON export includes appointment requests. Deleting a user cascades to their appointment requests.

### Design and safety notes

- Mochi can summarize user-entered records and explain application reports. It is not a doctor and must not diagnose, prescribe, recommend medication changes, or label readings as safe/unsafe.
- AI chat requires `OPENAI_API_KEY`; all non-AI application features work without it.
- OCR results are suggestions only. The patient must verify the value against the meter before saving.
- Browser medication reminders require the app to be open and notification permission to be granted.
- Appointment requests are not an emergency service. Contact the patient's clinic or local emergency service directly when urgent help is needed.

## Free local AI for Mochi (no API key)

Mochi can use Ollama locally. Install Ollama for macOS from https://ollama.com/download, open the Ollama app, then run:

```bash
ollama pull qwen3:4b
ollama run qwen3:4b
```

The first command downloads the model (about 2.6 GB); this is a one-time download. Qwen3 supports 100+ languages and the listed Qwen3 4B quantized model is published under Apache 2.0. Quit the interactive chat with `/bye` after the model has downloaded. Keep the Ollama app running. In `server/.env`, set:

```env
AI_PROVIDER="ollama"
OLLAMA_BASE_URL="http://127.0.0.1:11434"
OLLAMA_MODEL="qwen3:4b"
```

Restart Sweety with `npm run dev`. The browser chat calls the authenticated Sweety backend; the backend calls Ollama on this Mac. No paid API key is needed. The model runs locally; do not expose port 11434 to the public internet. Model downloads require internet and use disk space. Response speed depends on Mac hardware and available memory.

Mochi is a health-data explainer, not a clinician. It must not diagnose, recommend treatment, or advise medication changes.


## Patient and doctor workspaces (extended demo)

Sweety now supports separate `PATIENT` and `DOCTOR` roles. Existing accounts are migrated as `PATIENT` by the Prisma default, so the original patient workflow and records are retained. Doctor registration creates a doctor profile in an unverified state; only profiles marked `verified=true` appear in the patient doctor directory. This prototype intentionally does not let users self-verify clinical credentials. For a local demo, the seed creates a verified clinician account.

### Demo accounts

- Patient: `demo@sweety.health` / `SweetyDemo123!`
- Doctor: `doctor@sweety.health` / `SweetyDoctor123!`

Run `npm run db:push` and `npm run db:seed` after updating the project. The seed refreshes the demo patient's sample glucose readings; do not run it against a database containing data you need to preserve without first taking a backup. The schema migration itself is additive and does not delete existing patient readings, lifestyle entries, medications, or appointment requests.

### Doctor workflow

- Patients can browse verified doctor profiles, request a connection, and request phone, clinic, or online appointments with a linked doctor account.
- Doctors can review incoming appointment requests and confirm or decline them. Confirming an online appointment creates a random Jitsi demo room URL.
- Doctors can accept or decline patient connection requests. Only an accepted connection allows a doctor to retrieve the patient's glucose readings and lifestyle entries or exchange secure in-app messages.
- Doctors can add consultation notes linked to an appointment; notes are visible to the patient.
- Patient and doctor APIs enforce their respective account roles. A doctor cannot use patient reading CRUD endpoints.

### Consultation and verification limitations

This is an educational prototype, not a production telehealth service. The Jitsi room URL is a demo integration and is not an authenticated clinical video platform. Before real patient use, integrate a provider with authenticated meeting tokens, waiting rooms and access controls; add verified clinician credential review, availability/conflict checking, notification delivery, audit logging, data-retention policies, encryption/key management, legal/privacy review, and appropriate clinical governance. No consultation is recorded by Sweety.

### Mochi hybrid assistant

Mochi uses a deterministic private data engine for questions about readings, matching-date comparisons, recorded patterns, seven-day summaries, medication reminders, appointments and doctor-ready factual summaries. These calculations are performed in the backend against the signed-in patient's records. Personal health records are not sent to hosted LLM providers. If Ollama is unavailable, the deterministic engine and built-in product guide still work.

Optional OpenRouter support is available for general Sweety how-to questions only. Configure `AI_PROVIDER="openrouter"`, `OPENROUTER_API_KEY`, and optionally `OPENROUTER_MODEL="openrouter/free"` in `server/.env`. OpenRouter free models are rate-limited and availability can vary; they are not required for data questions. Never include identifiable health information in third-party model prompts.

### New environment variables

See `.env.example` for `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. Keep all secrets in `server/.env`; never commit that file.
