# Docmost MCP server

An MCP server at `/mcp`, built into the Nest app. Each tool wraps one REST endpoint, so your normal permissions apply. Clients authenticate with OAuth and register themselves, so there is nothing to configure on the server.

## Tools

| Tool | Input |
|---|---|
| `list_spaces` | none |
| `search_pages` | `query`, optional `spaceId`, optional `mode` (defaults to `scatteredPrefix`; see `SEARCH_MODE_HELP`) |
| `read_page` | `pageId` |
| `page_outline` | `pageId`, returns every heading with a deep link |
| `create_page` | `spaceId`, `title`, `content` (markdown), optional `parentPageId` |
| `update_page` | `pageId`, optional `content` (markdown), `operation` (`replace`, `append`, `prepend`), optional `title` |

Scopes are `read` and `write`. A read-only grant can search and read but not create or update.

## Setup

The consent page, `/api` and `/mcp` must share one URL, and `APP_URL` in `.env` must be that URL.

**Production.** The server already serves everything on `APP_URL`. Use `<APP_URL>/mcp`.

**Local development.** Go through Vite, which proxies the API and `/mcp` to the backend.

1. `pnpm dev`. Vite is on port 5600 in this guide.
2. Claude.ai and Claude Desktop connect from Anthropic's servers, so expose Vite:

   ```bash
   cloudflared tunnel --url http://localhost:5600
   ```

   Claude Code runs on your machine and can use `http://localhost:5600` directly.
3. Set `APP_URL` to that URL and restart the backend.

## Connect

**Claude.ai and Claude Desktop.** Settings, Connectors, Add custom connector. Enter `<APP_URL>/mcp`, leave the OAuth fields empty, save, Connect. Approve on the Docmost consent page.

**Claude Code.**

```bash
claude mcp add --transport http docmost <APP_URL>/mcp
```

Then `/mcp`, Authenticate, approve in the browser.

## Revoke

```sql
update oauth_grants set revoked_at = now() where id = '<grant id>';
```

All tokens under that grant stop working immediately.

## Adding a tool

One entry in `TOOLS` in `mcp.service.ts`: name, description, zod input, REST path, and a `pick` that trims the response.
