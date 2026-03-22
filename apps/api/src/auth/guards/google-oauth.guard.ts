import * as url from 'url';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Google OAuth guard for Fastify
 *
 * Initiates the Google OAuth flow when applied to a route.
 * Used on both the initial OAuth endpoint and the callback endpoint.
 *
 * Note: Passport OAuth strategies expect Express-style request/response objects.
 * This guard overrides getRequest/getResponse to return raw Node.js http objects
 * that Passport can work with. After authentication, it copies the user back
 * to the Fastify request so controllers can access req.user normally.
 *
 * Query parsing: Fastify's raw IncomingMessage only exposes req.url as an
 * unparsed string. passport-oauth2 checks req.query.code to detect the OAuth
 * callback; without a parsed query object it treats every callback request as a
 * new auth initiation. We parse and attach req.query here when it is absent.
 */
@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  getRequest(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const raw = request.raw || request;
    // Passport expects Express-style req.query (parsed query string object).
    // Fastify's raw IncomingMessage only has req.url (unparsed string).
    // Parse and attach query so passport-oauth2 can find the authorization code.
    if (!raw.query && raw.url) {
      const parsed = url.parse(raw.url, true);
      raw.query = parsed.query;
    }
    return raw;
  }

  getResponse(context: ExecutionContext) {
    const response = context.switchToHttp().getResponse();
    // Return the raw Node.js ServerResponse for Passport compatibility
    return response.raw || response;
  }

  handleRequest<TUser = unknown>(
    err: Error | null,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw err || new Error('Authentication failed');
    }

    // Copy user from raw request to Fastify request so controllers can access it
    const fastifyRequest = context.switchToHttp().getRequest();
    fastifyRequest.user = user;

    return user;
  }
}
