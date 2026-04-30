/**
 * @fileoverview OpenAPI documentation routes
 */

import { Hono } from 'hono';
import { swaggerUI } from '@hono/swagger-ui';
import { apiReference } from '@scalar/hono-api-reference';
import type { Bindings } from '../index';

const openapiRouter = new Hono<{ Bindings: Bindings }>();

// OpenAPI specification
const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Core Template API',
    version: '1.0.0',
    description: 'API documentation for Cloudflare Workers AI powered application',
  },
  servers: [
    {
      url: '/api',
      description: 'API Server',
    },
  ],
  paths: {
    '/auth/login': {
      post: {
        summary: 'User login',
        tags: ['Authentication'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { type: 'object' },
                    token: { type: 'string' },
                    expiresAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/dashboard/metrics': {
      get: {
        summary: 'Get dashboard metrics',
        tags: ['Dashboard'],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'category',
            in: 'query',
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 100 },
          },
        ],
        responses: {
          '200': {
            description: 'Metrics retrieved successfully',
          },
        },
      },
    },
    '/threads': {
      get: {
        summary: 'List user threads',
        tags: ['AI Threads'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Threads retrieved successfully',
          },
        },
      },
      post: {
        summary: 'Create a new thread',
        tags: ['AI Threads'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string', minLength: 1 },
                },
                required: ['title'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Thread created successfully',
          },
        },
      },
    },
    '/health': {
      get: {
        summary: 'System health check',
        tags: ['Health'],
        responses: {
          '200': {
            description: 'System is healthy',
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
      },
    },
  },
};

// GET /openapi.json
openapiRouter.get('/openapi.json', (c) => {
  return c.json(openApiSpec);
});

// GET /swagger
openapiRouter.get('/swagger', swaggerUI({ url: '/openapi.json' }));

// GET /scalar
openapiRouter.get(
  '/scalar',
  apiReference({
    spec: {
      url: '/openapi.json',
    },
    theme: 'dark',
  })
);

// GET /docs - redirect to scalar
openapiRouter.get('/docs', (c) => {
  return c.redirect('/scalar');
});

export { openapiRouter };
