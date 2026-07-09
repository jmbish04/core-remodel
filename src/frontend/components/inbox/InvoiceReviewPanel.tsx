import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { LineItemMaterialLink } from "./LineItemMaterialLink";

export function InvoiceReviewPanel({ emailId, invoice, onUpdate }: { emailId: number, invoice: any, onUpdate: () => void }) {
  // Receipts (completed purchases) and invoices (bills) share this panel; the
  // `kind` discriminator drives the labels.
  const isReceipt = invoice.kind === "receipt";
  const docLabel = isReceipt ? "Receipt" : "Invoice";
  const [formData, setFormData] = useState({
    vendorName: invoice.vendorName || "",
    invoiceNumber: invoice.invoiceNumber || "",
    invoiceDate: invoice.invoiceDate || "",
    dueDate: invoice.dueDate || "",
    subtotal: invoice.subtotal || 0,
    tax: invoice.tax || 0,
    total: invoice.total || 0,
    notes: invoice.notes || ""
  });
  
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave(status?: "confirmed" | "rejected") {
    setIsSaving(true);
    try {
      // Save fields
      await fetch(`/api/worker-emails/${emailId}/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
      
      // Update status if provided
      if (status) {
        await fetch(`/api/worker-emails/${emailId}/invoices/${invoice.id}/${status}`, {
          method: "POST"
        });
      }
      
      onUpdate();
    } catch (e) {
      console.error("Failed to update invoice:", e);
    } finally {
      setIsSaving(false);
    }
  }

  const isConfirmed = invoice.status === "confirmed";

  return (
    <Card className={isConfirmed ? "border-green-500/50" : ""}>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            {docLabel}: {formData.vendorName}
            {isConfirmed && <Badge variant="default" className="bg-green-500">Confirmed</Badge>}
            {invoice.status === "rejected" && <Badge variant="destructive">Rejected</Badge>}
            {invoice.status === "draft" && <Badge variant="outline">Draft</Badge>}
          </CardTitle>
        </div>
        {invoice.confidence && (
          <div className="text-sm text-muted-foreground">
            AI Confidence: {(invoice.confidence * 100).toFixed(0)}%
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="space-y-1.5">
            <Label>Vendor</Label>
            <Input 
              value={formData.vendorName} 
              onChange={e => setFormData({...formData, vendorName: e.target.value})}
              disabled={isConfirmed}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Invoice #</Label>
            <Input 
              value={formData.invoiceNumber} 
              onChange={e => setFormData({...formData, invoiceNumber: e.target.value})}
              disabled={isConfirmed}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input 
              type="date"
              value={formData.invoiceDate} 
              onChange={e => setFormData({...formData, invoiceDate: e.target.value})}
              disabled={isConfirmed}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Due Date</Label>
            <Input 
              type="date"
              value={formData.dueDate} 
              onChange={e => setFormData({...formData, dueDate: e.target.value})}
              disabled={isConfirmed}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="space-y-1.5">
            <Label>Subtotal</Label>
            <Input 
              type="number"
              step="0.01"
              value={formData.subtotal} 
              onChange={e => setFormData({...formData, subtotal: parseFloat(e.target.value)})}
              disabled={isConfirmed}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tax</Label>
            <Input 
              type="number"
              step="0.01"
              value={formData.tax} 
              onChange={e => setFormData({...formData, tax: parseFloat(e.target.value)})}
              disabled={isConfirmed}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Total</Label>
            <Input 
              type="number"
              step="0.01"
              value={formData.total} 
              onChange={e => setFormData({...formData, total: parseFloat(e.target.value)})}
              disabled={isConfirmed}
            />
          </div>
        </div>

        {invoice.lineItems?.length > 0 && (
          <div className="mb-4">
            <Label className="mb-2 block">
              Line Items ({invoice.lineItems.length}){" "}
              <span className="font-normal text-muted-foreground">
                — link each to your materials schedule
              </span>
            </Label>
            <div className="rounded-md ring-1 ring-border/40 divide-y divide-border/40 overflow-hidden">
              <div className="grid grid-cols-12 gap-2 p-2 bg-muted/50 text-xs font-semibold text-muted-foreground">
                <div className="col-span-6">Description</div>
                <div className="col-span-2 text-right">Qty</div>
                <div className="col-span-2 text-right">Price</div>
                <div className="col-span-2 text-right">Total</div>
              </div>
              {invoice.lineItems.map((li: any) => (
                <div key={li.id} className="p-2">
                  <div className="grid grid-cols-12 gap-2 text-sm items-center">
                    <div className="col-span-6 truncate" title={li.description}>{li.description}</div>
                    <div className="col-span-2 text-right">{li.quantity}</div>
                    <div className="col-span-2 text-right">${li.unitPrice?.toFixed(2)}</div>
                    <div className="col-span-2 text-right">${li.lineTotal?.toFixed(2)}</div>
                  </div>
                  <LineItemMaterialLink
                    emailId={emailId}
                    invoiceId={invoice.id}
                    lineItem={li}
                    onUpdate={onUpdate}
                  />
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
              Confirm {docLabel}
            </button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
