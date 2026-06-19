import React, { useEffect, useState } from "react";
import { Building2, PlusCircle, Search, Settings } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface BusinessType {
  id: number;
  name: string;
  description: string | null;
}

interface Company {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  licenseNumber: string | null;
  notes: string | null;
  businessType: BusinessType | null;
  datetimeCreated: string;
}

export function CompaniesListApp() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newCompany, setNewCompany] = useState({
    name: "",
    businessTypeId: "",
    phone: "",
    email: "",
    website: "",
    licenseNumber: "",
    notes: ""
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/bid-portfolios/companies").then(res => res.json()),
      fetch("/api/bid-portfolios/business-types").then(res => res.json())
    ])
      .then(([companiesData, typesData]) => {
        const compData = companiesData as { companies?: Company[] };
        const tData = typesData as { businessTypes?: BusinessType[] };
        setCompanies(compData.companies || []);
        setBusinessTypes(tData.businessTypes || []);
      })
      .catch((err) => toast.error("Failed to load data"))
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async () => {
    if (!newCompany.name.trim()) {
      toast.error("Company name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...newCompany,
        businessTypeId: newCompany.businessTypeId ? Number(newCompany.businessTypeId) : null
      };
      
      const res = await fetch("/api/bid-portfolios/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error);
      
      toast.success("Company added successfully");
      setIsAddOpen(false);
      setNewCompany({ name: "", businessTypeId: "", phone: "", email: "", website: "", licenseNumber: "", notes: "" });
      
      // Refresh list
      const fresh = (await fetch("/api/bid-portfolios/companies").then(r => r.json())) as { companies?: Company[] };
      setCompanies(fresh.companies || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to add company");
    } finally {
      setSaving(false);
    }
  };

  const filtered = companies.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));

  // Group by business type
  const grouped = filtered.reduce((acc, company) => {
    const typeName = company.businessType?.name || "Uncategorized";
    if (!acc[typeName]) acc[typeName] = [];
    acc[typeName].push(company);
    return acc;
  }, {} as Record<string, Company[]>);

  if (loading) return <div className="py-10 text-center">Loading companies...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search companies..."
            className="pl-8"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <Button onClick={() => setIsAddOpen(true)}>
          <PlusCircle className="mr-2 h-4 w-4" /> Add Company
        </Button>
      </div>

      {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([group, list]) => (
        <div key={group} className="space-y-3">
          <h3 className="text-lg font-semibold tracking-tight border-b pb-1 flex items-center">
            {group} <Badge variant="secondary" className="ml-2">{list.length}</Badge>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map(company => (
              <a key={company.id} href={`/admin/companies/${company.id}`} className="block group">
                <div className="border rounded-lg p-4 hover:border-primary/50 hover:bg-accent/50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="bg-primary/10 p-2 rounded-full">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h4 className="font-medium group-hover:text-primary transition-colors">{company.name}</h4>
                        {company.licenseNumber && (
                          <p className="text-xs text-muted-foreground mt-0.5">Lic: {company.licenseNumber}</p>
                        )}
                      </div>
                    </div>
                  </div>
                  {company.email && <div className="text-sm mt-3 text-muted-foreground truncate">{company.email}</div>}
                  {company.phone && <div className="text-sm text-muted-foreground">{company.phone}</div>}
                </div>
              </a>
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground border rounded-lg border-dashed">
          No companies found.
        </div>
      )}

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Company</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Company Name <span className="text-destructive">*</span></Label>
                <Input value={newCompany.name} onChange={e => setNewCompany({...newCompany, name: e.target.value})} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Business Type</Label>
                <Select value={newCompany.businessTypeId} onValueChange={(v: string | null) => setNewCompany({...newCompany, businessTypeId: v || ""})}>
                  <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                  <SelectContent>
                    {businessTypes.map(bt => (
                      <SelectItem key={bt.id} value={bt.id.toString()}>{bt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={newCompany.email} onChange={e => setNewCompany({...newCompany, email: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={newCompany.phone} onChange={e => setNewCompany({...newCompany, phone: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>License Number</Label>
                <Input value={newCompany.licenseNumber} onChange={e => setNewCompany({...newCompany, licenseNumber: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Website</Label>
                <Input value={newCompany.website} onChange={e => setNewCompany({...newCompany, website: e.target.value})} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Notes</Label>
                <Input value={newCompany.notes} onChange={e => setNewCompany({...newCompany, notes: e.target.value})} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving}>{saving ? "Saving..." : "Save Company"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
