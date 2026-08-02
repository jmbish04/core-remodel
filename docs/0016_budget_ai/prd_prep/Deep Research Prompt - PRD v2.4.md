\[  
  {  
    "taskId": "T-001",  
    "title": "Configure Backend Wrangler Settings for Agents & DB",  
    "description": "Update \`wrangler.jsonc\` to explicitly define bindings for the D1 database, AI Gateway (for Kimi/GPT-OSS models), Cloudflare Workflows (\`DeepSourcingWorkflow\`), and Durable Objects namespaces (for \`BidReconciler\`).",  
    "epic": "Infrastructure",  
    "targetFilePath": "wrangler.jsonc",  
    "cloudflare\_services": \["D1", "Durable Objects", "Workflows", "Workers AI"\],  
    "dependencies": \[\]  
  },  
  {  
    "taskId": "T-002",  
    "title": "Configure Drizzle ORM",  
    "description": "Ensure \`drizzle.config.ts\` points to the correct schema paths (\`src/backend/db/schema/\*\*/\*.ts\`) and uses the \`sqlite\` dialect with Cloudflare D1 local/remote configurations.",  
    "epic": "Data Layer",  
    "targetFilePath": "drizzle.config.ts",  
    "cloudflare\_services": \["D1"\],  
    "dependencies": \[\]  
  },  
  {  
    "taskId": "T-003",  
    "title": "Define Drizzle Schema: Truth Table (Budget Items)",  
    "description": "Implement the \`budget\_items\` table in Drizzle. Include \`id\`, \`project\_id\`, \`work\_item\`, \`category\`, \`max\_unit\_price\` (real), \`quantity\` (real), \`status\` (enum), and \`google\_sheet\_row\_id\`. Include timestamp triggers.",  
    "epic": "Data Layer",  
    "targetFilePath": "src/backend/db/schema/home/budget\_tracking.ts",  
    "cloudflare\_services": \["D1"\],  
    "dependencies": \["T-002"\]  
  },  
  {  
    "taskId": "T-004",  
    "title": "Define Drizzle Schema: Sourced Materials",  
    "description": "Implement the \`sourced\_materials\` table with a cascading foreign key to \`budget\_items.id\`. Include \`vendor\_name\`, \`quoted\_unit\_price\` (real), and \`is\_selected\` (boolean).",  
    "epic": "Data Layer",  
    "targetFilePath": "src/backend/db/schema/home/budget\_tracking.ts",  
    "cloudflare\_services": \["D1"\],  
    "dependencies": \["T-003"\]  
  },  
  {  
    "taskId": "T-005",  
    "title": "Define Drizzle Schema: Sync Revision Log",  
    "description": "Implement the \`sync\_revision\_log\` table for LWW conflict resolution. Fields: \`id\`, \`entity\_id\`, \`entity\_type\`, \`mutation\_type\`, \`payload\` (JSON text), \`source\`, \`applied\_at\`, and \`hash\` (SHA-256).",  
    "epic": "Data Layer",  
    "targetFilePath": "src/backend/db/schema/home/sync\_runs.ts",  
    "cloudflare\_services": \["D1"\],  
    "dependencies": \["T-003"\]  
  },  
  {  
    "taskId": "T-006",  
    "title": "Implement Drizzle-Zod Schemas",  
    "description": "Use \`drizzle-zod\`'s \`createInsertSchema\` and \`createSelectSchema\` for \`budget\_items\` and \`sync\_revision\_log\`. Export these Zod objects for use in Hono payload validation.",  
    "epic": "Data Layer",  
    "targetFilePath": "src/backend/api/routes/measurements.schemas.ts",  
    "cloudflare\_services": \["D1"\],  
    "dependencies": \["T-003", "T-004", "T-005"\]  
  },  
  {  
    "taskId": "T-007",  
    "title": "Generate D1 Migrations",  
    "description": "Run \`drizzle-kit generate\` to create the SQL migration file for the newly defined budget tracking and sync log tables.",  
    "epic": "Data Layer",  
    "targetFilePath": "drizzle/0074\_budget\_and\_sync\_tables.sql",  
    "cloudflare\_services": \["D1"\],  
    "dependencies": \["T-006"\]  
  },  
  {  
    "taskId": "T-008",  
    "title": "Implement Hono API: Budget Data Retrieval",  
    "description": "Create a GET endpoint \`/api/budget/:projectId\` in Hono to fetch joined data of \`budget\_items\` and their \`sourced\_materials\`. Calculate variance dynamically in the SQL select.",  
    "epic": "Backend API",  
    "targetFilePath": "src/backend/api/routes/budget-data.ts",  
    "cloudflare\_services": \["D1"\],  
    "dependencies": \["T-007"\]  
  },  
  {  
    "taskId": "T-009",  
    "title": "Implement Gap Analyzer Deterministic Utility",  
    "description": "Write a utility function \`detectScopeGaps(projectId)\` that runs a D1 query analyzing MasterFormat structural dependencies (e.g., verifying Div 07 exists if Div 09 Tile exists).",  
    "epic": "Backend API",  
    "targetFilePath": "src/backend/services/dbi/gap-analyzer.ts",  
    "cloudflare\_services": \["D1"\],  
    "dependencies": \["T-008"\]  
  },  
  {  
    "taskId": "T-010",  
    "title": "Implement Google Sheets Webhook Receiver",  
    "description": "Create a POST endpoint \`/api/sync/sheets\` in Hono. Validate the incoming JSON payload (containing \`sheetRowId\`, \`timestamp\`, \`hash\`, \`updatedFields\`) using the previously generated Drizzle-Zod schemas.",  
    "epic": "Backend API",  
    "targetFilePath": "src/backend/api/routes/sync.ts",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \["T-006"\]  
  },  
  {  
    "taskId": "T-011",  
    "title": "Implement Last-Write-Wins Conflict Resolver",  
    "description": "In the webhook handler, query \`sync\_revision\_log\` to compare timestamps. Implement the LWW logic with D1 bias: reject if D1 timestamp is newer, accept and update D1 if Sheet is genuinely newer.",  
    "epic": "Data Sync",  
    "targetFilePath": "src/backend/api/routes/sync.ts",  
    "cloudflare\_services": \["D1"\],  
    "dependencies": \["T-010"\]  
  },  
  {  
    "taskId": "T-012",  
    "title": "Implement D1 Transaction for Sync Logs",  
    "description": "Wrap the webhook's D1 mutation in a \`db.transaction\`. Simultaneously execute the \`budget\_items\` update and insert the payload snapshot into \`sync\_revision\_log\` to guarantee atomic tracking.",  
    "epic": "Data Sync",  
    "targetFilePath": "src/backend/api/routes/sync.ts",  
    "cloudflare\_services": \["D1"\],  
    "dependencies": \["T-011"\]  
  },  
  {  
    "taskId": "T-013",  
    "title": "Scaffold BidReconciler Agent Class",  
    "description": "Create \`BidReconciler\` extending \`@cloudflare/think\`. Set \`getModel()\` to use \`@cf/moonshotai/kimi-k2.7\` via AI Gateway.",  
    "epic": "AI Agents",  
    "targetFilePath": "src/backend/ai/agents/BidReconciler/index.ts",  
    "cloudflare\_services": \["Workers AI", "Durable Objects"\],  
    "dependencies": \[\]  
  },  
  {  
    "taskId": "T-014",  
    "title": "Define BidReconciler System Prompt",  
    "description": "Implement \`getSystemPrompt()\` in \`BidReconciler\`. Embed the persona constraints, CSI MasterFormat rules, and explicit instructions to trigger the \`requestManualMapping\` tool when confidence is low.",  
    "epic": "AI Agents",  
    "targetFilePath": "src/backend/ai/agents/BidReconciler/prompts.ts",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \["T-013"\]  
  },  
  {  
    "taskId": "T-015",  
    "title": "Implement Chat Memory SQLite Isolation",  
    "description": "Add a method \`trackReconciliationState\` to \`BidReconciler\` that utilizes \`this.sql\` to execute synchronous SQLite operations within the Durable Object for tracking in-flight bid analysis.",  
    "epic": "AI Agents",  
    "targetFilePath": "src/backend/ai/agents/BidReconciler/index.ts",  
    "cloudflare\_services": \["Durable Objects"\],  
    "dependencies": \["T-013"\]  
  },  
  {  
    "taskId": "T-016",  
    "title": "Define RequestManualMapping Tool",  
    "description": "Implement the \`requestManualMapping\` tool definition in the agent using \`zod\`. Configure it to pause generative flow and return a structured JSON response to trigger the frontend DND interface.",  
    "epic": "AI Agents",  
    "targetFilePath": "src/backend/ai/agents/BidReconciler/methods/chat-tools.ts",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \["T-014"\]  
  },  
  {  
    "taskId": "T-017",  
    "title": "Define TriggerApprovalWorkflow Tool",  
    "description": "Implement the \`triggerApprovalWorkflow\` tool in the agent. Execute \`this.runWorkflow('DEEP\_SOURCING\_WORKFLOW', args)\` to kick off the asynchronous Cloudflare Workflow.",  
    "epic": "AI Agents",  
    "targetFilePath": "src/backend/ai/agents/BidReconciler/methods/chat-tools.ts",  
    "cloudflare\_services": \["Workflows"\],  
    "dependencies": \["T-016"\]  
  },  
  {  
    "taskId": "T-018",  
    "title": "Scaffold DeepSourcingWorkflow Class",  
    "description": "Create the \`DeepSourcingWorkflow\` class extending \`ThinkWorkflow\`. Implement the \`run\` method signature taking \`WorkflowEvent\<SourcingParams\>\` and \`WorkflowStep\`.",  
    "epic": "AI Agents",  
    "targetFilePath": "src/backend/services/showroom-scrape-workflow.ts",  
    "cloudflare\_services": \["Workflows"\],  
    "dependencies": \[\]  
  },  
  {  
    "taskId": "T-019",  
    "title": "Implement Workflow Wait-For-Event (Approval Gate)",  
    "description": "Inside \`DeepSourcingWorkflow\`, implement a \`step.waitForEvent('bid-approval', { timeout: '48 hours' })\`. Add try/catch logic to handle timeouts gracefully and save rejection messages to the agent context.",  
    "epic": "AI Agents",  
    "targetFilePath": "src/backend/services/showroom-scrape-workflow.ts",  
    "cloudflare\_services": \["Workflows"\],  
    "dependencies": \["T-018"\]  
  },  
  {  
    "taskId": "T-020",  
    "title": "Implement Workflow MCP Scrape Step",  
    "description": "If \`approvalEvent.approved\` is true, implement a \`step.do('mcp-scrape')\` to execute an HTTP RPC call to the remote Cloudflare Browser Rendering MCP server to extract pricing data.",  
    "epic": "AI Agents",  
    "targetFilePath": "src/backend/services/showroom-scrape-workflow.ts",  
    "cloudflare\_services": \["Workflows"\],  
    "dependencies": \["T-019"\]  
  },  
  {  
    "taskId": "T-021",  
    "title": "Create Workflow Approval Webhook",  
    "description": "Add a POST endpoint \`/api/workflows/approve\` in Hono. Validate the \`instanceId\` payload and execute \`c.env.DEEP\_SOURCING\_WORKFLOW.get(instanceId).sendEvent(...)\` to unpause the workflow.",  
    "epic": "Backend API",  
    "targetFilePath": "src/backend/api/routes/workflows.ts",  
    "cloudflare\_services": \["Workflows"\],  
    "dependencies": \["T-020"\]  
  },  
  {  
    "taskId": "T-022",  
    "title": "Integrate @assistant-ui/react Context",  
    "description": "Create \`BidChatProvider.tsx\` wrapping the Next/React layout. Instantiate \`useAgent\` configured to target the \`BidReconciler\` DO and setup \`useAgentChat\` to manage WebSocket reconnection.",  
    "epic": "Frontend UI",  
    "targetFilePath": "src/frontend/components/bids/BidChatProvider.tsx",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \[\]  
  },  
  {  
    "taskId": "T-023",  
    "title": "Build BidChatUi Component",  
    "description": "Implement the core chat sidebar using \`\<Thread messages={messages} /\>\` from \`@assistant-ui/react\`. Pass the \`onSendMessage\` prop to handle user input submissions.",  
    "epic": "Frontend UI",  
    "targetFilePath": "src/frontend/components/bids/BidChatUi.tsx",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \["T-022"\]  
  },  
  {  
    "taskId": "T-024",  
    "title": "Implement Human-in-the-Loop Interceptor in UI",  
    "description": "Filter the chat \`messages\` array for \`tool-ui\` parts with state \`waiting-approval\`. Render inline Shadcn buttons to 'Approve' or 'Reject', linked to \`addToolApprovalResponse\`.",  
    "epic": "Frontend UI",  
    "targetFilePath": "src/frontend/components/bids/BidChatUi.tsx",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \["T-023"\]  
  },  
  {  
    "taskId": "T-025",  
    "title": "Initialize dnd-kit for Fallback Mapper",  
    "description": "Install \`@dnd-kit/core\`. Create the \`FallbackMapper\` component, wrapping it in \`\<DndContext\>\` with configured \`PointerSensor\` and \`TouchSensor\` for mobile readiness.",  
    "epic": "Frontend UI",  
    "targetFilePath": "src/frontend/components/bids/FallbackMapper.tsx",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \[\]  
  },  
  {  
    "taskId": "T-026",  
    "title": "Build Draggable Vendor Items",  
    "description": "Create \`VendorItemCard.tsx\` using \`useDraggable\` from \`@dnd-kit/core\`. Map over the unassigned items list returned by the AI when confidence is low.",  
    "epic": "Frontend UI",  
    "targetFilePath": "src/frontend/components/bids/VendorItemCard.tsx",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \["T-025"\]  
  },  
  {  
    "taskId": "T-027",  
    "title": "Build Droppable Budget Zones",  
    "description": "Create \`DroppableCategoryZone.tsx\` using \`useDroppable\`. Render a grid of existing \`budget\_items\` serving as visual drop targets for the unmapped vendor items.",  
    "epic": "Frontend UI",  
    "targetFilePath": "src/frontend/components/bids/DroppableCategoryZone.tsx",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \["T-025"\]  
  },  
  {  
    "taskId": "T-028",  
    "title": "Implement DND Collision Resolution",  
    "description": "Configure the \`onDragEnd\` event in \`FallbackMapper\`. Use \`closestCenter\` collision. On drop, trigger a fetch to \`/api/budget-items/map\` to save the manual override.",  
    "epic": "Frontend UI",  
    "targetFilePath": "src/frontend/components/bids/FallbackMapper.tsx",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \["T-026", "T-027"\]  
  },  
  {  
    "taskId": "T-029",  
    "title": "Build Budget DataTable with Variance",  
    "description": "Implement a Shadcn DataTable that fetches from \`/api/budget/:projectId\`. Render columns for \`work\_item\`, \`max\_unit\_price\`, and a computed \`variance\` column with color-coding (red/green) based on overage.",  
    "epic": "Frontend UI",  
    "targetFilePath": "src/frontend/components/room-view/budget-table.tsx",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \["T-008"\]  
  },  
  {  
    "taskId": "T-030",  
    "title": "Build Gap Analyzer Shadcn Alert",  
    "description": "Create an \`Alert\` component (Destructive variant) that conditionally renders at the top of the Budget DataTable if the \`detectScopeGaps\` utility flags missing masterformat divisions.",  
    "epic": "Frontend UI",  
    "targetFilePath": "src/frontend/components/room-view/BudgetSignals.tsx",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \["T-009"\]  
  },  
  {  
    "taskId": "T-031",  
    "title": "Build Sync History Dashboard",  
    "description": "Create a new Admin view rendering the \`sync\_revision\_log\` data. Show timestamps, entity type, source (Sheets vs Agent), and a prominent badge for conflict resolution status.",  
    "epic": "Frontend UI",  
    "targetFilePath": "src/frontend/pages/admin/budget/truth-table.astro",  
    "cloudflare\_services": \["None"\],  
    "dependencies": \["T-012"\]  
  }  
\]  
