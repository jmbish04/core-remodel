import {
  assumptionLineItems,
  assumptionMicroVariances,
  budgetVarianceScenarios,
  messages,
  projectSystemVariables,
  staticBudgetItems,
  threads,
  users,
} from "@backend/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

export type BudgetProposal =
  | {
      id: string;
      kind: "select_kitchen";
      label: string;
      description: string;
      scenarioKey: "a" | "b" | "c" | "d";
      valueText: string;
      estimatedImpact: string;
    }
  | {
      id: string;
      kind: "set_variable";
      label: string;
      description: string;
      key: "ACTIVE_SHOWER_SCENARIO" | "ENABLE_STEAM_SHOWER" | "ENABLE_SMART_SHOWER" | "SYS_BUDGET_CAP";
      value: string;
      estimatedImpact: string;
    };

export async function loadBudgetSnapshot(env: Env) {
  const db = drizzle(env.DB);

  const vars = await db.select().from(projectSystemVariables).all();
  const getVar = (key: string, def: string) =>
    vars.find((v) => v.variableKey === key)?.valueText || def;

  const activeKitchenText = getVar("ACTIVE_KITCHEN_SCENARIO", "Scenario C");
  const activeShower = getVar("ACTIVE_SHOWER_SCENARIO", "A1");
  const enableSteam = getVar("ENABLE_STEAM_SHOWER", "false") === "true";
  const enableSmart = getVar("ENABLE_SMART_SHOWER", "false") === "true";
  const budgetCapText = getVar("SYS_BUDGET_CAP", "$300,000");
  const framingCreditText = getVar("OPEN_FRAMING_CREDIT", "20.0%");

  const budgetCap = parseFloat(budgetCapText.replace(/[$,]/g, "")) || 300000;
  const framingCredit = parseFloat(framingCreditText.replace(/%/g, "")) / 100 || 0.2;
  const activeKitchenKey = activeKitchenText.split(" ").pop()?.toLowerCase() || "c";

  const [scenarios, staticItems, assumptions, showers] = await Promise.all([
    db.select().from(budgetVarianceScenarios).all(),
    db.select().from(staticBudgetItems).all(),
    db.select().from(assumptionLineItems).all(),
    db.select().from(assumptionMicroVariances).all(),
  ]);

  let assumptionsMin = 0;
  let assumptionsAvg = 0;
  let assumptionsMax = 0;
  const assumptionsBreakdown: Record<string, { name: string; min: number; avg: number; max: number }> = {};

  assumptions.forEach((item) => {
    const section = item.sectionName;
    const min = item.minCost || 0;
    const avg = item.avgCost || 0;
    const max = item.maxCost || 0;
    const factor = item.itemDescription.toLowerCase().includes("hvac mechanical installation labor")
      ? 1 - framingCredit
      : 1;

    const costMin = min * factor;
    const costAvg = avg * factor;
    const costMax = max * factor;

    assumptionsMin += costMin;
    assumptionsAvg += costAvg;
    assumptionsMax += costMax;

    if (!assumptionsBreakdown[section]) {
      assumptionsBreakdown[section] = { name: section, min: 0, avg: 0, max: 0 };
    }
    assumptionsBreakdown[section].min += costMin;
    assumptionsBreakdown[section].avg += costAvg;
    assumptionsBreakdown[section].max += costMax;
  });

  const selectedKitchen =
    scenarios.find((s) => s.scenarioKey === activeKitchenKey) ?? scenarios.find((s) => s.scenarioKey === "c");
  const kitchenCost = selectedKitchen ? selectedKitchen.deviationTotal : 0;

  const letter = activeShower.charAt(0).toUpperCase();
  const variant = parseInt(activeShower.charAt(1)) || 1;
  const activeShowerItems = showers.filter(
    (s) => s.scenarioLetter === letter && s.variantNumber === variant && !s.isAddon,
  );

  let showerMin = 0;
  let showerAvg = 0;
  let showerMax = 0;
  activeShowerItems.forEach((item) => {
    showerMin += item.minCost || 0;
    showerAvg += item.avgCost || 0;
    showerMax += item.maxCost || 0;
  });

  let steamMin = 0;
  let steamAvg = 0;
  let steamMax = 0;
  if (enableSteam) {
    showers
      .filter((s) => s.isAddon && s.addonCategory === "steam")
      .forEach((item) => {
        steamMin += item.minCost || 0;
        steamAvg += item.avgCost || 0;
        steamMax += item.maxCost || 0;
      });
  }

  let smartMin = 0;
  let smartAvg = 0;
  let smartMax = 0;
  if (enableSmart) {
    showers
      .filter((s) => s.isAddon && s.addonCategory === "smart")
      .forEach((item) => {
        smartMin += item.minCost || 0;
        smartAvg += item.avgCost || 0;
        smartMax += item.maxCost || 0;
      });
  }

  const totalMin = assumptionsMin + kitchenCost + showerMin + steamMin + smartMin;
  const totalAvg = assumptionsAvg + kitchenCost + showerAvg + steamAvg + smartAvg;
  const totalMax = assumptionsMax + kitchenCost + showerMax + steamMax + smartMax;

  let staticMin = 0;
  let staticAvg = 0;
  let staticMax = 0;
  staticItems.forEach((item) => {
    staticMin += item.minCost || 0;
    staticAvg += item.avgCost || 0;
    staticMax += item.maxCost || 0;
  });

  return {
    configuration: {
      activeKitchenText,
      activeKitchenKey,
      activeShower,
      enableSteam,
      enableSmart,
      budgetCap,
      framingCreditText,
    },
    rollups: {
      min: totalMin,
      avg: totalAvg,
      max: totalMax,
      cap: budgetCap,
      difference: budgetCap - totalAvg,
      isOverCap: totalAvg > budgetCap,
    },
    breakdown: {
      baseAssumptions: {
        min: assumptionsMin,
        avg: assumptionsAvg,
        max: assumptionsMax,
        sections: Object.values(assumptionsBreakdown),
      },
      kitchenScenario: {
        name: selectedKitchen ? selectedKitchen.label : "Kitchen Scenario",
        layoutType: selectedKitchen ? selectedKitchen.layoutType : "",
        cost: kitchenCost,
      },
      showerScenario: {
        name: `Shower Scenario ${activeShower}`,
        min: showerMin,
        avg: showerAvg,
        max: showerMax,
      },
      addOns: {
        steamShower: {
          enabled: enableSteam,
          min: steamMin,
          avg: steamAvg,
          max: steamMax,
        },
        smartShower: {
          enabled: enableSmart,
          min: smartMin,
          avg: smartAvg,
          max: smartMax,
        },
      },
    },
    alternativeStaticBudget: {
      min: staticMin,
      avg: staticAvg,
      max: staticMax,
    },
  };
}

