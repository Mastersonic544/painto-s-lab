# Painto's Lab

Painto's Lab uses Firebase Authentication and Realtime Database for accounts and text records, and Cloudinary for images and generated SVGs. The browser data module retains a `supabase` shaped interface so the existing UI can keep its query calls, but it uses Firebase at runtime. The `supabase/migrations` directory is legacy reference material.

## Local setup

Use Node.js 22, run `npm install`, copy `.env.example` to `.env.local`, and set the Firebase web app values, including `VITE_FIREBASE_DATABASE_URL`. Enable Email/Password sign in, create a user, create Realtime Database, and publish `database.rules.json`. Painto records and JSON artifacts live under `apps/paintos/users/{uid}`. The rules also permit Punchiora's `users/{uid}` namespace so both apps can share one Firebase project.

Set `VITE_CLOUDINARY_CLOUD_NAME` and `VITE_CLOUDINARY_UPLOAD_PRESET` for the browser and Vercel functions. The unsigned preset must allow PNG, JPG, and SVG uploads. Source images and generated SVGs go to Cloudinary; segmentation cache JSON goes to Realtime Database.

For `/api/generate`, `/api/regenerate`, and `/api/decide-complexity`, also set the server-only `FIREBASE_*` values, including `FIREBASE_DATABASE_URL`. Locally, `GOOGLE_APPLICATION_CREDENTIALS` can point to a service account JSON file outside the repo. On Vercel and the converter host, set `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` from that JSON; put literal `\n` between private key lines or use a multiline value. Never prefix service account settings with `VITE_` or commit the JSON file.

`npm run dev` starts the browser app and local API bridge. `npm run build` checks the browser and server code.

## Deployment

Deploy the `painto-s-lab` directory as its own Vercel project. Set the `VITE_FIREBASE_*` web values, Cloudinary values, and server-only `FIREBASE_*` service account values there. Add the deployed hostname to Firebase Authentication authorized domains. Generation runs in a Vercel function with a 300-second limit; the suspended Render service is no longer used. The Vercel rewrite serves client routes while keeping `/api` functions.

`OPENROUTER_API_KEY` is optional for model-based complexity estimates. The app has an algorithmic fallback.

The first Firebase project starts empty. The old Supabase database, storage objects, and users are not automatically copied. Create Firebase Auth users separately and migrate old data if it must be preserved.
