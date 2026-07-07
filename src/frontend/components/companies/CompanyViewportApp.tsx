import React, { useEffect, useState } from "react";
import { Building2, PlusCircle, ExternalLink, MessageSquare, ClipboardCopy, ShieldCheck, Mail, Phone, MapPin, Users, Send } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { EntityDocumentsPanel } from "@/components/documents";

interface BusinessType {
  id: number;
  name: string;
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

interface Contact {
  id: number;
  contactName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isPrimary: boolean;
}

interface Portfolio {
  id: number;
  title: string;
  token: string;
  status: string;
  datetimeCreated: string;
}

export function CompanyViewportApp({ companyId }: { companyId: number }) {
  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [insights, setInsights] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Since we don't have a direct /companies/:id GET yet, we fetch all and filter
  // or we can implement the GET /companies/:id endpoint if needed.
  // We'll fetch all companies and filter for now.
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/bid-portfolios/companies");
        const data = (await res.json()) as { companies?: Company[] };
        const found = data.companies?.find((c: Company) => c.id === companyId);
        setCompany(found || null);

        const [contactsRes, insightsRes] = await Promise.all([
          fetch(`/api/bid-portfolios/companies/${companyId}/contacts`),
          fetch(`/api/bid-portfolios/companies/${companyId}/insights`)
        ]);

        const contactsData = (await contactsRes.json()) as { contacts?: Contact[] };
        const insightsData = (await insightsRes.json()) as { insights?: any, activity?: any[] };

        setContacts(contactsData.contacts || []);
        setInsights(insightsData.insights || null);
        setActivity(insightsData.activity || []);

      } catch (err) {
        toast.error("Failed to load company details");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [companyId]);

  if (loading) return <div className="py-10 text-center">Loading company details...</div>;
  if (!company) return <div className="py-10 text-center text-destructive">Company not found</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start justify-between gap-4">
        <div className="flex items-start space-x-4">
          <div className="bg-primary/10 p-3 rounded-lg mt-1">
            <Building2 className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{company.name}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
              <Badge variant="outline" className="uppercase bg-background">
                {company.businessType?.name || "Uncategorized"}
              </Badge>
              {company.licenseNumber && (
                <span className="flex items-center"><ShieldCheck className="w-3.5 h-3.5 mr-1" /> Lic: {company.licenseNumber}</span>
              )}
              {company.website && (
                <a href={company.website.startsWith("http") ? company.website : `https://${company.website}`} target="_blank" rel="noreferrer" className="flex items-center hover:text-primary transition-colors">
                  <ExternalLink className="w-3.5 h-3.5 mr-1" /> Website
                </a>
              )}
            </div>
            {(company.phone || company.email) && (
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm">
                {company.phone && <span className="flex items-center"><Phone className="w-3.5 h-3.5 mr-1.5" /> {company.phone}</span>}
                {company.email && <span className="flex items-center"><Mail className="w-3.5 h-3.5 mr-1.5" /> {company.email}</span>}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 w-full md:w-auto">
          <Button variant="default" onClick={() => window.location.href = `/admin/bids/new`}>
            <Send className="w-4 h-4 mr-2" /> Send New Bid Request
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="rolodex">Rolodex ({contacts.length})</TabsTrigger>
              <TabsTrigger value="bids">Bid History</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
            </TabsList>
            
            <TabsContent value="overview" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Company Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{company.notes || "No notes added yet."}</p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Permit Intelligence
                    {insights && <Badge variant="secondary">Active</Badge>}
                  </CardTitle>
                  <CardDescription>Recent building permits found for this contractor</CardDescription>
                </CardHeader>
                <CardContent>
                  {!insights ? (
                    <div className="text-sm text-muted-foreground">No permit intelligence data available for this company.</div>
                  ) : (
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-muted-foreground uppercase">Total Projects</div>
                          <div className="text-2xl font-semibold">{insights.totalProjects || 0}</div>
                        </div>
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-muted-foreground uppercase">Active Permits</div>
                          <div className="text-2xl font-semibold">{insights.activePermits || 0}</div>
                        </div>
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-muted-foreground uppercase">Avg Valuation</div>
                          <div className="text-2xl font-semibold">${(insights.avgValuation || 0).toLocaleString()}</div>
                        </div>
                        <div className="border rounded-md p-3">
                          <div className="text-xs text-muted-foreground uppercase">Last Active</div>
                          <div className="text-sm font-medium mt-1">
                            {insights.lastActiveDate ? new Date(insights.lastActiveDate).toLocaleDateString() : "Unknown"}
                          </div>
                        </div>
                      </div>

                      {activity.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium mb-3">Recent Projects</h4>
                          <div className="space-y-3">
                            {activity.slice(0, 5).map((act, i) => (
                              <div key={i} className="flex justify-between items-center text-sm border-b pb-2 last:border-0">
                                <div>
                                  <div className="font-medium truncate max-w-sm" title={act.description || ""}>
                                    {act.permitNumber} - {act.streetAddress || "Unknown Address"}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate max-w-sm mt-0.5">
                                    {act.description || "No description"}
                                  </div>
                                </div>
                                <div className="text-right ml-4">
                                  <Badge variant={act.status === "issued" ? "default" : "secondary"}>{act.status}</Badge>
                                  {act.estimatedCost && <div className="text-xs mt-1">${Number(act.estimatedCost).toLocaleString()}</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="rolodex" className="space-y-6 mt-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Company Contacts</CardTitle>
                    <CardDescription>People associated with {company.name}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm"><PlusCircle className="w-4 h-4 mr-2" /> Add Contact</Button>
                </CardHeader>
                <CardContent>
                  {contacts.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">No contacts mapped to this company.</div>
                  ) : (
                    <div className="space-y-4">
                      {contacts.map(c => (
                        <div key={c.id} className="flex items-start justify-between border rounded-lg p-4">
                          <div className="flex items-start space-x-3">
                            <div className="bg-secondary/30 p-2 rounded-full mt-1">
                              <Users className="h-4 w-4 text-secondary-foreground" />
                            </div>
                            <div>
                              <h4 className="font-medium flex items-center">
                                {c.contactName}
                                {c.isPrimary && <Badge className="ml-2 py-0 h-4 text-[10px]">Primary</Badge>}
                              </h4>
                              {c.title && <p className="text-xs text-muted-foreground">{c.title}</p>}
                              <div className="flex flex-wrap gap-3 mt-2 text-sm">
                                {c.email && <a href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a>}
                                {c.phone && <span>{c.phone}</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="bids" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Bid History</CardTitle>
                  <CardDescription>Portfolios and bids associated with this company</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Bid history functionality coming soon.
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents" className="space-y-6 mt-6">
              <EntityDocumentsPanel
                entityType="company"
                entityId={String(companyId)}
                heading={`Documents · ${company.name}`}
              />
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Checks & Compliance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">CSLB License Check</span>
                <Badge variant="secondary">Pending Check</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Online Reviews</span>
                <Badge variant="secondary">Pending Check</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Lawsuit History</span>
                <Badge variant="secondary">Pending Check</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
