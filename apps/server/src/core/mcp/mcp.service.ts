import { Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

// Every tool is a thin wrapper over one REST endpoint. The call goes through
// Fastify in-process, so the endpoint's guard, validation, OAuth scope and
// audit logging apply exactly as they do for the web client.
const TOOLS = [
  {
    name: 'list_spaces',
    description: 'List the spaces the user belongs to. Needed for create_page.',
    input: z.object({}),
    path: '/api/spaces',
    body: () => ({ limit: 100 }),
    pick: (d: any) =>
      d.items.map((s: any) => ({ id: s.id, name: s.name, slug: s.slug })),
  },
  {
    name: 'search_pages',
    description:
      'Full-text search over pages. Returns page ids for read_page and update_page.',
    input: z.object({ query: z.string(), spaceId: z.string().optional() }),
    path: '/api/search',
    body: (a: any) => ({ ...a, limit: 10 }),
    pick: (d: any) =>
      d.items.map((p: any) => ({
        id: p.id,
        slugId: p.slugId,
        title: p.title,
        rank: p.rank,
        space: p.space?.name,
        updatedAt: p.updatedAt,
        snippet: p.highlight?.replace(/<\/?b>/g, ''),
      })),
  },
  {
    name: 'read_page',
    description: 'Read a page as markdown.',
    input: z.object({ pageId: z.string() }),
    path: '/api/pages/info',
    body: (a: any) => ({ ...a, format: 'markdown' }),
    pick: (d: any) => ({
      id: d.id,
      slugId: d.slugId,
      title: d.title,
      spaceId: d.spaceId,
      parentPageId: d.parentPageId,
      updatedAt: d.updatedAt,
      content: d.content,
    }),
  },
  {
    name: 'create_page',
    description: 'Create a page from markdown. Use list_spaces to get a spaceId.',
    input: z.object({
      spaceId: z.string(),
      title: z.string(),
      content: z.string(),
      parentPageId: z.string().optional(),
    }),
    path: '/api/pages/create',
    body: (a: any) => ({ ...a, format: 'markdown' }),
    pick: (d: any) => ({ id: d.id, slugId: d.slugId, title: d.title }),
  },
  {
    name: 'update_page',
    description:
      'Replace, append or prepend markdown content on a page, and/or rename it.',
    input: z.object({
      pageId: z.string(),
      content: z.string().optional(),
      operation: z.enum(['replace', 'append', 'prepend']).default('replace'),
      title: z.string().optional(),
    }),
    path: '/api/pages/update',
    body: (a: any) => ({ ...a, format: 'markdown' }),
    pick: (d: any) => ({ id: d.id, slugId: d.slugId, title: d.title }),
  },
];

@Injectable()
export class McpService {
  constructor(private adapterHost: HttpAdapterHost) {}

  createServer(authorization: string): McpServer {
    const server = new McpServer({ name: 'docmost', version: '1.0.0' });
    const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();

    for (const tool of TOOLS) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.input },
        async (args: any) => {
          const res = await fastify.inject({
            method: 'POST',
            url: tool.path,
            headers: { authorization, 'content-type': 'application/json' },
            payload: tool.body(args),
          });
          const json = res.json();
          if (res.statusCode >= 400) {
            throw new Error(
              `${tool.path} failed with ${res.statusCode}: ${json.message ?? res.body}`,
            );
          }
          const out = tool.pick(json.data);
          return {
            content: [
              {
                type: 'text' as const,
                text: typeof out === 'string' ? out : JSON.stringify(out, null, 2),
              },
            ],
          };
        },
      );
    }
    return server;
  }
}
