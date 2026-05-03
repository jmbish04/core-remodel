/**
 * @fileoverview AI task to classify an inbound email and suggest a role
 * status update. Uses gpt-oss-120b structured output to return a status
 * suggestion with confidence scoring.
 *
 * Called from the email handler after an email is matched to a role.
 */

const VALID_STATUSES = [
  "preparing",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
  "archived",
] as const;

type StatusSuggestion = {
  suggestedStatus: (typeof VALID_STATUSES)[number] | null;
  confidence: number;
  reasoning: string;
};

const STATUS_CLASSIFICATION_SCHEMA = {
  type: "object" as const,
  properties: {
    suggestedStatus: {
      type: ["string", "null"] as const,
      enum: [...VALID_STATUSES, null],
      description:
        "The suggested new status for the role based on the email content. Null if no status change is warranted.",
    },
    confidence: {
      type: "number" as const,
      minimum: 0,
      maximum: 1,
      description: "Confidence score from 0 to 1 for the suggested status change.",
    },
    reasoning: {
      type: "string" as const,
      description: "Brief explanation of why this status was suggested.",
    },
  },
  required: ["suggestedStatus", "confidence", "reasoning"] as const,
};

const SYSTEM_PROMPT = `You are an expert at analyzing recruiting and job application emails. Given an email's subject and body along with the current application status, determine if the email indicates a status change in the job application process.

Common signals:
- "schedule an interview" / "availability" / "phone screen" / "technical interview" → interviewing
- "unfortunately" / "not moving forward" / "other candidates" / "position has been filled" → rejected
- "offer letter" / "compensation" / "we'd like to extend" / "congratulations" → offer
- "thank you for applying" / "application received" → applied (only if currently preparing)
- General updates, newsletters, or irrelevant emails → null (no change)

Only suggest a status change when you are confident. If the email is ambiguous, set suggestedStatus to null.`;

export async function classifyEmailStatus(
  env: Env,
  emailSubject: string,
  emailBody: string,
  currentStatus: string,
): Promise<StatusSuggestion> {
  const userPrompt = [
    `Current role status: ${currentStatus}`,
    "",
    `Email subject: ${emailSubject}`,
    "",
    `Email body:`,
    emailBody.slice(0, 3000), // Limit body to prevent token overflow
  ].join("\n");

  try {
    const response = (await env.AI.run(
      env.MODEL_EXTRACT as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "email_status_classification",
            strict: true,
            schema: STATUS_CLASSIFICATION_SCHEMA,
          },
        },
        max_tokens: 256,
        temperature: 0.1,
      },
      { gateway: { id: env.AI_GATEWAY_ID } },
    )) as { response?: string };

    const parsed = JSON.parse(response.response ?? "{}") as StatusSuggestion;

    // Validate the suggested status
    if (
      parsed.suggestedStatus &&
      !VALID_STATUSES.includes(parsed.suggestedStatus as (typeof VALID_STATUSES)[number])
    ) {
      parsed.suggestedStatus = null;
      parsed.confidence = 0;
    }

    return parsed;
  } catch (error) {
    console.error("Email status classification failed:", error);
    return { suggestedStatus: null, confidence: 0, reasoning: "Classification failed" };
  }
}
