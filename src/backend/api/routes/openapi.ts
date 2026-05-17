/**
 * @fileoverview OpenAPI documentation routes
 */

import { swaggerUI } from "@hono/swagger-ui";
import { apiReference } from "@scalar/hono-api-reference";
import { Hono } from "hono";



const openapiRouter = new Hono<{ Bindings: Env }>();

// OpenAPI specification
const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Remodel Mood Board API",
    version: "1.0.0",
    description: "API documentation for Remodel Mood Board - AI-powered image management and mood board creation for home renovation projects",
  },
  servers: [
    {
      url: "/api",
      description: "API Server",
    },
    {
      url: "/",
      description: "Root Server (for /context endpoint)",
    },
  ],
  paths: {
    "/auth/login": {
      post: {
        summary: "User login",
        tags: ["Authentication"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 8 },
                },
                required: ["email", "password"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Login successful",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    user: { type: "object" },
                    token: { type: "string" },
                    expiresAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/dashboard/metrics": {
      get: {
        summary: "Get dashboard metrics",
        tags: ["Dashboard"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "category",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 100 },
          },
        ],
        responses: {
          "200": {
            description: "Metrics retrieved successfully",
          },
        },
      },
    },
    "/threads": {
      get: {
        summary: "List user threads",
        tags: ["AI Threads"],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Threads retrieved successfully",
          },
        },
      },
      post: {
        summary: "Create a new thread",
        tags: ["AI Threads"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string", minLength: 1 },
                },
                required: ["title"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Thread created successfully",
          },
        },
      },
    },
    "/health": {
      get: {
        summary: "System health check",
        tags: ["Health"],
        responses: {
          "200": {
            description: "System is healthy",
          },
        },
      },
    },
    "/context": {
      get: {
        operationId: "getApplicationContext",
        summary: "Get application context information",
        tags: ["System"],
        responses: {
          "200": {
            description: "Application context retrieved successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    application: { type: "string", example: "Remodel Mood Board" },
                    description: { type: "string" },
                    version: { type: "string", example: "1.0.0" },
                    features: {
                      type: "array",
                      items: { type: "string" },
                    },
                    infrastructure: {
                      type: "object",
                      properties: {
                        platform: { type: "string", example: "Cloudflare Workers" },
                        database: { type: "string", example: "D1 (SQLite)" },
                        storage: { type: "string", example: "R2 Bucket" },
                        ai: { type: "string", example: "Workers AI" },
                        vector: { type: "string", example: "Vectorize Index" },
                        cache: { type: "string", example: "KV Namespace" },
                      },
                    },
                    endpoints: {
                      type: "object",
                      properties: {
                        api: { type: "string", example: "/api" },
                        docs: { type: "string", example: "/docs" },
                        apiDocs: { type: "string", example: "/api-docs" },
                        openapi: { type: "string", example: "/openapi.json" },
                        swagger: { type: "string", example: "/swagger" },
                        scalar: { type: "string", example: "/scalar" },
                        health: { type: "string", example: "/api/health" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/estimate-statuses": {
      get: {
        operationId: "listEstimateStatuses",
        summary: "List estimate status options",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Estimate statuses retrieved",
          },
        },
      },
    },
    "/estimate-companies": {
      get: {
        operationId: "listEstimateCompanies",
        summary: "List estimate companies",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Estimate companies retrieved",
          },
        },
      },
      post: {
        operationId: "createEstimateCompany",
        summary: "Create estimate company",
        tags: ["Estimates"],
        responses: {
          "201": {
            description: "Estimate company created",
          },
        },
      },
    },
    "/estimate-contacts": {
      get: {
        operationId: "listEstimateContacts",
        summary: "List estimate company contacts",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Estimate contacts retrieved",
          },
        },
      },
      post: {
        operationId: "createEstimateContact",
        summary: "Create estimate company contact",
        tags: ["Estimates"],
        responses: {
          "201": {
            description: "Estimate contact created",
          },
        },
      },
    },
    "/estimates": {
      get: {
        operationId: "listEstimates",
        summary: "List estimates with latest revisions",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Estimates retrieved",
          },
        },
      },
    },
    "/estimates/drafts": {
      post: {
        operationId: "createEstimateDraft",
        summary: "Create estimate draft",
        tags: ["Estimates"],
        responses: {
          "201": {
            description: "Estimate draft created",
          },
        },
      },
    },
    "/estimates/drafts/{id}/autosave": {
      patch: {
        operationId: "autosaveEstimateDraft",
        summary: "Autosave estimate draft wizard state",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Estimate draft autosaved",
          },
        },
      },
    },
    "/estimates/intake/source": {
      post: {
        operationId: "processEstimateSource",
        summary: "Process source input and run structured extraction",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Source processed",
          },
        },
      },
    },
    "/estimates/intake/extract": {
      post: {
        operationId: "extractEstimateStructuredData",
        summary: "Run structured extraction from estimate source text",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Estimate extraction completed",
          },
        },
      },
    },
    "/estimates/intake/confirm": {
      post: {
        operationId: "confirmEstimateIntake",
        summary: "Confirm intake details and save/submit revision",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Estimate intake confirmed",
          },
        },
      },
    },
    "/estimates/{id}/revisions": {
      get: {
        operationId: "listEstimateRevisions",
        summary: "List all estimate revisions",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Estimate revisions retrieved",
          },
        },
      },
      post: {
        operationId: "createEstimateRevision",
        summary: "Create a new estimate revision",
        tags: ["Estimates"],
        responses: {
          "201": {
            description: "Estimate revision created",
          },
        },
      },
    },
    "/estimates/{id}/revisions/{revisionId}": {
      get: {
        operationId: "getEstimateRevisionDetail",
        summary: "Get estimate revision details with line items and sources",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Estimate revision detail retrieved",
          },
        },
      },
    },
    "/estimate-companies/{id}": {
      patch: {
        operationId: "updateEstimateCompany",
        summary: "Update estimate company details",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Estimate company updated",
          },
        },
      },
    },
    "/estimate-contacts/{id}": {
      patch: {
        operationId: "updateEstimateContact",
        summary: "Update estimate company contact details",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Estimate contact updated",
          },
        },
      },
    },
    "/estimate-contacts/mapping-queue": {
      get: {
        operationId: "listEstimateContactMappingQueue",
        summary: "List contacts that need company mapping",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Mapping queue retrieved",
          },
        },
      },
    },
    "/estimate-contacts/resolve-by-domain": {
      post: {
        operationId: "resolveEstimateContactsByDomain",
        summary: "Resolve unmapped contacts using email domain matching",
        tags: ["Estimates"],
        responses: {
          "200": {
            description: "Domain mapping run completed",
          },
        },
      },
    },
    "/contracts": {
      get: {
        operationId: "listContracts",
        summary: "List contracts with latest revisions",
        tags: ["Contracts"],
        responses: {
          "200": {
            description: "Contracts retrieved",
          },
        },
      },
    },
    "/contracts/drafts/{id}/autosave": {
      patch: {
        operationId: "autosaveContractDraft",
        summary: "Autosave contract draft revision",
        tags: ["Contracts"],
        responses: {
          "200": {
            description: "Contract draft autosaved",
          },
        },
      },
    },
    "/contracts/{id}/revisions": {
      get: {
        operationId: "listContractRevisions",
        summary: "List contract revisions",
        tags: ["Contracts"],
        responses: {
          "200": {
            description: "Contract revisions retrieved",
          },
        },
      },
      post: {
        operationId: "createContractRevision",
        summary: "Create contract revision",
        tags: ["Contracts"],
        responses: {
          "201": {
            description: "Contract revision created",
          },
        },
      },
    },
    "/contracts/{id}/risks": {
      get: {
        operationId: "getContractRisks",
        summary: "Get latest contract risk findings",
        tags: ["Contracts"],
        responses: {
          "200": {
            description: "Contract risks retrieved",
          },
        },
      },
    },
    "/contracts/{id}/payment-milestones": {
      get: {
        operationId: "getContractPaymentMilestones",
        summary: "Get latest contract payment milestones",
        tags: ["Contracts"],
        responses: {
          "200": {
            description: "Contract payment milestones retrieved",
          },
        },
      },
    },
    "/contracts/{id}/revisions/{revisionId}/documents": {
      post: {
        operationId: "ingestContractDocument",
        summary: "Ingest and extract a contract source document",
        tags: ["Contracts"],
        responses: {
          "200": {
            description: "Contract source ingested",
          },
        },
      },
    },
    "/contracts/{id}/revisions/{revisionId}/analyze": {
      post: {
        operationId: "analyzeContractRevision",
        summary: "Analyze contract revision for risk and negotiation findings",
        tags: ["Contracts"],
        responses: {
          "200": {
            description: "Contract analysis completed",
          },
        },
      },
    },
    "/contracts/drafts": {
      post: {
        operationId: "createContractDraft",
        summary: "Create contract draft",
        tags: ["Contracts"],
        responses: {
          "201": {
            description: "Contract draft created",
          },
        },
      },
    },
    "/budget-tracker/items": {
      get: {
        operationId: "listBudgetTrackerItems",
        summary: "List active budget tracker items",
        tags: ["Budget Tracker"],
        responses: {
          "200": {
            description: "Budget tracker items retrieved",
          },
        },
      },
      post: {
        operationId: "createBudgetTrackerItem",
        summary: "Create a new budget tracker item",
        tags: ["Budget Tracker"],
        responses: {
          "201": {
            description: "Budget tracker item created",
          },
        },
      },
    },
    "/budget-tracker/overview": {
      get: {
        operationId: "getBudgetTrackerOverview",
        summary: "Get budget tracker overview with planned, actual, and fund status",
        tags: ["Budget Tracker"],
        responses: {
          "200": {
            description: "Budget tracker overview retrieved",
          },
        },
      },
    },
    "/budget-tracker/project-info": {
      get: {
        operationId: "listBudgetProjectInfo",
        summary: "List budget project information fields",
        tags: ["Budget Tracker"],
        responses: {
          "200": {
            description: "Project info retrieved",
          },
        },
      },
      put: {
        operationId: "upsertBudgetProjectInfo",
        summary: "Upsert budget project information fields",
        tags: ["Budget Tracker"],
        responses: {
          "200": {
            description: "Project info upserted",
          },
        },
      },
    },
    "/budget-tracker/financial-status": {
      get: {
        operationId: "getBudgetFinancialStatus",
        summary: "Get budget financial status summary and accounts",
        tags: ["Budget Tracker"],
        responses: {
          "200": {
            description: "Financial status retrieved",
          },
        },
      },
    },
    "/budget-tracker/financial-accounts": {
      put: {
        operationId: "upsertBudgetFinancialAccounts",
        summary: "Upsert budget funding accounts",
        tags: ["Budget Tracker"],
        responses: {
          "200": {
            description: "Financial accounts upserted",
          },
        },
      },
    },
    "/budget-tracker/expenses": {
      get: {
        operationId: "listBudgetExpenses",
        summary: "List active budget itemized expenses",
        tags: ["Budget Tracker"],
        responses: {
          "200": {
            description: "Expenses retrieved",
          },
        },
      },
      post: {
        operationId: "createBudgetExpense",
        summary: "Create a new budget expense entry",
        tags: ["Budget Tracker"],
        responses: {
          "201": {
            description: "Expense created",
          },
        },
      },
    },
    "/budget-tracker/expenses/{id}": {
      patch: {
        operationId: "reviseBudgetExpense",
        summary: "Create a revision for an active budget expense entry",
        tags: ["Budget Tracker"],
        responses: {
          "200": {
            description: "Expense revised",
          },
        },
      },
    },
    "/budget-tracker/variance-options": {
      get: {
        operationId: "getBudgetVarianceOptions",
        summary: "Get variance option comparison totals",
        tags: ["Budget Tracker"],
        responses: {
          "200": {
            description: "Variance options retrieved",
          },
        },
      },
    },
    "/budget-tracker/items/{trackId}/revisions": {
      get: {
        operationId: "listBudgetTrackerItemRevisions",
        summary: "List revisions for a budget tracker track",
        tags: ["Budget Tracker"],
        responses: {
          "200": {
            description: "Budget tracker revisions retrieved",
          },
        },
      },
    },
    "/budget-tracker/items/{id}": {
      patch: {
        operationId: "reviseBudgetTrackerItem",
        summary: "Create a revision for an active budget tracker item",
        tags: ["Budget Tracker"],
        responses: {
          "200": {
            description: "Budget tracker item revised",
          },
        },
      },
    },
    "/budget-tracker/bootstrap-homeowner-plan": {
      post: {
        operationId: "bootstrapHomeownerBudgetPlan",
        summary: "Seed homeowner remodel budget starter rows",
        tags: ["Budget Tracker"],
        responses: {
          "200": {
            description: "Homeowner plan seeded",
          },
        },
      },
    },
    "/sync/google-sheets/template": {
      get: {
        operationId: "getGoogleSheetsTemplate",
        summary: "Get mirrored Google Sheets tab template metadata",
        tags: ["Sync"],
        responses: {
          "200": {
            description: "Template metadata retrieved",
          },
        },
      },
    },
    "/sync/google-sheets/status": {
      get: {
        operationId: "getGoogleSheetsSyncStatus",
        summary: "Get Google Sheets sync status",
        tags: ["Sync"],
        responses: {
          "200": {
            description: "Sync status retrieved",
          },
        },
      },
    },
    "/sync/google-sheets/pull": {
      post: {
        operationId: "requestGoogleSheetsPull",
        summary: "Request Google Sheets pull sync",
        tags: ["Sync"],
        responses: {
          "200": {
            description: "Pull sync requested",
          },
        },
      },
    },
    "/sync/google-sheets/push": {
      post: {
        operationId: "requestGoogleSheetsPush",
        summary: "Request Google Sheets push sync",
        tags: ["Sync"],
        responses: {
          "200": {
            description: "Push sync requested",
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
      },
    },
  },
};

