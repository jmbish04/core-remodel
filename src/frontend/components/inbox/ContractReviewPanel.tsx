import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface ContractReviewPanelProps {
  emailId: number;
  contract: any;
  onUpdate: () => void;
}

export function ContractReviewPanel({ emailId, contract, onUpdate }: ContractReviewPanelProps) {
  const [formData, setFormData] = useState({
    partyName: contract.partyName || "",
    counterpartyName: contract.counterpartyName || "",
    scopeSummary: contract.scopeSummary || "",
    totalValue: contract.totalValue || 0,
    effectiveDate: contract.effectiveDate || "",
    completionDate: contract.completionDate || "",
    notes: contract.notes || "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const clauses = contract.clausesJson ? JSON.parse(contract.clausesJson) : [];
  const milestones = contract.paymentMilestonesJson
    ? JSON.parse(contract.paymentMilestonesJson)
    : [];
  const recommendations = contract.aiRecommendationsJson
    ? JSON.parse(contract.aiRecommendationsJson)
    : [];

  const isConfirmed = contract.status === "confirmed";

  async function handleSave(status?: "confirmed" | "rejected") {
    setIsSaving(true);
    try {
      await fetch(`/api/worker-emails/${emailId}/contracts/${contract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (status) {
        await fetch(`/api/worker-emails/${emailId}/contracts/${contract.id}/${status}`, {
          method: "POST",
        });
      }

      onUpdate();
    } catch (e) {
      console.error("Failed to update contract:", e);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className={isConfirmed ? "border-green-500/50" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            {contract.contractType === "change_order" ? "Change Order" : "Contract"}:{" "}
            {formData.partyName}
            {isConfirmed && (
              <Badge variant="default" className="bg-green-500">
                Confirmed
              </Badge>
            )}
            {contract.status === "rejected" && <Badge variant="destructive">Rejected</Badge>}
            {contract.status === "draft" && <Badge variant="outline">Draft</Badge>}
          </CardTitle>
          {contract.confidence && (
            <span className="text-sm text-muted-foreground">
              AI Confidence: {(contract.confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ── AI Recommendations ─────────────────────────────────── */}
        {recommendations.length > 0 && (
          <div>
            <Label className="mb-2 block font-semibold">
              AI Recommendations ({recommendations.length})
            </Label>
            <div className="space-y-2">
              {recommendations.map((rec: any, i: number) => (
                <div
                  key={i}
                  className={`p-3 rounded-lg text-sm ${
                    rec.severity === "critical"
                      ? "bg-red-500/10 border border-red-500/30"
                      : rec.severity === "warning"
                        ? "bg-yellow-500/10 border border-yellow-500/30"
                        : "bg-blue-500/10 border border-blue-500/30"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span>
                      {rec.severity === "critical"
                        ? "🔴"
                        : rec.severity === "warning"
                          ? "🟡"
                          : "🟢"}
                    </span>
                    <span className="font-semibold">{rec.title}</span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {rec.category}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mb-1">{rec.detail}</p>
                  {rec.suggestedAction && (
                    <p className="text-xs font-medium mt-1">
                      💡 <span className="font-semibold">Action:</span> {rec.suggestedAction}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Basic Info ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Contractor / Party</Label>
            <Input
              value={formData.partyName}
              onChange={(e) => setFormData({ ...formData, partyName: e.target.value })}
              disabled={isConfirmed}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Homeowner</Label>
            <Input
              value={formData.counterpartyName}
              onChange={(e) => setFormData({ ...formData, counterpartyName: e.target.value })}
              disabled={isConfirmed}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Effective Date</Label>
            <Input
              type="date"
              value={formData.effectiveDate}
              onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })}
              disabled={isConfirmed}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Completion Date</Label>
            <Input
              type="date"
              value={formData.completionDate}
              onChange={(e) => setFormData({ ...formData, completionDate: e.target.value })}
              disabled={isConfirmed}
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Total Value</Label>
            <Input
              type="number"
              step="0.01"
              value={formData.totalValue}
              onChange={(e) =>
                setFormData({ ...formData, totalValue: parseFloat(e.target.value) })
              }
              disabled={isConfirmed}
            />
          </div>
        </div>

        {/* ── Scope Summary ──────────────────────────────────────── */}
        {formData.scopeSummary && (
          <div>
            <Label className="mb-1.5 block">Scope of Work</Label>
            <div className="bg-muted p-3 rounded-md text-sm whitespace-pre-wrap">
              {formData.scopeSummary}
            </div>
          </div>
        )}

        {/* ── Clauses ────────────────────────────────────────────── */}
        {clauses.length > 0 && (
          <div>
            <Label className="mb-2 block font-semibold">
              Contract Clauses ({clauses.length})
            </Label>
            <div className="border rounded-md divide-y overflow-hidden">
              {clauses.map((clause: any, i: number) => (
                <div key={i} className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge
                      variant={
                        clause.riskLevel === "high"
                          ? "destructive"
                          : clause.riskLevel === "medium"
                            ? "default"
                            : "secondary"
                      }
                      className="text-xs"
                    >
                      {clause.riskLevel} risk
                    </Badge>
                    <span className="font-medium text-sm capitalize">
                      {clause.type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{clause.summary}</p>
                  {clause.fullText && (
                    <details className="mt-1">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        View clause text
                      </summary>
                      <pre className="text-xs bg-muted p-2 rounded mt-1 whitespace-pre-wrap">
                        {clause.fullText}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Payment Milestones ──────────────────────────────────── */}
        {milestones.length > 0 && (
          <div>
            <Label className="mb-2 block font-semibold">
              Payment Milestones ({milestones.length})
            </Label>
            <div className="border rounded-md divide-y overflow-hidden">
              <div className="grid grid-cols-12 gap-2 p-2 bg-muted/50 text-xs font-semibold text-muted-foreground">
                <div className="col-span-4">Milestone</div>
                <div className="col-span-3">Trigger</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-3 text-right">Due Date</div>
              </div>
              {milestones.map((m: any, i: number) => (
                <div key={i} className="grid grid-cols-12 gap-2 p-2 text-sm items-center">
                  <div className="col-span-4">{m.name}</div>
                  <div className="col-span-3 text-muted-foreground text-xs">{m.trigger}</div>
                  <div className="col-span-2 text-right font-medium">
                    ${m.amount?.toLocaleString()}
                  </div>
                  <div className="col-span-3 text-right text-muted-foreground">
                    {m.dueDate || "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex justify-end gap-2 bg-muted/20 py-4">
        {!isConfirmed && (
          <>
            <button
              onClick={() => handleSave("rejected")}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium border text-destructive border-destructive/30 bg-destructive/5 hover:bg-destructive/10 rounded-md transition-colors"
            >
              Reject
            </button>
            <button
              onClick={() => handleSave()}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium border rounded-md hover:bg-muted transition-colors"
            >
              Save Draft
            </button>
            <button
              onClick={() => handleSave("confirmed")}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium bg-green-600 text-white hover:bg-green-700 rounded-md transition-colors"
            >
              Confirm Contract
            </button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
