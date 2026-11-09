# Sweety — Blood Glucose & Personal Health Tracker

A full-stack health-record application built for the **Kenpath Junior Full Stack Developer – JavaScript & AI** take-home assignment.

Sweety helps a patient record daily blood glucose readings, review trends and reports, and keep related wellness information in one place. The original assignment scope is implemented alongside several additional patient-support features.

> **Health disclaimer:** Sweety is a personal record-keeping and data-visualisation tool. It is not a medical device, does not diagnose conditions, and does not recommend treatment or medication changes. Users should consult a qualified healthcare professional for medical interpretation. OCR suggestions must be checked against the original meter before saving.

## Contents

- [Assignment scope](#assignment-scope)
- [Features](#features)
- [Technology stack](#technology-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database and demo data](#database-and-demo-data)
- [Running the application](#running-the-application)
- [Tests and build](#tests-and-build)
- [API overview](#api-overview)
- [Development log](#development-log)
- [Assumptions and implementation notes](#assumptions-and-implementation-notes)
- [Known limitations](#known-limitations)
- [Future improvements](#future-improvements)
- [Security and privacy](#security-and-privacy)

## Assignment scope

The Kenpath assignment asks for a React frontend, a Node.js/Express API, and PostgreSQL persistence for a patient glucose tracker.

| Required item | Implementation |
|---|---|
| Sign up and log in | Implemented with bcrypt password hashing and JWT-protected API routes |
| User-specific readings | Reading queries and mutations are scoped to the authenticated user |
| Add, view, edit and delete readings | Implemented |
| Four daily time slots | Morning (fasting), After breakfast, After lunch, After dinner |
| Reading validation | Whole-number values from 40–600 mg/dL, no future dates, one reading per slot per day, and a maximum of four readings per day |
| Daily report | Selected date, summary statistics, and individual readings |
| Month-to-date report | First day of selected month through selected date |
| Previous-month report | Full previous calendar month |
| Empty report state | Friendly empty state when no readings exist |

The database also enforces a unique constraint on `(userId, date, slot)` so duplicate readings for a slot cannot be inserted for the same patient and date.

## Features

### Core glucose tracking

- Patient registration and login.
- Create, view, update and delete glucose readings.
- Four defined daily reading slots.
- Clear validation feedback for missing, out-of-range, decimal, duplicate-slot and future-date input.
- Daily, month-to-date and previous-month reports.
- Report statistics: highest, lowest, average (rounded to one decimal place), and reading count.
- Daily report includes the readings and their time slots.
- Monthly trend visualisation and dashboard summaries.
- Reading list pagination and filtering by date range and slot.

### Additional patient features

- **Lifestyle journal:** log meals, activity, sleep and notes.
- **Health timeline:** view health-related entries together.
- **Medication centre:** maintain medication records and active/inactive status.
- **Daily dose tracker:** configure prescription-based dose slots with a label, time and quantity; mark each dose as Taken or Not taken; leave unmarked doses as Not recorded.
- **Dose history:** review recorded dose statuses by date.
- **Medication reminders:** browser notifications while the application is open and notification permission has been granted.
- **OCR-assisted entry:** use Tesseract.js to suggest a glucose value from an uploaded meter image. The user must verify the value; OCR does not save a reading automatically.
- **Charts and insights:** visual summaries of recorded readings.
- **Exports:** CSV readings export, printable/downloadable PDF report, and JSON personal-data export.
- **Privacy controls:** export personal data or request account deletion.
- **Language support:** English, Telugu and Hindi interface labels.
- **Optional assistant:** a data-explanation assistant with a local-data fallback; hosted AI configuration is optional.

### Doctor and care-team extensions

- Patient and doctor account roles.
- Doctor profiles and patient–doctor connection workflow.
- Appointment requests and doctor-facing appointment workflows.
- Consultation notes and patient/doctor messaging for connected users.
- Lightweight online-presence indicators for the messaging experience.

These are extensions beyond the required glucose-tracker scope. Presence is held in application memory and is not a durable activity history.

## Technology stack

| Layer | Technologies |
|---|---|
| Frontend | React 18, Vite, JavaScript, CSS |
| Charts and icons | Recharts, Lucide React |
| Backend | Node.js, Express |
| Database | PostgreSQL 16 |
| ORM | Prisma |
| Authentication | bcryptjs, JSON Web Tokens |
| Validation | Zod |
| Security and middleware | Helmet, CORS, express-rate-limit, Morgan |
| OCR | Tesseract.js |
| Reports and exports | jsPDF, browser print, CSV/JSON export |
| Local database environment | Docker Compose |
| Optional AI | Ollama local model; optional OpenRouter/OpenAI-compatible configuration |

## Project structure

```text
sweety/
├── client/
│   ├── index.html
│   ├── package.json
│   └── src/
│       ├── api.js
│       ├── main.jsx
│       └── style.css
├── server/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.js
│   │   └── create-admin.js
│   ├── src/
│   │   ├── app.js
│   │   ├── auth.js
│   │   ├── db.js
│   │   ├── index.js
│   │   └── validators.js
│   ├── tests/
│   │   └── validation.test.js
│   └── package.json
├── .env.example
├── docker-compose.yml
├── package.json
└── README.md
```

## Getting started

### Prerequisites

- Node.js 20 or newer
- npm
- Docker Desktop (for the included PostgreSQL service), or a compatible PostgreSQL instance

### 1. Clone the repository

```bash
git clone https://github.com/abhigna17/sweety.git
cd sweety
```

### 2. Install dependencies

```bash
npm install
npm --prefix server install
npm --prefix client install
```

### 3. Configure the backend environment

```bash
cp .env.example server/.env
```

Update `JWT_SECRET` with a long, random secret before using the application beyond local evaluation. The backend loads its environment from `server/.env`.

### 4. Start PostgreSQL

With Docker Desktop running:

```bash
docker compose up -d db
```

Check that the database container is healthy:

```bash
docker compose ps
```

If you use your own PostgreSQL server instead, update `DATABASE_URL` in `server/.env` to point to that database.

### 5. Apply the Prisma schema

```bash
npm run db:push
```

This synchronises the Prisma schema with the configured development database. Review schema changes and back up any database containing data before applying changes.

### 6. (Optional) Create demo data

```bash
npm run db:seed
```

**Important seed-script behaviour:** the current seed script upserts the demo patient and then deletes and recreates that demo patient's glucose readings. Run it only against a disposable/fresh development database or when you intentionally want to reset the demo patient's sample readings. Do not run it against a database containing records you need to preserve. It also creates/upserts a demo doctor account.

### 7. Start the application

Run both services together:

```bash
npm run dev
```

Or run them in separate terminals:

```bash
# Terminal 1 — API
npm run dev:server
```

```bash
# Terminal 2 — React/Vite client
npm run dev:client
```

Open the frontend at:

- **Web app:** http://localhost:5173
- **API health check:** http://localhost:4000/api/health

## Environment variables

All variables are listed in `.env.example`. Configure them in `server/.env`.

| Variable | Required | Description |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret used to sign authentication tokens |
| `PORT` | No | API port; defaults to `4000` |
| `CLIENT_ORIGIN` | No | Allowed frontend origin; defaults to `http://localhost:5173` |
| `AI_PROVIDER` | No | AI provider selection; local Ollama is the intended default |
| `OLLAMA_BASE_URL` | No | Local Ollama endpoint |
| `OLLAMA_MODEL` | No | Local model name; example: `qwen3:4b` |
| `OPENROUTER_API_KEY` | No | Optional key for hosted OpenRouter models |
| `OPENROUTER_MODEL` | No | Optional OpenRouter model name |
| `OPENAI_API_KEY` | No | Optional hosted OpenAI-compatible provider key |
| `OPENAI_MODEL` | No | Optional hosted model name |

The core tracker does not require a hosted AI API key. Never commit `server/.env`, API keys, JWT secrets, database dumps, or real patient records.

## Database and demo data

PostgreSQL is the source of truth for user accounts, readings, lifestyle entries, medication records, appointments and care-team records. Prisma defines the schema and generates the database client.

The glucose `Reading` model stores:

- Patient/user ID
- Date
- Reading slot
- Integer glucose value in mg/dL
- Optional note
- Creation and update timestamps

The unique `(userId, date, slot)` constraint prevents duplicate slot entries for a patient on a date.

The dose tracker uses separate medication dose schedule and dose-log records. Each scheduled dose can have a date-specific status. An unmarked dose remains **Not recorded**; the application does not silently classify an unmarked dose as missed.

### Demo accounts

The seed script prints the demo credentials when it completes:

- Patient: `demo@sweety.health`
- Password: `SweetyDemo123!`
- Doctor: `doctor@sweety.health`
- Password: `SweetyDoctor123!`

These are development-only credentials. Change or remove demo accounts before any public deployment. Demo readings are synthetic sample data, not medical guidance.

## Running the application

### Useful commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start frontend and backend together |
| `npm run dev:server` | Start Express API |
| `npm run dev:client` | Start Vite frontend |
| `npm run build` | Create the frontend production build |
| `npm test` | Run backend automated tests |
| `npm run db:push` | Apply Prisma schema to the configured database |
| `npm run db:seed` | Create/reset demo seed data (see warning above) |

## Tests and build

Run backend tests:

```bash
npm test
```

The validation test suite covers valid whole-number readings, missing values, values outside the allowed 40–600 mg/dL range, and decimal values.

Build the frontend:

```bash
npm run build
```

During development, the recorded verification run completed with:

- Backend tests: **4 passed, 0 failed**.
- Frontend production build: **successful**.
- Vite emitted a bundle-size warning for a JavaScript chunk larger than 500 kB. Code splitting and bundle optimisation remain improvement areas.

These results describe the recorded development run; rerun both commands after making changes.

## API overview

The API is served from `http://localhost:4000`. Protected routes require a valid authenticated session.

| Area | Example endpoints | Purpose |
|---|---|---|
| Health | `GET /api/health` | API health check |
| Authentication | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | Register, login and current user |
| Profile | `PATCH /api/auth/profile` | Update profile/language |
| Readings | `GET/POST /api/readings`, `GET/PUT/DELETE /api/readings/:id` | Reading CRUD |
| Reports | `GET /api/reports/daily`, `/api/reports/month-to-date`, `/api/reports/monthly` | Glucose reports |
| Insights | `GET /api/reports/insights` | Descriptive reading insights |
| Lifestyle | `GET/POST /api/lifestyle` | Lifestyle journal |
| Timeline | `GET /api/timeline` | Combined health timeline |
| Medication | `GET/POST /api/medications`, `PATCH/DELETE /api/medications/:id` | Medication records |
| Dose tracker | `GET /api/medication-doses`, `POST /api/medications/:id/doses`, `PUT /api/medication-doses/:id/log` | Dose schedules and date-specific logs |
| Dose history | `GET /api/medication-history` | Dose history |
| Care team | `/api/doctors`, `/api/connections`, `/api/appointments` | Doctor discovery, connections and appointments |
| Messaging | `/api/messages` and related inbox routes | Connected patient/doctor messages |
| Privacy | `GET /api/privacy/export`, `DELETE /api/privacy/account` | Personal-data export and account deletion |

For exact request and response shapes, see the route handlers in `server/src/app.js` and validation schemas in `server/src/validators.js`.

## Development log

The work was organised around the three-day assignment window, followed by final verification and documentation on the submission day. This is a milestone summary, not a claim that every feature was written on a single date.

### November 7 — Assignment breakdown and application foundation

- Reviewed the Kenpath brief and prioritised the required full-stack glucose-tracking workflow.
- Established the React/Vite frontend, Express API and PostgreSQL/Prisma architecture.
- Defined the patient account and glucose-reading data model, including the four daily reading slots.
- Set up the project structure and local development configuration.

### November 8 — Core tracker and supporting workflows

- Built out the patient-facing application experience and glucose-recording workflow.
- Implemented authentication and user-scoped reading operations.
- Added reading validation and report calculations for daily, month-to-date and previous-month views.
- Expanded the app with dashboard visualisation and supporting health-record features, including lifestyle tracking and export/report functionality.
- Added and exercised backend validation tests.

### November 9 — Integration, additional features and repository preparation

- Integrated the broader health-management experience: medication records, appointment/care-team workflows, and doctor/patient features.
- Added a medication dose schedule and date-specific Taken / Not taken / Not recorded tracker with history.
- Added doctor–patient messaging and lightweight online-presence indicators.
- Worked through local setup, Prisma client/schema alignment, database integration and application runtime issues.
- Verified the backend test suite and frontend production build.
- Prepared `.env.example`, checked that local secrets and backups were excluded, created the initial Git commit, and pushed the public repository.

### November 10 — Final review and submission preparation

- Confirmed the application starts locally and the medication tracker is working after the backend restart.
- Updated this README to document setup, architecture, features, tests, assumptions, limitations and future work.
- Preparing a short 2–3 minute product walkthrough and screenshots for the Kenpath submission email.

## Assumptions and implementation notes

- The four glucose slots are fixed to the labels in the assignment: Morning (fasting), After breakfast, After lunch and After dinner.
- A glucose value is stored as a whole-number integer in mg/dL and must be between 40 and 600 inclusive.
- A patient may have at most one reading per slot per calendar date, and at most four readings per date.
- Dates in the future are rejected.
- Report averages are rounded to one decimal place. Empty date ranges return an empty state rather than fabricated values.
- Reading ownership is determined by the authenticated user, not by a user ID supplied by the browser.
- The dose tracker records what a patient marks. It does not infer whether an unmarked dose was taken.
- Dose labels, times and quantities are entered by the patient based on their existing prescription. Sweety does not prescribe or calculate medication doses.
- Browser reminders require notification permission and the app to remain open. They are not guaranteed background notifications.
- Presence is maintained in server memory with an expiry window. It is suitable for a single local server process, not a horizontally scaled deployment without shared presence storage.
- OCR output is a suggestion only and must be verified by the user.
- Optional AI is not required for the core glucose-tracking workflow. Health records should not be sent to a hosted AI service for clinical interpretation.

## Known limitations

- The current automated suite is focused on backend input validation; broader API integration, database and frontend interaction tests would improve confidence.
- The frontend production build currently reports a large JavaScript chunk; route-level code splitting and bundle optimisation have not yet been completed.
- Browser-based medication reminders are limited by browser permission, device settings and the app being open.
- Presence is in-memory and will not be shared between multiple backend instances.
- The seed script resets sample readings for the demo patient; it must not be run against a database whose demo readings need to be retained.
- A complete production deployment, monitoring, backup/restore runbook and security review are outside the current local assignment implementation.
- Dependency audit output during local installation reported vulnerabilities in the dependency tree. These should be reviewed and resolved with compatible, tested dependency updates rather than applying force upgrades blindly.

## Future improvements

If more development time were available, the next priorities would be:

1. **Test coverage:** add API integration tests for authentication, per-user access control, reading CRUD, report date boundaries and dose logging; add React Testing Library tests for the reading form and key workflows.
2. **Security hardening:** review dependency advisories, add stronger request validation and rate limits where appropriate, review token lifecycle and cookie/storage strategy, and perform an authorisation audit across doctor/patient routes.
3. **Reliable reminders:** add a persistent notification centre and a background job/queue for scheduled reminders; support push notifications where the platform permits.
4. **Production readiness:** add deployment configuration, structured logging, health monitoring, database migrations, automated backups and a tested restore procedure.
5. **Scalability:** move online presence and messaging delivery state to a shared store for multi-instance deployments.
6. **Data portability:** include dose schedules and dose logs in the personal-data export and add import/restore support.
7. **Frontend performance and accessibility:** split large bundles, improve loading/error/empty states, keyboard navigation and screen-reader labels.
8. **Clinical safety and clarity:** make units and date/time handling explicit, add clear data provenance, and keep all clinical decisions with the patient's healthcare professional.

## Security and privacy

- Passwords are hashed with bcryptjs; plaintext passwords are not stored.
- Protected API routes use JWT authentication.
- Reading and patient-owned data access is scoped to the authenticated account.
- Helmet, CORS configuration and authentication rate limiting are included in the API.
- `.env`, local database files, backups and generated build/dependency folders are excluded from version control.
- `.env.example` contains placeholders and local-development defaults only. Replace secrets before deployment.
- Use synthetic data for demonstrations. Do not place real patient information, database dumps, API keys or passwords in the public repository.

---

**Repository:** https://github.com/abhigna17/sweety

Built as a learning and engineering exercise for the Kenpath Junior Full Stack Developer – JavaScript & AI assessment.
