import {
  All,
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Injectable,
  Req,
  Res,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { McpService } from './mcp.service';
import { OAuthScope } from '../../common/decorators/oauth-scope.decorator';
import { EnvironmentService } from '../../integrations/environment/environment.service';

// MCP clients discover the OAuth server from the 401's WWW-Authenticate header.
@Injectable()
@Catch(UnauthorizedException)
export class McpUnauthorizedFilter implements ExceptionFilter {
  constructor(private env: EnvironmentService) {}

  catch(_: UnauthorizedException, host: ArgumentsHost) {
    const base = this.env.getAppUrl().replace(/\/$/, '');
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .header(
        'WWW-Authenticate',
        `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      )
      .status(401)
      .send({ error: 'unauthorized' });
  }
}

@Controller('mcp')
@UseGuards(JwtAuthGuard)
@UseFilters(McpUnauthorizedFilter)
export class McpController {
  constructor(private mcpService: McpService) {}

  // The MCP SDK speaks web-standard Request/Response, so bridge Fastify to it.
  // scopes are enforced per tool by the wrapped REST endpoint
  @OAuthScope('read')
  @All()
  async handle(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string' && key !== 'content-length') {
        headers.set(key, value);
      }
    }
    const request = new Request(`http://${req.host}${req.url}`, {
      method: req.method,
      headers,
      body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await this.mcpService
      .createServer(req.headers.authorization)
      .connect(transport);
    const response = await transport.handleRequest(request);

    reply.hijack();
    reply.raw.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) reply.raw.write(chunk);
    }
    reply.raw.end();
  }
}
