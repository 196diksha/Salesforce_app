# Salesforce Validation Rule Switch

React + Express assignment project for logging in to a Salesforce Developer Org, reading Account validation rules through the Tooling API, staging active/inactive changes, and deploying those changes back to Salesforce.

## Tech Stack

- React with Vite
- Node.js and Express bridge API
- Salesforce OAuth 2.0 web server flow
- Salesforce Tooling API `ValidationRule`

## Salesforce Setup

1. Create a Salesforce Developer Org at `https://developer.salesforce.com/signup`.
2. In Salesforce Setup, open Object Manager > Account > Validation Rules.
3. Create 4-5 validation rules on Account. Example rules:
   - Account name must not be `Test`
   - Phone is required for customer accounts
   - Website must start with `https://`
   - Annual revenue cannot be negative
   - Billing country is required
4. In Setup, create a Connected App:
   - Enable OAuth Settings
   - Callback URL: `http://localhost:5000/oauth/callback`
   - OAuth scopes: `Access and manage your data (api)` and `Perform requests at any time (refresh_token, offline_access)`
5. Copy the connected app Consumer Key and Consumer Secret.

## Local Setup

```bash
npm install
copy .env.example .env
```

Update `.env`:

```bash
SF_CLIENT_ID=your_connected_app_consumer_key
SF_CLIENT_SECRET=your_connected_app_consumer_secret
SF_REDIRECT_URI=http://localhost:5000/oauth/callback
SF_LOGIN_URL=https://login.salesforce.com
SF_API_VERSION=v60.0
CLIENT_URL=http://localhost:5173
PORT=5000
```

Use `https://test.salesforce.com` for `SF_LOGIN_URL` if you connect to a sandbox.

## Run

```bash
npm run dev
```

Open `http://localhost:5173`.

## App Flow

1. Click `Login with Salesforce`.
2. Approve the connected app in Salesforce.
3. Click `Get rules` to load validation rules for `Account`.
4. Toggle one rule or use `Enable all` / `Disable all`.
5. Click `Deploy` to update Salesforce.

The UI stages changes locally first. Salesforce is only changed after `Deploy`.

## Deploy Notes

For online deployment, deploy both parts:

- React build: `npm run build`, then host `dist` on Netlify, Vercel, Render static hosting, or similar.
- Express API: deploy `server/server.js` on Render, Railway, Heroku, or similar.

After deployment, update the Connected App callback URL and environment variables:

- `SF_REDIRECT_URI=https://your-api-domain.com/oauth/callback`
- `CLIENT_URL=https://your-react-domain.com`
- `VITE_API_BASE=https://your-api-domain.com`