export async function setProjectVariable(env: Env, key: string, value: string) {
  const db = drizzle(env.DB);
  const existing = await db
    .select()
    .from(projectSystemVariables)
    .where(eq(projectSystemVariables.variableKey, key))
    .get();

  if (existing) {
    await db.update(projectSystemVariables).set({ valueText: value }).where(eq(projectSystemVariables.variableKey, key)).run();
    return;
  }

  await db
    .insert(projectSystemVariables)
    .values({
      variableKey: key,
      valueText: value,
      mappingRefKey: key,
      category: "Budget Agent Selection",
      unit: value === "true" || value === "false" ? "Boolean" : "String",
    })
    .run();
}

export async function selectKitchenScenario(env: Env, scenarioKey: "a" | "b" | "c" | "d") {
  const labelMap = {
    a: "Scenario A",
    b: "Scenario B",
    c: "Scenario C",
    d: "Scenario D",
  } satisfies Record<"a" | "b" | "c" | "d", string>;

  await setProjectVariable(env, "ACTIVE_KITCHEN_SCENARIO", labelMap[scenarioKey]);
  return labelMap[scenarioKey];
}

export async function applyBudgetProposal(env: Env, proposal: BudgetProposal) {
  if (proposal.kind === "select_kitchen") {
    const activeScenario = await selectKitchenScenario(env, proposal.scenarioKey);
    return { success: true, message: `${activeScenario} is now active.`, snapshot: await loadBudgetSnapshot(env) };
  }

  await setProjectVariable(env, proposal.key, proposal.value);
  return { success: true, message: `${proposal.label} applied.`, snapshot: await loadBudgetSnapshot(env) };
}

