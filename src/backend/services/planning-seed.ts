import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  planningEpics,
  planningParticipants,
  planningTasks,
} from "@backend/db";

type SeedParticipant = {
  displayName: string;
  participantType: string;
  companyName?: string;
};

type SeedEpic = {
  id: string;
  slug: string;
  title: string;
  description: string;
  phaseOrder: number;
};

type SeedTask = {
  id: string;
  slug: string;
  epicId: string;
  title: string;
  description: string;
  taskOrder: number;
  priority: number;
  responsibleName: string;
  accountableName: string;
  supportNames?: string[];
  consultedNames?: string[];
  informedNames?: string[];
  dependsOnTaskIds?: string[];
};

const DEFAULT_PARTICIPANTS: SeedParticipant[] = [
  { displayName: "Homeowner", participantType: "homeowner" },
  { displayName: "General Contractor", participantType: "contractor", companyName: "TBD Contractor Co." },
  { displayName: "Architect", participantType: "architect", companyName: "TBD Architecture" },
  { displayName: "Structural Engineer", participantType: "vendor", companyName: "TBD Engineering" },
  { displayName: "Permit Expediter", participantType: "vendor", companyName: "TBD Permit Services" },
  { displayName: "City Inspector", participantType: "inspector", companyName: "SF DBI" },
];

const DEFAULT_EPICS: SeedEpic[] = [
  {
    id: "epic-feasibility",
    slug: "feasibility-planning",
    title: "Feasibility + Scope Planning",
    description: "Confirm options, constraints, and first-pass scope with architect and homeowner.",
    phaseOrder: 1,
  },
  {
    id: "epic-precon",
    slug: "preconstruction-contracting",
    title: "Pre-Construction + Contracting",
    description: "Refine design options, gather bids, and execute contractor agreements.",
    phaseOrder: 2,
  },
  {
    id: "epic-permits",
    slug: "permits-approvals",
    title: "Permits + Approvals",
    description: "Prepare submittal package, respond to comments, and secure permit readiness.",
    phaseOrder: 3,
  },
  {
    id: "epic-construction",
    slug: "construction-delivery",
    title: "Construction Delivery",
    description: "Execute work, track progress, and close out inspection and punch-list.",
    phaseOrder: 4,
  },
];

const DEFAULT_TASKS: SeedTask[] = [
  {
    id: "task-site-feasibility",
    slug: "site-feasibility-study",
    epicId: "epic-feasibility",
    title: "Run feasibility study with architect",
    description: "Validate structural and layout constraints for renovation options before locking scope.",
    taskOrder: 1,
    priority: 1,
    responsibleName: "Architect",
    accountableName: "Homeowner",
    supportNames: ["Structural Engineer"],
    consultedNames: ["General Contractor"],
    informedNames: ["Permit Expediter"],
  },
  {
    id: "task-room-brief",
    slug: "finalize-room-briefs",
    epicId: "epic-feasibility",
    title: "Finalize room briefs and decision nodes",
    description: "Lock room-level goals, scenarios, and required supporting records.",
    taskOrder: 2,
    priority: 1,
    responsibleName: "Homeowner",
    accountableName: "Homeowner",
    supportNames: ["Architect"],
    consultedNames: ["General Contractor"],
    informedNames: ["Permit Expediter"],
    dependsOnTaskIds: ["task-site-feasibility"],
  },
  {
    id: "task-contractor-intake",
    slug: "collect-contractor-estimates",
    epicId: "epic-precon",
    title: "Collect contractor estimates and references",
    description: "Gather bids, verify scope alignment, and log revision-safe estimate comparisons.",
    taskOrder: 1,
    priority: 1,
    responsibleName: "Homeowner",
    accountableName: "Homeowner",
    supportNames: ["General Contractor"],
    consultedNames: ["Architect"],
    informedNames: ["Permit Expediter"],
    dependsOnTaskIds: ["task-room-brief"],
  },
  {
    id: "task-contract-execution",
    slug: "execute-construction-contract",
    epicId: "epic-precon",
    title: "Execute construction contract",
    description: "Negotiate final scope, payment terms, and schedule milestones before permit filing.",
    taskOrder: 2,
    priority: 1,
    responsibleName: "General Contractor",
    accountableName: "Homeowner",
    consultedNames: ["Architect"],
    informedNames: ["Permit Expediter"],
    dependsOnTaskIds: ["task-contractor-intake"],
  },
  {
    id: "task-permit-package",
    slug: "prepare-permit-package",
    epicId: "epic-permits",
    title: "Prepare permit package",
    description: "Assemble drawings, structural notes, and supporting documents for submission.",
    taskOrder: 1,
    priority: 1,
    responsibleName: "Architect",
    accountableName: "Homeowner",
    supportNames: ["Permit Expediter"],
    consultedNames: ["General Contractor", "Structural Engineer"],
    informedNames: ["City Inspector"],
    dependsOnTaskIds: ["task-contract-execution"],
  },
  {
    id: "task-permit-file",
    slug: "file-permit-with-city",
    epicId: "epic-permits",
    title: "File permit with city",
    description: "Submit complete package and track intake status through DBI.",
    taskOrder: 2,
    priority: 1,
    responsibleName: "Permit Expediter",
    accountableName: "Homeowner",
    consultedNames: ["Architect"],
    informedNames: ["General Contractor"],
    dependsOnTaskIds: ["task-permit-package"],
  },
  {
    id: "task-permit-responses",
    slug: "respond-to-permit-comments",
    epicId: "epic-permits",
    title: "Respond to permit comments and agenda notes",
    description: "Process inspector/plan-check comments and re-submit revisions until approved.",
    taskOrder: 3,
    priority: 1,
    responsibleName: "Architect",
    accountableName: "Homeowner",
    supportNames: ["Permit Expediter"],
    consultedNames: ["General Contractor"],
    informedNames: ["City Inspector"],
    dependsOnTaskIds: ["task-permit-file"],
  },
  {
    id: "task-mobilization",
    slug: "construction-mobilization",
    epicId: "epic-construction",
    title: "Construction mobilization",
    description: "Confirm start sequencing, procurement, and site readiness for kickoff.",
    taskOrder: 1,
    priority: 1,
    responsibleName: "General Contractor",
    accountableName: "Homeowner",
    consultedNames: ["Architect"],
    informedNames: ["City Inspector"],
    dependsOnTaskIds: ["task-permit-responses"],
  },
  {
    id: "task-daily-reporting",
    slug: "daily-field-reporting",
    epicId: "epic-construction",
    title: "Daily field reporting and weekly review",
    description: "Capture daily updates, voice notes, progress photos, and weekly summaries.",
    taskOrder: 2,
    priority: 2,
    responsibleName: "General Contractor",
    accountableName: "Homeowner",
    informedNames: ["Architect"],
    dependsOnTaskIds: ["task-mobilization"],
  },
  {
    id: "task-closeout",
    slug: "final-inspection-closeout",
    epicId: "epic-construction",
    title: "Final inspection and close-out",
    description: "Complete punch-list, pass final inspections, and archive close-out documentation.",
    taskOrder: 3,
    priority: 1,
    responsibleName: "General Contractor",
    accountableName: "Homeowner",
    consultedNames: ["City Inspector", "Architect"],
    dependsOnTaskIds: ["task-daily-reporting"],
  },
];

