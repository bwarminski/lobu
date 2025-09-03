import http2 from 'node:http2'

const token = process.env.CLAUDE_CODE_OAUTH_TOKEN
if (!token) {
  console.error('Missing CLAUDE_CODE_OAUTH_TOKEN')
  process.exit(1)
}

// Based on CLI analysis, these are the exact headers used
const BETA = 'oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14'
const UA = 'claude-cli/1.0.98 (external, sdk-cli)'
const PATH = '/v1/messages?beta=true'

// CLI sets these headers based on analysis of cli.js
const baseHeaders: Record<string, string> = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  accept: 'application/json',
  'anthropic-beta': BETA,
  'anthropic-version': '2023-06-01',
  'user-agent': UA,
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

// Based on CLI analysis, OAuth requests may not include custom metadata
function buildBody(model: string, max_tokens: number, stream = false) {
  const body: any = {
    model,
    max_tokens,
    messages: [{ role: 'user', content: 'Respond exactly with: Hello! I am working.' }],
  }
  if (stream) body.stream = true
  return JSON.stringify(body)
}

async function http1Post(model: string, maxTokens: number, stream = false) {
  const res = await fetch(`https://api.anthropic.com${PATH}`, {
    method: 'POST',
    headers: baseHeaders as any,
    body: buildBody(model, maxTokens, stream),
  })
  const text = await res.text()
  console.log('http1', model, res.status)
  console.log(text)
}

function http2Post(model: string, maxTokens: number, stream = false): Promise<void> {
  return new Promise((resolve) => {
    const client = http2.connect('https://api.anthropic.com')
    const body = buildBody(model, maxTokens, stream)
    const headers: http2.OutgoingHttpHeaders = {
      ':method': 'POST',
      ':path': PATH,
      ':scheme': 'https',
      ':authority': 'api.anthropic.com',
      ...baseHeaders,
      'content-length': Buffer.byteLength(body).toString(),
    }
    const req = client.request(headers)
    let data = ''
    req.setEncoding('utf8')
    req.on('response', (h) => {
      console.log('http2', model, h[':status'])
    })
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      console.log(data)
      client.close()
      resolve()
    })
    req.end(body)
  })
}

async function run() {
  console.log('\n--- Testing Model Access with OAuth Token ---')

  // Test cheaper models (should work)
  console.log('\n--- http1 haiku (cheap, should work) ---')
  await http1Post('claude-3-5-haiku-20241022', 1)

  console.log('\n--- http1 haiku latest (cheap, should work) ---')
  await http1Post('claude-3-haiku-20240307', 1)

  // Test expensive models (should fail)
  console.log('\n--- http1 sonnet 3.5 (expensive, should fail) ---')
  await http1Post('claude-3-5-sonnet-20241022', 100)

  console.log('\n--- http1 sonnet 3 (expensive, should fail) ---')
  await http1Post('claude-3-sonnet-20240229', 100)

  // Test Opus (most expensive, should definitely fail)
  console.log('\n--- http1 opus (most expensive, should fail) ---')
  await http1Post('claude-3-opus-20240229', 100)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})


