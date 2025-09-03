import https from 'https'

const TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN
if (!TOKEN) {
  console.error('CLAUDE_CODE_OAUTH_TOKEN required')
  process.exit(1)
}

const headers = {
  'host': 'api.anthropic.com',
  'connection': 'keep-alive',
  'Accept': 'application/json',
  'X-Stainless-Retry-Count': '0',
  'X-Stainless-Timeout': '600',
  'X-Stainless-Lang': 'js',
  'X-Stainless-Package-Version': '0.60.0',
  'X-Stainless-OS': 'MacOS',
  'X-Stainless-Arch': 'arm64',
  'X-Stainless-Runtime': 'node',
  'X-Stainless-Runtime-Version': 'v23.10.0',
  'anthropic-dangerous-direct-browser-access': 'true',
  'anthropic-version': '2023-06-01',
  'authorization': `Bearer ${TOKEN}`,
  'x-app': 'cli',
  'User-Agent': 'claude-cli/1.0.98 (external, sdk-cli)',
  'content-type': 'application/json',
  'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
  'x-stainless-helper-method': 'stream',
  'accept-language': '*',
  'sec-fetch-mode': 'cors'
}

const body = {
  "model": "claude-sonnet-4-20250514",
  "messages": [{
    "role": "user",
    "content": [{
      "type": "text",
      "text": "<system-reminder>Test content</system-reminder>"
    }, {
      "type": "text", 
      "text": "Hello Sonnet",
      "cache_control": { "type": "ephemeral" }
    }]
  }],
  "temperature": 1,
  "system": [{
    "type": "text",
    "text": "You are Claude Code, Anthropic's official CLI for Claude.",
    "cache_control": { "type": "ephemeral" }
  }],
  "tools": [{
    "name": "Task",
    "description": "Launch a new agent to handle complex, multi-step tasks autonomously.",
    "input_schema": {
      "type": "object",
      "properties": {
        "description": { "type": "string" },
        "prompt": { "type": "string" },
        "subagent_type": { "type": "string" }
      },
      "required": ["description", "prompt", "subagent_type"]
    }
  }],
  "metadata": {
    "user_id": "user_test_session_123"
  },
  "max_tokens": 32000,
  "stream": true
}

async function test() {
  const bodyStr = JSON.stringify(body)
  
  return new Promise((resolve, reject) => {
    const req = https.request('https://api.anthropic.com/v1/messages?beta=true', {
      method: 'POST',
      headers: {
        ...headers,
        'content-length': Buffer.byteLength(bodyStr).toString()
      },
      timeout: 60000
    }, (res) => {
      console.log(`Status: ${res.statusCode}`)
      
      let data = ''
      res.on('data', chunk => {
        data += chunk
        process.stdout.write(chunk)
      })
      res.on('end', () => {
        console.log('\n--- Complete ---')
        resolve(data)
      })
    })
    
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    
    req.write(bodyStr)
    req.end()
  })
}

test().catch(console.error)
