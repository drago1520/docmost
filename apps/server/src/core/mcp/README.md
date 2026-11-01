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

The endpoint accepts a normal Docmost session token, either as `Authorization: Bearer <token>` or as `?token=<token>` in the URL. The query form exists because claude.ai custom connectors cannot send headers.

To get a token, log in to Docmost in your browser, open DevTools, go to Application, then Cookies, and copy the value of `authToken`. It is valid for 30 days and logging out revokes it.

## Connect from claude.ai

claude.ai needs a public HTTPS URL. For a local instance, tunnel the backend port:

```bash
cloudflared tunnel --url http://localhost:3000
```

Then in claude.ai: Settings, Connectors, Add custom connector, no OAuth, with this URL:

```
https://<your-tunnel>.trycloudflare.com/mcp?token=<authToken>
```

## Connect from Claude Code or Claude Desktop

Both can send headers, so keep the token out of the URL:

```bash
claude mcp add --transport http docmost http://localhost:3000/mcp \
  --header "Authorization: Bearer <authToken>"
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

- No OAuth. Anyone holding the token has your full session, so do not put a production token in a URL that gets logged.
- Stateless: one MCP server instance per request, no sessions, no server-to-client notifications.
- Adding a tool is one entry in `TOOLS` in `mcp.service.ts`: name, description, zod input, REST path, and a `pick` that trims the response.
