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

## Connect from claude.ai

claude.ai needs a public HTTPS URL and all three of the consent page, the API and `/mcp` must be on that one origin. For a local dev instance, point the tunnel at the Vite dev server, which proxies `/api`, `/mcp` and `/.well-known` to the backend:

```bash
cloudflared tunnel --url http://localhost:5600
```

Set `APP_URL` in `.env` to the tunnel URL, since the OAuth metadata is built from it, then restart the backend. In claude.ai go to Settings, Connectors, Add custom connector, and enter:

```
https://<your-tunnel>.trycloudflare.com/mcp
```

Leave the OAuth client fields empty. claude.ai registers itself, sends you to the Docmost consent page, and stores the tokens.

## Connect from Claude Code or Claude Desktop

Both run the same OAuth flow by themselves:

```bash
claude mcp add --transport http docmost http://localhost:3000/mcp
```

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
