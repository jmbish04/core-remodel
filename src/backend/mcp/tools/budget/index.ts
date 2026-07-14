import type { RemodelTool } from "../../types";

import { listBudgetItems } from "./list_budget_items";
import { getBudgetItem } from "./get_budget_item";
import { createBudgetItem } from "./create_budget_item";
import { updateBudgetItem } from "./update_budget_item";
import { linkBudgetItemToRoom } from "./link_budget_item_to_room";
import { unlinkBudgetItemFromRoom } from "./unlink_budget_item_from_room";
import { recordExpense } from "./record_expense";
import { listExpenses } from "./list_expenses";
import { listFundingAccounts } from "./list_funding_accounts";
import { setFundingAccount } from "./set_funding_account";

export const budgetTools: RemodelTool[] = [
  listBudgetItems,
  getBudgetItem,
  createBudgetItem,
  updateBudgetItem,
  linkBudgetItemToRoom,
  unlinkBudgetItemFromRoom,
  recordExpense,
  listExpenses,
  listFundingAccounts,
  setFundingAccount,
];
