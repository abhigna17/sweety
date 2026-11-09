# Chat notifications and presence update

This update changes only `server/src/app.js`, `client/src/main.jsx`, and `client/src/style.css`.

## Behaviour
- Patient/doctor messages are checked every 5 seconds while signed in.
- New inbound messages produce a visible in-app alert and unread badge.
- If the browser tab is hidden and notification permission is granted, a browser notification is also sent.
- The existing browser-notification permission control is used; no permission is requested without user action.
- The secure conversation is now a fixed floating panel instead of being buried at the bottom of the patient/doctor page.
- Patient and doctor presence is shown as Online, Away, or Offline.
- Presence heartbeat runs every 20 seconds; inactivity for 60 seconds is Away; no heartbeat for 75 seconds is Offline.
- Presence is held in server memory and is not stored in PostgreSQL. No Prisma schema migration or database reset is needed.
- Presence and inbox endpoints only expose accepted patient-doctor connections.

## Important deployment note
The in-memory presence map is suitable for the current single-process local development setup. A multi-instance/production deployment should move presence to a shared store (for example Redis) and use a durable notification/read-receipt design. Browser notifications require permission and work only when supported by the browser; in-app alerts work while Sweety is open.