export function buildBudgetProposals(prompt: string, snapshot: Awaited<ReturnType<typeof loadBudgetSnapshot>>) {
  const normalized = prompt.toLowerCase();
  const proposals: BudgetProposal[] = [];
  const kitchenMatch =
    normalized.match(/scenario\s*([abcd])/) ??
    normalized.match(/kitchen\s*([abcd])/) ??
    normalized.match(/layout\s*([abcd])/);

  if (kitchenMatch?.[1]) {
    const key = kitchenMatch[1] as "a" | "b" | "c" | "d";
    proposals.push({
      id: crypto.randomUUID(),
      kind: "select_kitchen",
      label: `Activate kitchen Scenario ${key.toUpperCase()}`,
      description: `Switch the active kitchen layout from ${snapshot.configuration.activeKitchenText} to Scenario ${key.toUpperCase()}.`,
      scenarioKey: key,
      valueText: `Scenario ${key.toUpperCase()}`,
      estimatedImpact: "Recomputes the matrix using that scenario's deviation total.",
    });
  }

  const showerMatch = normalized.match(/\b([a-f][12])\b/);
  if (showerMatch?.[1]) {
    const value = showerMatch[1].toUpperCase();
    proposals.push({
      id: crypto.randomUUID(),
      kind: "set_variable",
      label: `Use shower Scenario ${value}`,
      description: `Switch the primary shower matrix selection from ${snapshot.configuration.activeShower} to ${value}.`,
      key: "ACTIVE_SHOWER_SCENARIO",
      value,
      estimatedImpact: "Recomputes the shower min, average, and max bands.",
    });
  }

  if (normalized.includes("steam")) {
    const enable = normalized.includes("disable") || normalized.includes("remove") || normalized.includes("turn off")
      ? "false"
      : "true";
    proposals.push({
      id: crypto.randomUUID(),
      kind: "set_variable",
      label: enable === "true" ? "Add steam shower" : "Remove steam shower",
      description: "Change the steam shower add-on toggle in the budget assumptions.",
      key: "ENABLE_STEAM_SHOWER",
      value: enable,
      estimatedImpact: enable === "true" ? "Adds the steam shower allowance." : "Removes the steam shower allowance.",
    });
  }

  if (normalized.includes("smart") || normalized.includes("digital controller")) {
    const enable = normalized.includes("disable") || normalized.includes("remove") || normalized.includes("turn off")
      ? "false"
      : "true";
    proposals.push({
      id: crypto.randomUUID(),
      kind: "set_variable",
      label: enable === "true" ? "Add smart shower controller" : "Remove smart shower controller",
      description: "Change the smart digital controller add-on toggle in the budget assumptions.",
      key: "ENABLE_SMART_SHOWER",
      value: enable,
      estimatedImpact: enable === "true" ? "Adds the smart controller allowance." : "Removes the smart controller allowance.",
    });
  }

  const capMatch = prompt.match(/\$?\s*([2-9]\d{2},?\d{3})\s*(?:cap|budget|ceiling)?/i);
  if (normalized.includes("cap") && capMatch?.[1]) {
    const numeric = Number(capMatch[1].replace(/,/g, ""));
    proposals.push({
      id: crypto.randomUUID(),
      kind: "set_variable",
      label: `Set cap to ${formatCurrency(numeric)}`,
      description: `Update the dashboard baseline cap from ${formatCurrency(snapshot.rollups.cap)} to ${formatCurrency(numeric)}.`,
      key: "SYS_BUDGET_CAP",
      value: formatCurrency(numeric),
      estimatedImpact: "Changes the under/over budget comparison without changing scope costs.",
    });
  }

  if (normalized.includes("under cap") || normalized.includes("save") || normalized.includes("reduce")) {
    if (snapshot.configuration.enableSteam) {
      proposals.push({
        id: crypto.randomUUID(),
        kind: "set_variable",
        label: "Remove steam shower",
        description: "Remove the steam shower add-on as a fast reduction lever.",
        key: "ENABLE_STEAM_SHOWER",
        value: "false",
        estimatedImpact: "Removes the steam shower allowance from the active average.",
      });
    }
    if (snapshot.configuration.enableSmart) {
      proposals.push({
        id: crypto.randomUUID(),
        kind: "set_variable",
        label: "Remove smart shower controller",
        description: "Remove the smart controller add-on as a smaller reduction lever.",
        key: "ENABLE_SMART_SHOWER",
        value: "false",
        estimatedImpact: "Removes the smart controller allowance from the active average.",
      });
    }
  }

  return proposals.slice(0, 3);
}

export async function persistBudgetChatMessage(env: Env, conversationId: string, role: "user" | "assistant", content: string, metadata?: unknown) {
  const db = drizzle(env.DB);
  const email = "budget-dashboard-agent@system.local";
  let user = await db.select().from(users).where(eq(users.email, email)).get();

  if (!user) {
    await db
      .insert(users)
      .values({
        email,
        passwordHash: "system-agent",
        name: "Budget Dashboard Agent",
      })
      .run();
    user = await db.select().from(users).where(eq(users.email, email)).get();
  }

  if (!user) return;

  const title = `Budget dashboard ${conversationId}`;
  let thread = await db
    .select()
    .from(threads)
    .where(and(eq(threads.userId, user.id), eq(threads.title, title)))
    .get();

  if (!thread) {
    await db.insert(threads).values({ userId: user.id, title }).run();
    thread = await db
      .select()
      .from(threads)
      .where(and(eq(threads.userId, user.id), eq(threads.title, title)))
      .get();
  }

  if (!thread) return;

  await db
    .insert(messages)
    .values({
      threadId: thread.id,
      role,
      content,
      metadata: metadata ? JSON.stringify(metadata) : null,
    })
    .run();

  await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, thread.id)).run();
}

export function formatCurrency(val: number | null | undefined) {
  if (val === null || val === undefined) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);
}
