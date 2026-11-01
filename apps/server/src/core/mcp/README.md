# Docmost MCP server

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server, served by the Nest app at `/mcp` over Streamable HTTP. Every tool is a thin wrapper around an existing REST endpoint, called in-process, so your normal permissions apply.

## Tools

| Tool | Wraps | Input |
|---|---|---|
| `list_spaces` | `POST /api/spaces` | none |
| `search_pages` | `POST /api/search` | `query`, optional `spaceId` |
| `read_page` | `POST /api/pages/info` | `pageId` |
| `create_page` | `POST /api/pages/create` | `spaceId`, `title`, `content` (markdown), optional `parentPageId` |
| `update_page` | `POST /api/pages/update` | `pageId`, optional `content` (markdown), `operation` (`replace` default, `append`, `prepend`), optional `title` |

## Authentication

The endpoint is an OAuth 2.1 protected resource. A request without a token gets a `401` whose `WWW-Authenticate` header points at `/.well-known/oauth-protected-resource/mcp`, and from there any MCP client discovers the authorization server, registers itself and runs the PKCE authorization-code flow on its own. The pieces, all in `apps/server/src/core/oauth/`:

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-authorization-server` | server metadata |
| `GET /.well-known/oauth-protected-resource/mcp` | resource metadata |
| `POST /api/oauth/register` | dynamic client registration, public clients only, `https` or `localhost` redirect URIs |
| `/oauth/consent` | the consent page in the web client; it asks you to log in first if needed |
| `POST /api/oauth/authorize-info`, `POST /api/oauth/authorize` | what the consent page calls to show and record your decision |
| `POST /api/oauth/token` | code exchange with PKCE S256, and refresh with rotation |

Access tokens last 1 hour, refresh tokens 30 days, and both are stored in the `oauth_*` tables so revoking a grant takes effect immediately. Scopes are `read` and `write`, and the wrapped REST endpoints enforce them, so a read-only grant can search and read but gets `403 insufficient_scope` from `create_page` and `update_page`.

A normal Docmost session token in `Authorization: Bearer` still works too, which is handy for curl.

## Setup

Nothing to configure on the server: the OAuth endpoints are always on, and clients register themselves. What you need is a URL the client can reach on which the consent page, `/api` and `/mcp` share one origin.

### Production (built app)

The Nest server serves the web client itself, so everything is already on `APP_URL`. Give the client `https://<your-docmost>/mcp` and skip to the client steps below.

### Local development

In dev the web client runs on Vite and the API on Nest, so go through Vite, which proxies `/api`, `/mcp` and `/.well-known` to the backend.

1. Start both as usual with `pnpm dev`. This guide assumes Vite on port 5600.
2. For claude.ai or Claude Desktop, which connect from Anthropic's servers, expose Vite with a tunnel:

   ```bash
   cloudflared tunnel --url http://localhost:5600
   ```

   Claude Code connects from your machine, so it can use `http://localhost:5600` and needs no tunnel.
3. Set `APP_URL` in `.env` to the URL the client will use, the tunnel URL or `http://localhost:5600`. The OAuth metadata, token issuer and audience are built from it, and a mismatch makes clients reject the flow. Restart the backend.

### Claude.ai and Claude Desktop

1. Settings, Connectors, Add custom connector.
2. Name it, enter `<APP_URL>/mcp`, leave the OAuth client id and secret empty, save.
3. Click Connect. claude.ai registers itself, then opens the Docmost consent page. Log in if asked, tick the scopes, Approve.
4. You are sent back to claude.ai and the connector shows as connected. Tokens refresh on their own for 30 days.

### Claude Code

```bash
claude mcp add --transport http docmost <APP_URL>/mcp
```

Then run `/mcp` inside Claude Code and pick Authenticate. The browser opens the consent page, and the token is stored locally.

### Revoking access

A grant can be killed from the database until a settings page exists:

```sql
update oauth_grants set revoked_at = now() where id = '<grant id>';
```

Every access and refresh token under that grant stops working on the next request.

## Smoke test

```bash
curl -s http://localhost:3000/mcp \
  -H "Authorization: Bearer <authToken>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_pages","arguments":{"query":"hello"}}}'
```

A missing or bad token returns `401`. A tool failure comes back as a tool error carrying the REST status and message, for example `/api/pages/info failed with 404: Page not found`.

## Limits

- Single workspace: dynamic clients are attached to the first workspace, which is what a self-hosted install has.
- Stateless: one MCP server instance per request, no sessions, no server-to-client notifications.
- Adding a tool is one entry in `TOOLS` in `mcp.service.ts`: name, description, zod input, REST path, and a `pick` that trims the response.
