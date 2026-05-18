import { Upload, CheckCircle, XCircle, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

interface CSVRow {
  Type: string;
  Category: string;
  Name: string;
  Cost: string | number;
  Description: string;
}

interface DeltaResult {
  rowIndex: number;
  status: "new" | "updated" | "unchanged" | "conflict";
  csvData: CSVRow;
  existingData?: any;
  aiValidation?: {
    validated: boolean;
    categoryConfidence?: number;
    costReasonable?: boolean;
    suggestedCategory?: string;
    rationale?: string;
  };
  changes?: Array<{
    field: string;
    oldValue: any;
    newValue: any;
  }>;
}

interface IngestionResponse {
  success: boolean;
  dryRun: boolean;
  summary: {
    totalRows: number;
    newItems: number;
    updatedItems: number;
    unchangedItems: number;
    conflicts: number;
    aiValidated: number;
  };
  deltas: DeltaResult[];
  transactionId?: string;
  errors?: Array<{ rowIndex: number; error: string }>;
}

interface RealtimeEvent {
  type: string;
  payload: any;
  timestamp: string;
}

export function BudgetReconciliationApp() {
  const [csvData, setCsvData] = useState<CSVRow[]>([]);
  const [ingestionResult, setIngestionResult] = useState<IngestionResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDryRun, setIsDryRun] = useState(true);
  const [validateWithAI, setValidateWithAI] = useState(true);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/budget-tracker/realtime`;

    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log("WebSocket connected to budget realtime");
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        setRealtimeEvents((prev) => [message, ...prev].slice(0, 20));
      } catch (error) {
        console.error("Failed to parse WebSocket message", error);
      }
    };

    socket.onerror = (error) => {
      console.error("WebSocket error", error);
    };

    socket.onclose = () => {
      console.log("WebSocket disconnected");
    };

    setWs(socket);

    return () => {
      socket.close();
    };
  }, []);

  const parseCSV = useCallback((text: string): CSVRow[] => {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].split(",").map((h) => h.trim());
    const rows: CSVRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim());
      if (values.length !== headers.length) continue;

      const row: Partial<CSVRow> = {};
      headers.forEach((header, index) => {
        row[header as keyof CSVRow] = values[index];
      });

      if (row.Type && row.Category && row.Name && row.Cost !== undefined) {
        rows.push(row as CSVRow);
      }
    }

    return rows;
  }, []);

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const parsed = parseCSV(text);
        setCsvData(parsed);
        setIngestionResult(null);
      };
      reader.readAsText(file);
    },
    [parseCSV],
  );

  const handleIngestion = useCallback(
    async (dryRun: boolean) => {
      if (csvData.length === 0) return;

      setIsProcessing(true);
      setIsDryRun(dryRun);

      try {
        const response = await fetch("/api/budget-tracker/csv-ingestion", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rows: csvData,
            sourceRef: selectedFile?.name || "manual_import",
            changedBy: "user",
            dryRun,
            validateWithAI,
          }),
        });

        const result = (await response.json()) as IngestionResponse;
        setIngestionResult(result);
      } catch (error) {
        console.error("Ingestion failed", error);
      } finally {
        setIsProcessing(false);
      }
    },
    [csvData, validateWithAI, selectedFile],
  );

  const getStatusColor = (status: DeltaResult["status"]) => {
    switch (status) {
      case "new":
        return "text-green-400";
      case "updated":
        return "text-yellow-400";
      case "unchanged":
        return "text-zinc-500";
      case "conflict":
        return "text-red-400";
      default:
        return "text-zinc-400";
    }
  };

  const getStatusIcon = (status: DeltaResult["status"]) => {
    switch (status) {
      case "new":
        return <CheckCircle className="h-4 w-4" />;
      case "updated":
        return <RefreshCw className="h-4 w-4" />;
      case "unchanged":
        return <CheckCircle className="h-4 w-4 opacity-50" />;
      case "conflict":
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <XCircle className="h-4 w-4" />;
    }
  };

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: "oklch(0.145 0 0)" }}>
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="rounded-lg bg-zinc-900/50 p-6 ring-1 ring-border/40">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-50">
            Budget Reconciliation Workspace
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Import CSV from remodelum.com, validate with AI, analyze deltas, and apply changes with
            transaction isolation.
          </p>
        </div>

        {/* Upload Section */}
        <div className="rounded-lg bg-zinc-900/50 p-6 ring-1 ring-border/40">
          <h2 className="mb-4 text-lg font-semibold text-zinc-50">1. Upload CSV File</h2>
          <div className="flex items-center gap-4">
            <label
              htmlFor="csv-upload"
              className="flex cursor-pointer items-center gap-2 rounded-md bg-zinc-800 px-4 py-2 text-sm text-zinc-50 ring-1 ring-border/40 transition-all hover:bg-zinc-700"
            >
              <Upload className="h-4 w-4" />
              Choose File
            </label>
            <input
              id="csv-upload"
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            {selectedFile && <span className="text-sm text-zinc-400">{selectedFile.name}</span>}
          </div>
          {csvData.length > 0 && (
            <div className="mt-4 rounded-md bg-zinc-800/50 p-3 ring-1 ring-border/40">
              <p className="text-sm text-zinc-400">
                Loaded <span className="font-semibold text-zinc-50">{csvData.length}</span> rows
              </p>
            </div>
          )}
        </div>

        {/* Validation Options */}
        {csvData.length > 0 && (
          <div className="rounded-lg bg-zinc-900/50 p-6 ring-1 ring-border/40">
            <h2 className="mb-4 text-lg font-semibold text-zinc-50">2. Validation Options</h2>
            <div className="flex items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={validateWithAI}
                  onChange={(e) => setValidateWithAI(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-zinc-50 focus:ring-zinc-600"
                />
                Enable Workers AI Validation
              </label>
            </div>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => handleIngestion(true)}
                disabled={isProcessing}
                className="flex items-center gap-2 rounded-md bg-zinc-800 px-4 py-2 text-sm text-zinc-50 ring-1 ring-border/40 transition-all hover:bg-zinc-700 disabled:opacity-50"
              >
                {isProcessing && isDryRun ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                Dry Run (Preview)
              </button>
              <button
                type="button"
                onClick={() => handleIngestion(false)}
                disabled={isProcessing}
                className="flex items-center gap-2 rounded-md bg-green-800/50 px-4 py-2 text-sm text-zinc-50 ring-1 ring-green-700/40 transition-all hover:bg-green-700/50 disabled:opacity-50"
              >
                {isProcessing && !isDryRun ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                Apply Changes
              </button>
            </div>
          </div>
        )}

        {/* Results Summary */}
        {ingestionResult && (
          <div className="rounded-lg bg-zinc-900/50 p-6 ring-1 ring-border/40">
            <h2 className="mb-4 text-lg font-semibold text-zinc-50">
              3. Results {ingestionResult.dryRun && "(Dry Run)"}
            </h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-md bg-zinc-800/50 p-3 ring-1 ring-border/40">
                <div className="text-2xl font-bold text-zinc-50">
                  {ingestionResult.summary.totalRows}
                </div>
                <div className="text-xs text-zinc-500">Total Rows</div>
              </div>
              <div className="rounded-md bg-zinc-800/50 p-3 ring-1 ring-green-700/40">
                <div className="text-2xl font-bold text-green-400">
                  {ingestionResult.summary.newItems}
                </div>
                <div className="text-xs text-zinc-500">New Items</div>
              </div>
              <div className="rounded-md bg-zinc-800/50 p-3 ring-1 ring-yellow-700/40">
                <div className="text-2xl font-bold text-yellow-400">
                  {ingestionResult.summary.updatedItems}
                </div>
                <div className="text-xs text-zinc-500">Updated</div>
              </div>
              <div className="rounded-md bg-zinc-800/50 p-3 ring-1 ring-border/40">
                <div className="text-2xl font-bold text-zinc-500">
                  {ingestionResult.summary.unchangedItems}
                </div>
                <div className="text-xs text-zinc-500">Unchanged</div>
              </div>
              <div className="rounded-md bg-zinc-800/50 p-3 ring-1 ring-red-700/40">
                <div className="text-2xl font-bold text-red-400">
                  {ingestionResult.summary.conflicts}
                </div>
                <div className="text-xs text-zinc-500">Conflicts</div>
              </div>
              <div className="rounded-md bg-zinc-800/50 p-3 ring-1 ring-purple-700/40">
                <div className="text-2xl font-bold text-purple-400">
                  {ingestionResult.summary.aiValidated}
                </div>
                <div className="text-xs text-zinc-500">AI Validated</div>
              </div>
            </div>
          </div>
        )}

        {/* Delta Details */}
        {ingestionResult && ingestionResult.deltas.length > 0 && (
          <div className="rounded-lg bg-zinc-900/50 p-6 ring-1 ring-border/40">
            <h2 className="mb-4 text-lg font-semibold text-zinc-50">Delta Analysis</h2>
            <div className="space-y-3">
              {ingestionResult.deltas.slice(0, 50).map((delta, index) => (
                <div key={index} className="rounded-md bg-zinc-800/50 p-4 ring-1 ring-border/40">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={getStatusColor(delta.status)}>
                          {getStatusIcon(delta.status)}
                        </span>
                        <span className="font-medium text-zinc-50">{delta.csvData.Name}</span>
                        <span className="rounded-full bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                          {delta.csvData.Type}
                        </span>
                        <span className="text-sm text-zinc-500">{delta.csvData.Category}</span>
                      </div>
                      <div className="mt-1 text-sm text-zinc-400">
                        $
                        {typeof delta.csvData.Cost === "number"
                          ? delta.csvData.Cost.toFixed(2)
                          : delta.csvData.Cost}
                      </div>
                      {delta.changes && delta.changes.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {delta.changes.map((change, idx) => (
                            <div key={idx} className="text-xs text-zinc-500">
                              <span className="font-medium text-yellow-400">{change.field}:</span>{" "}
                              <span className="line-through">
                                {JSON.stringify(change.oldValue)}
                              </span>{" "}
                              → {JSON.stringify(change.newValue)}
                            </div>
                          ))}
                        </div>
                      )}
                      {delta.aiValidation && (
                        <div className="mt-2 rounded-md bg-zinc-700/50 p-2 text-xs ring-1 ring-purple-700/40">
                          <div className="text-purple-300">
                            AI Confidence:{" "}
                            {Math.round((delta.aiValidation.categoryConfidence || 0) * 100)}%
                          </div>
                          {delta.aiValidation.rationale && (
                            <div className="mt-1 text-zinc-400">{delta.aiValidation.rationale}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Realtime Events */}
        <div className="rounded-lg bg-zinc-900/50 p-6 ring-1 ring-border/40">
          <h2 className="mb-4 text-lg font-semibold text-zinc-50">Realtime Telemetry</h2>
          <div className="space-y-2">
            {realtimeEvents.length === 0 && (
              <p className="text-sm text-zinc-500">No events yet...</p>
            )}
            {realtimeEvents.map((event, index) => (
              <div
                key={index}
                className="rounded-md bg-zinc-800/50 p-3 font-mono text-xs text-zinc-400 ring-1 ring-border/40"
              >
                <div className="text-zinc-500">{event.timestamp}</div>
                <div className="mt-1 text-zinc-300">{event.payload.event || event.type}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
