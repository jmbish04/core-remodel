import { Agent, type Connection } from "cloudflare:agents";

export class BudgetAgent extends Agent {
  async onConnect(connection: Connection, _ctx: any) {
    connection.accept();
    console.log("WebSocket connected to BudgetAgent");

    connection.send(JSON.stringify({
      type: "message",
      role: "agent",
      text: "System loaded. I am connected via WebSocket. How can I assist with your budgeting matrix parameters?",
      quickActions: ["Update a cost", "Review budget", "List inactive items"]
    }));
  }

  async onMessage(connection: Connection, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;

    try {
      const data = JSON.parse(message);

      if (data.type === "query") {
        const query = data.text;
        console.log(`Received query: ${query}`);

        // Simple mock LLM logic
        let responseText = `I have received your request: ${query}. `;
        let actionPayload = null;
        let quickActions = ["Tell me more", "Cancel"];

        if (query.toLowerCase().includes("update cost") || query.toLowerCase().includes("update")) {
            responseText += "Executing structural cost modification for the test item.";
            actionPayload = {
                action: "UPDATE_CELL",
                params: {
                    id: "brId_example",
                    costExpression: "5000"
                }
            };
            quickActions = ["Confirm update applied", "Undo"];
        } else if (query.toLowerCase().includes("review budget")) {
            responseText += "Fetching budget details from the matrix (mocked action).";
        } else if (query.toLowerCase().includes("list inactive")) {
            responseText += "Listing all items flagged as inactive in D1 (mocked action).";
        }

        connection.send(JSON.stringify({
            type: "message",
            role: "agent",
            text: responseText,
            toolCall: actionPayload,
            quickActions: quickActions
        }));

      } else if (data.type === "tool_result") {
          console.log("Client executed tool and returned:", data.result);
          connection.send(JSON.stringify({
             type: "message",
             role: "agent",
             text: `Tool execution confirmed with result: ${JSON.stringify(data.result)}`
          }));
      }

    } catch (e) {
      console.error("Error parsing message", e);
      connection.send(JSON.stringify({
          type: "error",
          message: "Failed to process input."
      }));
    }
  }

  async onClose(connection: Connection, code: number, reason: string, _wasClean: boolean) {
    console.log(`Connection closed: ${code} ${reason}`);
  }
}
