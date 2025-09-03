import https from 'https'

// Configuration
const ORG_ID = process.env.CLAUDE_ORG_ID || '4110ac4a-15cc-41ce-95a3-9375b1ff97b9'
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

let ACCESS = (process.env.CLAUDE_CODE_OAUTH_TOKEN || '').trim()
let REFRESH = (process.env.CLAUDE_CODE_REFRESH_TOKEN || '').trim()

const SONNET_MODEL = process.argv[2] || 'claude-3-5-sonnet-20241022'
const HAIKU_MODEL = 'claude-3-5-haiku-20241022'

function cliHeaders(beta: string, helperStream = false) {
  const base: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    authorization: `Bearer ${ACCESS}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': beta,
    'anthropic-dangerous-direct-browser-access': 'true',
    'user-agent': 'claude-cli/1.0.98 (external, sdk-cli)',
    'x-app': 'cli',
    'x-stainless-arch': 'arm64',
    'x-stainless-lang': 'js',
    'x-stainless-os': 'MacOS',
    'x-stainless-package-version': '0.60.0',
    'x-stainless-retry-count': '0',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': 'v23.10.0',
    'x-stainless-timeout': '600',
  }
  if (helperStream) base['x-stainless-helper-method'] = 'stream'
  return base
}

function fetchJson(url: string, method: string, headers: Record<string, string>, body?: any): Promise<{ status: number; text: string }> {
  const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : undefined
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: { ...headers, ...(payload ? { 'content-length': String(payload.length) } : {}) },
      timeout: 60_000,
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode || 0, text: data }))
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 504, text: 'timeout' })
    })
    if (payload) req.write(payload)
    req.end()
  })
}

async function refreshAccessToken(): Promise<boolean> {
  if (!REFRESH) return false
  const body = {
    grant_type: 'refresh_token',
    refresh_token: REFRESH,
    client_id: OAUTH_CLIENT_ID,
  }
  const { status, text } = await fetchJson('https://console.anthropic.com/v1/oauth/token', 'POST', {
    'content-type': 'application/json',
  }, body)
  if (status >= 200 && status < 300) {
    try {
      const j = JSON.parse(text)
      ACCESS = j.access_token || ACCESS
      if (j.refresh_token) REFRESH = j.refresh_token
      console.log('refreshed access token')
      return true
    } catch {
      console.log('refresh parse error')
    }
  } else {
    console.log('refresh failed', status, text.slice(0, 200))
  }
  return false
}

async function preauthorize(): Promise<boolean> {
  if (!ACCESS && REFRESH) await refreshAccessToken()
  const { status, text } = await fetchJson(`https://api.anthropic.com/api/organization/${ORG_ID}/claude_code_sonnet_1m_access`, 'GET', {
    authorization: `Bearer ${ACCESS}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'user-agent': 'claude-code/1.0.98',
  })
  if (status === 200) return true
  if (status === 401 && REFRESH) {
    const ok = await refreshAccessToken()
    if (ok) return preauthorize()
  }
  console.log('preauth failed', status, text.slice(0, 200))
  return false
}

async function haikuPreflight(): Promise<void> {
  const url = 'https://api.anthropic.com/v1/messages?beta=true'
  const headers = cliHeaders('oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14')
  const body = {
    model: HAIKU_MODEL,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ident' }],
  }
  const { status, text } = await fetchJson(url, 'POST', headers, body)
  console.log('haiku preflight', status, text.slice(0, 200))
  if (status === 401 && REFRESH) {
    const ok = await refreshAccessToken()
    if (ok) {
      const { status: s2, text: t2 } = await fetchJson(url, 'POST', cliHeaders('oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14'), body)
      console.log('haiku preflight retry', s2, t2.slice(0, 200))
    }
  }
}

async function sonnetStream(): Promise<void> {
  const url = 'https://api.anthropic.com/v1/messages?beta=true'
  const headers = cliHeaders('claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14', true)
  const body = {
    model: SONNET_MODEL,
    max_tokens: 128,
    stream: true,
    messages: [{ role: 'user', content: "Return 'OK' and nothing else" }],
  }
  // For simplicity, do a non-stream read
  const { status, text } = await fetchJson(url, 'POST', headers, body)
  console.log('sonnet', status)
  console.log(text)
}

async function main() {
  if (!ACCESS && !REFRESH) {
    console.error('Provide CLAUDE_CODE_OAUTH_TOKEN or CLAUDE_CODE_REFRESH_TOKEN')
    process.exit(1)
  }
  const ok = await preauthorize()
  if (!ok) {
    console.log('preauth failed; continuing anyway')
  }
  await haikuPreflight()
  await sonnetStream()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
