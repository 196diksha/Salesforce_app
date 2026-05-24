import 'dotenv/config'
import axios from 'axios'
import cors from 'cors'
import crypto from 'node:crypto'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const port = process.env.PORT || 5000
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173'
const loginUrl = process.env.SF_LOGIN_URL || 'https://login.salesforce.com'
const apiVersion = process.env.SF_API_VERSION || 'v60.0'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '../dist')
const sessions = new Map()
const oauthStates = new Map()
const oauthStateTtlMs = 10 * 60 * 1000

app.use(cors({ origin: clientUrl, credentials: true }))
app.use(express.json({ limit: '1mb' }))

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required. Check .env.example and create .env.`)
  }
  return value
}

function getConnectedAppConfig() {
  return {
    clientId: requireEnv('SF_CLIENT_ID'),
    clientSecret: requireEnv('SF_CLIENT_SECRET'),
    redirectUri: requireEnv('SF_REDIRECT_URI'),
  }
}

function createPkcePair() {
  const verifier = crypto.randomBytes(64).toString('base64url')
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url')

  return { challenge, verifier }
}

function rememberOAuthState(state, verifier) {
  const expiresAt = Date.now() + oauthStateTtlMs
  oauthStates.set(state, { expiresAt, verifier })
}

function takeOAuthState(state) {
  const oauthState = state ? oauthStates.get(state) : null

  if (!oauthState) {
    const error = new Error('Salesforce OAuth state is missing or expired. Start login again.')
    error.status = 400
    throw error
  }

  oauthStates.delete(state)

  if (oauthState.expiresAt < Date.now()) {
    const error = new Error('Salesforce OAuth state expired. Start login again.')
    error.status = 400
    throw error
  }

  return oauthState
}

function getSession(req) {
  const sessionId = req.header('x-session-id')
  const session = sessionId ? sessions.get(sessionId) : null

  if (!session) {
    const error = new Error('Salesforce session not found. Log in again.')
    error.status = 401
    throw error
  }

  return session
}

function normalizeMetadata(metadata = {}, active) {
  return {
    ...metadata,
    active,
  }
}

function escapeSoqlString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

async function toolingQuery(session, query) {
  const { data } = await axios.get(
    `${session.instanceUrl}/services/data/${apiVersion}/tooling/query`,
    {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      params: { q: query },
    },
  )

  return data
}

app.get('/api/config', (_req, res) => {
  res.json({
    apiVersion,
    connectedAppReady: Boolean(process.env.SF_CLIENT_ID && process.env.SF_CLIENT_SECRET),
    loginUrl,
  })
})

app.get('/auth/login', (req, res, next) => {
  try {
    const { clientId, redirectUri } = getConnectedAppConfig()
    const state = crypto.randomUUID()
    const { challenge, verifier } = createPkcePair()
    const target = new URL('/services/oauth2/authorize', loginUrl)

    rememberOAuthState(state, verifier)

    target.searchParams.set('response_type', 'code')
    target.searchParams.set('client_id', clientId)
    target.searchParams.set('redirect_uri', redirectUri)
    target.searchParams.set('scope', 'api refresh_token')
    target.searchParams.set('state', state)
    target.searchParams.set('code_challenge', challenge)
    target.searchParams.set('code_challenge_method', 'S256')

    res.redirect(target.toString())
  } catch (error) {
    next(error)
  }
})

app.get('/oauth/callback', async (req, res, next) => {
  try {
    const code = req.query.code
    const state = req.query.state

    if (!code) {
      throw new Error('Salesforce did not return an authorization code.')
    }

    const { verifier } = takeOAuthState(state)
    const { clientId, clientSecret, redirectUri } = getConnectedAppConfig()
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    })

    const { data } = await axios.post(`${loginUrl}/services/oauth2/token`, params)
    const sessionId = crypto.randomUUID()

    sessions.set(sessionId, {
      accessToken: data.access_token,
      instanceUrl: data.instance_url,
      issuedAt: Date.now(),
      userId: data.id,
    })

    res.redirect(`${clientUrl}/?session=${sessionId}`)
  } catch (error) {
    next(error)
  }
})

app.get('/api/me', (req, res, next) => {
  try {
    const session = getSession(req)

    res.json({
      instanceUrl: session.instanceUrl,
      userId: session.userId,
      issuedAt: session.issuedAt,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/validation-rules', async (req, res, next) => {
  try {
    const session = getSession(req)
    const objectApiName = String(req.query.objectApiName || 'Account').trim() || 'Account'
    const query = `
      SELECT Id, ValidationName, Active, Description, ErrorMessage, EntityDefinition.QualifiedApiName
      FROM ValidationRule
      WHERE EntityDefinition.QualifiedApiName = '${escapeSoqlString(objectApiName)}'
      ORDER BY ValidationName
    `

    const data = await toolingQuery(session, query)
    const records = await Promise.all(
      data.records.map(async (rule) => {
        const metadataQuery = `
          SELECT Id, Metadata
          FROM ValidationRule
          WHERE Id = '${escapeSoqlString(rule.Id)}'
          LIMIT 1
        `
        const metadataResult = await toolingQuery(session, metadataQuery)
        const metadata = metadataResult.records[0]?.Metadata || {}

        return {
          id: rule.Id,
          name: rule.ValidationName,
          active: rule.Active,
          description: rule.Description || '',
          errorMessage: rule.ErrorMessage || metadata.errorMessage || '',
          entity: rule.EntityDefinition?.QualifiedApiName || objectApiName,
          metadata,
        }
      }),
    )

    res.json({
      objectApiName,
      records,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/validation-rules/deploy', async (req, res, next) => {
  try {
    const session = getSession(req)
    const changes = Array.isArray(req.body?.changes) ? req.body.changes : []

    if (!changes.length) {
      return res.json({ deployed: [] })
    }

    const deployed = []

    for (const change of changes) {
      if (!change.id || typeof change.active !== 'boolean') {
        const error = new Error('Each change needs id and boolean active.')
        error.status = 400
        throw error
      }

      await axios.patch(
        `${session.instanceUrl}/services/data/${apiVersion}/tooling/sobjects/ValidationRule/${change.id}`,
        { Metadata: normalizeMetadata(change.metadata, change.active) },
        { headers: { Authorization: `Bearer ${session.accessToken}` } },
      )

      deployed.push({ id: change.id, active: change.active })
    }

    res.json({ deployed })
  } catch (error) {
    next(error)
  }
})

app.post('/api/logout', (req, res) => {
  const sessionId = req.header('x-session-id')
  if (sessionId) {
    sessions.delete(sessionId)
  }
  res.json({ ok: true })
})

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir))
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/oauth')) {
      return next()
    }

    return res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use((error, _req, res, _next) => {
  void _next
  const status = error.status || error.response?.status || 500
  const salesforceMessage = error.response?.data
  const salesforceDetails = Array.isArray(salesforceMessage)
    ? salesforceMessage
        .map((item) => [item.errorCode, item.message].filter(Boolean).join(': '))
        .join(' ')
    : salesforceMessage?.message

  res.status(status).json({
    message: salesforceDetails || error.message || 'Unexpected server error',
    details: salesforceMessage,
  })
})

app.listen(port, () => {
  console.log(`Salesforce bridge API running on http://localhost:${port}`)
})
