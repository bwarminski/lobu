# Anthropic API Proxy

This module provides a simple proxy service for the Anthropic API that validates PostgreSQL credentials before forwarding requests.

## Features

- **Modular Design**: Can run within dispatcher or as separate service
- **PostgreSQL Authentication**: Validates user credentials against database
- **Streaming Support**: Maintains streaming responses for Claude API
- **Feature Flag Control**: Enable/disable via configuration

## Configuration

Enable the proxy by setting these environment variables:

```bash
ANTHROPIC_PROXY_ENABLED=true
ANTHROPIC_API_KEY=your_anthropic_api_key
DATABASE_URL=postgres://user:pass@host:port/db
```

## Usage

### For Workers

Workers automatically use the proxy when enabled by setting:
- `ANTHROPIC_BASE_URL` to dispatcher's internal service URL
- `CLAUDE_API_KEY` to PostgreSQL credentials in format `username:password`

### Authentication Flow

1. Worker sends request with `Authorization: Bearer username:password`
2. Proxy validates credentials against PostgreSQL database
3. If valid, forwards request to Anthropic API with actual API key
4. Streams response back to worker

### Endpoints

- `GET /api/anthropic/health` - Health check
- `ALL /api/anthropic/*` - Proxy to Anthropic API

## Deployment

### Integrated Mode (Default)
Runs within the dispatcher service:
```yaml
dispatcher:
  anthropicProxy:
    enabled: true
```

### Standalone Mode (Future)
Can be extracted to separate deployment by updating the orchestrator configuration.

## Security

- Only validates credentials, doesn't store them
- Uses internal cluster networking
- API keys stored in Kubernetes secrets
- Connection timeouts prevent hanging connections