// GET /openapi.json
openapiRouter.get("/openapi.json", (c) => {
  return c.json(openApiSpec);
});

// GET /swagger
openapiRouter.get("/swagger", swaggerUI({ url: "/openapi.json" }));

// GET /scalar
openapiRouter.get(
  "/scalar",
  apiReference({
    // @ts-expect-error - Scalar types are not resolving properly due to missing client-side-rendering types
    spec: {
      url: "/openapi.json",
    },
    theme: "moon",
  }),
);

// GET /api-docs - redirect to scalar
openapiRouter.get("/api-docs", (c) => {
  return c.redirect("/scalar");
});

// GET /context - application context information
openapiRouter.get("/context", (c) => {
  return c.json({
    application: "Remodel Mood Board",
    description: "AI-powered image management and mood board creation for home renovation projects",
    version: "1.0.0",
    features: [
      "AI Image Analysis with Workers AI",
      "Mood Board Creation and Management",
      "Photo Review and Tagging",
      "Listing Photos with AI Editing",
      "Semantic Search with Vectorize",
    ],
    infrastructure: {
      platform: "Cloudflare Workers",
      database: "D1 (SQLite)",
      storage: "R2 Bucket",
      ai: "Workers AI",
      vector: "Vectorize Index",
      cache: "KV Namespace",
    },
    endpoints: {
      api: "/api",
      docs: "/docs",
      apiDocs: "/api-docs",
      openapi: "/openapi.json",
      swagger: "/swagger",
      scalar: "/scalar",
      health: "/api/health",
    },
  });
});

export { openapiRouter };
