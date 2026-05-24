import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Cloud,
  CloudCog,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  UploadCloud,
} from 'lucide-react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || ''

function getInitialSession() {
  const params = new URLSearchParams(window.location.search)
  const sessionFromUrl = params.get('session')

  if (sessionFromUrl) {
    localStorage.setItem('sf_session_id', sessionFromUrl)
    window.history.replaceState({}, document.title, window.location.pathname)
    return sessionFromUrl
  }

  return localStorage.getItem('sf_session_id') || ''
}

function App() {
  const [sessionId, setSessionId] = useState(getInitialSession)
  const [config, setConfig] = useState(null)
  const [profile, setProfile] = useState(null)
  const [rules, setRules] = useState([])
  const [pending, setPending] = useState({})
  const [objectApiName, setObjectApiName] = useState('Account')
  const [loading, setLoading] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const pendingChanges = useMemo(
    () =>
      rules
        .filter((rule) => pending[rule.id] !== undefined && pending[rule.id] !== rule.active)
        .map((rule) => ({
          id: rule.id,
          name: rule.name,
          active: pending[rule.id],
          metadata: rule.metadata,
        })),
    [pending, rules],
  )

  const allEnabled = rules.length > 0 && rules.every((rule) => (pending[rule.id] ?? rule.active))
  const allDisabled = rules.length > 0 && rules.every((rule) => !(pending[rule.id] ?? rule.active))

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': sessionId,
        ...options.headers,
      },
    })

    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(payload.message || 'Request failed')
    }

    return payload
  }, [sessionId])

  useEffect(() => {
    fetch(`${API_BASE}/api/config`)
      .then((response) => response.json())
      .then(setConfig)
      .catch(() => setConfig({ connectedAppReady: false }))
  }, [])

  useEffect(() => {
    if (!sessionId) return

    request('/api/me')
      .then(setProfile)
      .catch(() => {
        localStorage.removeItem('sf_session_id')
        setSessionId('')
        setProfile(null)
      })
  }, [request, sessionId])

  function login() {
    window.location.href = `${API_BASE}/auth/login`
  }

  async function logout() {
    if (sessionId) {
      await request('/api/logout', { method: 'POST' }).catch(() => {})
    }

    localStorage.removeItem('sf_session_id')
    setSessionId('')
    setProfile(null)
    setRules([])
    setPending({})
    setNotice('Logged out from the local web session.')
  }

  async function loadRules() {
    setLoading(true)
    setError('')
    setNotice('')

    try {
      const data = await request(`/api/validation-rules?objectApiName=${encodeURIComponent(objectApiName)}`)
      setRules(data.records)
      setPending({})
      setNotice(`Loaded ${data.records.length} validation rule${data.records.length === 1 ? '' : 's'}.`)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  function setRuleState(ruleId, active) {
    setPending((current) => ({ ...current, [ruleId]: active }))
  }

  function setAllRules(active) {
    setPending((current) => ({
      ...current,
      ...Object.fromEntries(rules.map((rule) => [rule.id, active])),
    }))
  }

  async function deployChanges() {
    if (!pendingChanges.length) return

    setDeploying(true)
    setError('')
    setNotice('')

    try {
      await request('/api/validation-rules/deploy', {
        method: 'POST',
        body: JSON.stringify({ changes: pendingChanges }),
      })

      setRules((current) =>
        current.map((rule) =>
          pending[rule.id] === undefined ? rule : { ...rule, active: pending[rule.id] },
        ),
      )
      setPending({})
      setNotice(`Deployed ${pendingChanges.length} validation rule change${pendingChanges.length === 1 ? '' : 's'} to Salesforce.`)
    } catch (deployError) {
      setError(deployError.message)
    } finally {
      setDeploying(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <CloudCog size={24} />
          </span>
          <div>
            <p className="eyebrow">Salesforce Tooling API</p>
            <h1>Validation Rule Switch</h1>
          </div>
        </div>

        {sessionId ? (
          <button className="ghost-button" type="button" onClick={logout}>
            <LogOut size={18} />
            Logout
          </button>
        ) : (
          <button className="primary-button" type="button" onClick={login}>
            <LogIn size={18} />
            Login with Salesforce
          </button>
        )}
      </header>

      <section className="workspace">
        <aside className="setup-panel">
          <div className="status-block">
            <ShieldCheck size={22} />
            <div>
              <h2>Connection</h2>
              <p>{sessionId ? 'Authenticated with Salesforce.' : 'Login to fetch Account validation rules.'}</p>
            </div>
          </div>

          <dl className="meta-list">
            <div>
              <dt>Connected app</dt>
              <dd>{config?.connectedAppReady ? 'Configured' : 'Needs .env values'}</dd>
            </div>
            <div>
              <dt>API version</dt>
              <dd>{config?.apiVersion || 'Checking'}</dd>
            </div>
            <div>
              <dt>Instance</dt>
              <dd>{profile?.instanceUrl || 'Not connected'}</dd>
            </div>
          </dl>
        </aside>

        <section className="rules-panel">
          <div className="toolbar">
            <label className="object-field">
              <span>Object API name</span>
              <input
                value={objectApiName}
                onChange={(event) => setObjectApiName(event.target.value)}
                placeholder="Account"
              />
            </label>

            <div className="toolbar-actions">
              <button className="secondary-button" type="button" onClick={loadRules} disabled={!sessionId || loading}>
                <RefreshCw size={18} className={loading ? 'spin' : ''} />
                Get rules
              </button>
              <button className="secondary-button" type="button" onClick={() => setAllRules(true)} disabled={!rules.length || allEnabled}>
                <ToggleRight size={18} />
                Enable all
              </button>
              <button className="secondary-button" type="button" onClick={() => setAllRules(false)} disabled={!rules.length || allDisabled}>
                <ToggleLeft size={18} />
                Disable all
              </button>
              <button className="deploy-button" type="button" onClick={deployChanges} disabled={!pendingChanges.length || deploying}>
                <UploadCloud size={18} />
                {deploying ? 'Deploying' : `Deploy ${pendingChanges.length || ''}`.trim()}
              </button>
            </div>
          </div>

          {notice && (
            <div className="notice success">
              <CheckCircle2 size={18} />
              {notice}
            </div>
          )}
          {error && <div className="notice error">{error}</div>}

          <div className="table-shell">
            <div className="table-head">
              <span>Validation rule</span>
              <span>Status</span>
              <span>Pending</span>
              <span>Action</span>
            </div>

            {rules.length ? (
              rules.map((rule) => {
                const nextActive = pending[rule.id] ?? rule.active
                const changed = pending[rule.id] !== undefined && pending[rule.id] !== rule.active

                return (
                  <article className="rule-row" key={rule.id}>
                    <div>
                      <h3>{rule.name}</h3>
                      <p>{rule.errorMessage || rule.description || 'No description or error message returned.'}</p>
                    </div>
                    <span className={rule.active ? 'pill active' : 'pill inactive'}>
                      {rule.active ? 'Active' : 'Inactive'}
                    </span>
                    <span className={changed ? 'pending-change' : 'muted'}>
                      {changed ? (nextActive ? 'Will enable' : 'Will disable') : 'No change'}
                    </span>
                    <button
                      className={nextActive ? 'toggle-button on' : 'toggle-button'}
                      type="button"
                      onClick={() => setRuleState(rule.id, !nextActive)}
                      aria-pressed={nextActive}
                    >
                      {nextActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                      {nextActive ? 'Enabled' : 'Disabled'}
                    </button>
                  </article>
                )
              })
            ) : (
              <div className="empty-state">
                <Cloud size={34} />
                <h2>No validation rules loaded</h2>
                <p>Connect to Salesforce, then fetch the Account object validation rules.</p>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