function encodeParticipantIdArray(values: number[]): string {
  return JSON.stringify(values);
}

export async function ensurePlanningSeed(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const existingEpic = await db.select().from(planningEpics).limit(1).get();
  if (existingEpic) {
    return;
  }

  const participantIdByName = new Map<string, number>();
  for (const participant of DEFAULT_PARTICIPANTS) {
    const existing = await db
      .select()
      .from(planningParticipants)
      .where(eq(planningParticipants.displayName, participant.displayName))
      .get();

    if (existing) {
      participantIdByName.set(participant.displayName, existing.id);
      continue;
    }

    const inserted = await db
      .insert(planningParticipants)
      .values({
        displayName: participant.displayName,
        participantType: participant.participantType,
        companyName: participant.companyName || null,
      })
      .returning()
      .get();

    participantIdByName.set(participant.displayName, inserted.id);
  }

  await db.insert(planningEpics).values(
    DEFAULT_EPICS.map((epic) => ({
      id: epic.id,
      slug: epic.slug,
      title: epic.title,
      description: epic.description,
      phaseOrder: epic.phaseOrder,
    })),
  ).run();

  const toIds = (names: string[] | undefined): number[] =>
    (names || [])
      .map((name) => participantIdByName.get(name) || null)
      .filter((value): value is number => typeof value === "number");

  await db.insert(planningTasks).values(
    DEFAULT_TASKS.map((task) => {
      const responsibleParticipantId = participantIdByName.get(task.responsibleName) || null;
      const accountableParticipantId = participantIdByName.get(task.accountableName) || null;
      const supportParticipantIds = toIds(task.supportNames);
      const consultedParticipantIds = toIds(task.consultedNames);
      const informedParticipantIds = toIds(task.informedNames);
      const ownerParticipantId = accountableParticipantId || responsibleParticipantId;

      return {
        id: task.id,
        epicId: task.epicId,
        slug: task.slug,
        title: task.title,
        description: task.description,
        status: "pending",
        priority: task.priority,
        taskOrder: task.taskOrder,
        ownerParticipantId,
        responsibleParticipantId,
        accountableParticipantId,
        supportParticipantIds: encodeParticipantIdArray(supportParticipantIds),
        consultedParticipantIds: encodeParticipantIdArray(consultedParticipantIds),
        informedParticipantIds: encodeParticipantIdArray(informedParticipantIds),
        dependsOnTaskIds: JSON.stringify(task.dependsOnTaskIds || []),
      };
    }),
  ).run();
}
