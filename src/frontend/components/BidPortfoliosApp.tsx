import {
  Archive,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Eye,
  Link2,
  Loader2,
  MessageSquare,
  PlusCircle,
  RefreshCw,
  Users,
} from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────

type ActiveTab = "contacts" | "portfolios";

interface Contact {
  id: number;
  companyName: string;
  contactName: string;
  businessType: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  licenseNumber: string | null;
  website: string | null;
  notes: string | null;
  datetimeCreated: string | null;
}

interface Portfolio {
  id: number;
  contactId: number;
  title: string;
  token: string;
  status: string;
  welcomeMessage: string | null;
  overviewStatement: string | null;
  showBudgetRanges: boolean;
  expirationDate: string | null;
  contactName?: string;
  companyName?: string;
  datetimeCreated: string | null;
}

interface RoomConfig {
  id?: number;
  portfolioId: number;
  roomId: number;
  roomName?: string;
  showPhotos: boolean;
  showDimensions: boolean;
  showConditions: boolean;
  showScope: boolean;
  showInspiration: boolean;
}

interface Room {
  id: number;
  name: string;
  roomType: string | null;
}

interface Comment {
  id: number;
  portfolioId: number;
  authorName: string | null;
  content: string;
  slideType: string | null;
  isRead: boolean;
  datetimeCreated: string | null;
}

interface Analytics {
  pageViews: number;
  uniqueVisitors: number;
  lastViewedAt: string | null;
}

interface ContactFormState {
  companyName: string;
  contactName: string;
  businessType: string;
  title: string;
  email: string;
  phone: string;
  licenseNumber: string;
  website: string;
  notes: string;
}

interface PortfolioFormState {
  contactId: string;
  title: string;
  welcomeMessage: string;
  overviewStatement: string;
  showBudgetRanges: boolean;
  expirationDate: string;
}

const EMPTY_CONTACT_FORM: ContactFormState = {
  companyName: "",
  contactName: "",
  businessType: "contractor",
  title: "",
  email: "",
  phone: "",
  licenseNumber: "",
  website: "",
  notes: "",
};

const EMPTY_PORTFOLIO_FORM: PortfolioFormState = {
  contactId: "",
  title: "",
  welcomeMessage: "",
  overviewStatement: "",
  showBudgetRanges: false,
  expirationDate: "",
};

const BUSINESS_TYPES = [
  { value: "contractor", label: "Contractor" },
  { value: "architect", label: "Architect" },
  { value: "civil_engineer", label: "Civil Engineer" },
  { value: "other", label: "Other" },
] as const;

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

function formatBusinessType(value: string): string {
  const entry = BUSINESS_TYPES.find((bt) => bt.value === value);
  return entry?.label ?? value;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      return "default";
    case "expired":
      return "outline";
    case "archived":
      return "destructive";
    default:
      return "secondary";
  }
}

// ── Main Component ───────────────────────────────────────────────────

export function BidPortfoliosApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("contacts");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Contacts state
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactForm, setContactForm] = useState<ContactFormState>(EMPTY_CONTACT_FORM);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [savingContact, setSavingContact] = useState(false);
  const [archiveContactId, setArchiveContactId] = useState<number | null>(null);

  // Portfolios state
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [portfolioDialogOpen, setPortfolioDialogOpen] = useState(false);
  const [portfolioForm, setPortfolioForm] = useState<PortfolioFormState>(EMPTY_PORTFOLIO_FORM);
  const [editingPortfolioId, setEditingPortfolioId] = useState<number | null>(null);
  const [savingPortfolio, setSavingPortfolio] = useState(false);
  const [archivePortfolioId, setArchivePortfolioId] = useState<number | null>(null);

  // Detail expansion state
  const [expandedPortfolioId, setExpandedPortfolioId] = useState<number | null>(null);

  // Expanded contact detail state
  const [expandedContactId, setExpandedContactId] = useState<number | null>(null);
  const [loadingContactDetail, setLoadingContactDetail] = useState(false);
  const [contactInsights, setContactInsights] = useState<any>(null);
  const [contactActivity, setContactActivity] = useState<any[]>([]);
  const [roomConfigs, setRoomConfigs] = useState<RoomConfig[]>([]);
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingRooms, setSavingRooms] = useState(false);

  // ── Data Fetching ─────────────────────────────────────────────────

  const loadContacts = useCallback(async () => {
    const response = await fetch("/api/bid-portfolios/contacts");
    const data = (await response.json()) as { contacts?: Contact[]; error?: string };
    if (!response.ok) throw new Error(data.error || "Failed to load contacts");
    setContacts(data.contacts || []);
  }, []);

  const loadPortfolios = useCallback(async () => {
    const response = await fetch("/api/bid-portfolios");
    const data = (await response.json()) as { portfolios?: Portfolio[]; error?: string };
    if (!response.ok) throw new Error(data.error || "Failed to load portfolios");
    setPortfolios(data.portfolios || []);
  }, []);

  const loadAllRooms = useCallback(async () => {
    try {
      const response = await fetch("/api/rooms");
      const data = (await response.json()) as { rooms?: Room[]; error?: string };
      if (response.ok) setAllRooms(data.rooms || []);
    } catch {
      // Room loading is non-critical
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadContacts(), loadPortfolios(), loadAllRooms()]);
  }, [loadContacts, loadPortfolios, loadAllRooms]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        await loadAll();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [loadAll]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh data");
    } finally {
      setRefreshing(false);
    }
  }, [loadAll]);

  // ── Contact CRUD ──────────────────────────────────────────────────

  const openNewContact = () => {
    setContactForm(EMPTY_CONTACT_FORM);
    setEditingContactId(null);
    setContactDialogOpen(true);
  };

  const openEditContact = (contact: Contact) => {
    setContactForm({
      companyName: contact.companyName,
      contactName: contact.contactName,
      businessType: contact.businessType,
      title: contact.title ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      licenseNumber: contact.licenseNumber ?? "",
      website: contact.website ?? "",
      notes: contact.notes ?? "",
    });
    setEditingContactId(contact.id);
    setContactDialogOpen(true);
  };

  const saveContact = async () => {
    if (!contactForm.companyName.trim() || !contactForm.contactName.trim() || !contactForm.businessType) {
      toast.error("Company name, contact name, and business type are required.");
      return;
    }
    setSavingContact(true);
    try {
      const url = editingContactId
        ? `/api/bid-portfolios/contacts/${editingContactId}`
        : "/api/bid-portfolios/contacts";
      const method = editingContactId ? "PUT" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: contactForm.companyName.trim(),
          contactName: contactForm.contactName.trim(),
          businessType: contactForm.businessType,
          title: contactForm.title.trim() || null,
          email: contactForm.email.trim() || null,
          phone: contactForm.phone.trim() || null,
          licenseNumber: contactForm.licenseNumber.trim() || null,
          website: contactForm.website.trim() || null,
          notes: contactForm.notes.trim() || null,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to save contact");
      toast.success(editingContactId ? "Contact updated." : "Contact created.");
      setContactDialogOpen(false);
      await loadContacts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save contact");
    } finally {
      setSavingContact(false);
    }
  };

  const archiveContact = async () => {
    if (!archiveContactId) return;
    try {
      const response = await fetch(`/api/bid-portfolios/contacts/${archiveContactId}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to archive contact");
      toast.success("Contact archived.");
      setArchiveContactId(null);
      await loadContacts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to archive contact");
    }
  };

  // ── Portfolio CRUD ────────────────────────────────────────────────

  const openNewPortfolio = () => {
    window.location.href = "/admin/bids/new";
  };

  const openEditPortfolio = (portfolio: Portfolio) => {
    setPortfolioForm({
      contactId: String(portfolio.contactId),
      title: portfolio.title,
      welcomeMessage: portfolio.welcomeMessage ?? "",
      overviewStatement: portfolio.overviewStatement ?? "",
      showBudgetRanges: portfolio.showBudgetRanges,
      expirationDate: portfolio.expirationDate ?? "",
    });
    setEditingPortfolioId(portfolio.id);
    setPortfolioDialogOpen(true);
  };

  const savePortfolio = async () => {
    if (!portfolioForm.contactId || !portfolioForm.title.trim()) {
      toast.error("Contact and title are required.");
      return;
    }
    setSavingPortfolio(true);
    try {
      const url = editingPortfolioId
        ? `/api/bid-portfolios/${editingPortfolioId}`
        : "/api/bid-portfolios";
      const method = editingPortfolioId ? "PUT" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: Number(portfolioForm.contactId),
          title: portfolioForm.title.trim(),
          welcomeMessage: portfolioForm.welcomeMessage.trim() || null,
          overviewStatement: portfolioForm.overviewStatement.trim() || null,
          showBudgetRanges: portfolioForm.showBudgetRanges,
          expirationDate: portfolioForm.expirationDate || null,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to save portfolio");
      toast.success(editingPortfolioId ? "Portfolio updated." : "Portfolio created.");
      setPortfolioDialogOpen(false);
      await loadPortfolios();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save portfolio");
    } finally {
      setSavingPortfolio(false);
    }
  };

  const archivePortfolio = async () => {
    if (!archivePortfolioId) return;
    try {
      const response = await fetch(`/api/bid-portfolios/${archivePortfolioId}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to archive portfolio");
      toast.success("Portfolio archived.");
      setArchivePortfolioId(null);
      if (expandedPortfolioId === archivePortfolioId) setExpandedPortfolioId(null);
      await loadPortfolios();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to archive portfolio");
    }
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/bid/${token}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied to clipboard."),
      () => toast.error("Failed to copy link."),
    );
  };

  // ── Portfolio Detail (Rooms, Comments, Analytics) ─────────────────

  const togglePortfolioDetail = async (portfolioId: number) => {
    if (expandedPortfolioId === portfolioId) {
      setExpandedPortfolioId(null);
      return;
    }
    setExpandedPortfolioId(portfolioId);
    setLoadingDetail(true);
    setRoomConfigs([]);
    setComments([]);
    setAnalytics(null);
    try {
      const [roomsRes, commentsRes, analyticsRes] = await Promise.all([
        fetch(`/api/bid-portfolios/${portfolioId}/rooms`),
        fetch(`/api/bid-portfolios/${portfolioId}/comments`),
        fetch(`/api/bid-portfolios/${portfolioId}/analytics`),
      ]);
      const roomsData = (await roomsRes.json()) as { roomConfigs?: RoomConfig[]; error?: string };
      const commentsData = (await commentsRes.json()) as { comments?: Comment[]; error?: string };
      const analyticsData = (await analyticsRes.json()) as Analytics & { error?: string };

      if (roomsRes.ok) setRoomConfigs(roomsData.roomConfigs || []);
      if (commentsRes.ok) setComments(commentsData.comments || []);
      if (analyticsRes.ok) setAnalytics(analyticsData);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load portfolio details");
    } finally {
      setLoadingDetail(false);
    }
  };

  const toggleContactDetail = async (contactId: number) => {
    if (expandedContactId === contactId) {
      setExpandedContactId(null);
      return;
    }
    setExpandedContactId(contactId);
    setLoadingContactDetail(true);
    setContactInsights(null);
    setContactActivity([]);
    try {
      const res = await fetch(`/api/bid-portfolios/contacts/${contactId}/insights`);
      const data = await res.json() as { insights?: any; activity?: any[]; error?: string };
      if (res.ok) {
        setContactInsights(data.insights || null);
        setContactActivity(data.activity || []);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load contact insights");
    } finally {
      setLoadingContactDetail(false);
    }
  };

  const toggleRoomConfig = (roomId: number, field: keyof RoomConfig) => {
    setRoomConfigs((prev) => {
      const existing = prev.find((rc) => rc.roomId === roomId);
      if (existing) {
        return prev.map((rc) =>
          rc.roomId === roomId ? { ...rc, [field]: !rc[field] } : rc,
        );
      }
      // Add new room config with this field toggled on
      return [
        ...prev,
        {
          portfolioId: expandedPortfolioId!,
          roomId,
          showPhotos: field === "showPhotos",
          showDimensions: field === "showDimensions",
          showConditions: field === "showConditions",
          showScope: field === "showScope",
          showInspiration: field === "showInspiration",
        },
      ];
    });
  };

  const saveRoomConfigs = async () => {
    if (!expandedPortfolioId) return;
    setSavingRooms(true);
    try {
      const response = await fetch(`/api/bid-portfolios/${expandedPortfolioId}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomConfigs }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to save room config");
      toast.success("Room configuration saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save room config");
    } finally {
      setSavingRooms(false);
    }
  };

  const markCommentRead = async (commentId: number) => {
    try {
      const response = await fetch(`/api/bid-portfolios/comments/${commentId}/read`, {
        method: "PUT",
      });
      if (response.ok) {
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, isRead: true } : c)),
        );
      }
    } catch {
      // non-critical
    }
  };

  // ── Tab button helper (matches AdminDashboardApp pattern) ─────────

  const tabButton = (id: ActiveTab, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button
      key={id}
      type="button"
      onClick={() => setActiveTab(id)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ring-1 transition-all",
        activeTab === id
          ? "bg-primary/10 text-primary ring-primary/40"
          : "bg-card/20 text-muted-foreground ring-border/30 hover:text-foreground hover:ring-border/60",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );

  const tabs = (
    <div className="flex flex-wrap gap-2 border-b border-border/10 pb-3">
      {tabButton("contacts", "Contacts", Users)}
      {tabButton("portfolios", "Portfolios", Building2)}
    </div>
  );

  // ── Loading state ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        {tabs}
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading bid portfolio data...
        </div>
      </div>
    );
  }

  // ── Helper: find contact name for portfolio display ───────────────

  const contactNameFor = (portfolio: Portfolio): string => {
    if (portfolio.companyName) return portfolio.companyName;
    const contact = contacts.find((c) => c.id === portfolio.contactId);
    return contact?.companyName ?? "Unknown";
  };

  const unreadCommentCount = comments.filter((c) => !c.isRead).length;

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {tabs}

      {/* ── Contacts Tab ─────────────────────────────────────────── */}
      {activeTab === "contacts" && (
        <>
          <Card className="ring-1 ring-border/40">
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-2xl">Contacts</CardTitle>
                <CardDescription>
                  Manage contractor, architect, and engineer contacts for bid outreach.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
                  {refreshing ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Refreshing
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 size-4" />
                      Refresh
                    </>
                  )}
                </Button>
                <Button size="sm" onClick={openNewContact}>
                  <PlusCircle className="mr-2 size-4" />
                  Add Contact
                </Button>
              </div>
            </CardHeader>
          </Card>

          <Card className="ring-1 ring-border/40">
            <CardContent className="space-y-3 pt-6">
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No contacts yet. Add your first contact to get started.
                </p>
              ) : (
                contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="rounded-lg bg-muted/20 p-3 ring-1 ring-border/30"
                  >
                    <div className="flex items-start justify-between gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => toggleContactDetail(contact.id)}
                          className="inline-flex items-center gap-1.5 text-left text-sm font-semibold transition hover:text-primary"
                        >
                          {expandedContactId === contact.id ? (
                            <ChevronDown className="size-3.5 shrink-0" />
                          ) : (
                            <ChevronRight className="size-3.5 shrink-0" />
                          )}
                          {contact.companyName}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {contact.contactName}
                          {contact.title ? ` · ${contact.title}` : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">
                            {formatBusinessType(contact.businessType)}
                          </Badge>
                          {contact.email ? (
                            <span className="text-xs text-muted-foreground">{contact.email}</span>
                          ) : null}
                          {contact.phone ? (
                            <span className="text-xs text-muted-foreground">{contact.phone}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button variant="ghost" size="sm" onClick={() => openEditContact(contact)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setArchiveContactId(contact.id)}
                        >
                          <Archive className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* ── Expanded Contact Detail Panel ─────────────────── */}
                    {expandedContactId === contact.id && (
                      <div className="border-t border-border/30 p-4">
                        {loadingContactDetail ? (
                          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            Loading permit insights...
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {!contactInsights ? (
                              <p className="text-sm text-muted-foreground">No permit intelligence insights found for this company yet.</p>
                            ) : (
                              <>
                                <div className="rounded-md bg-card/50 p-4 ring-1 ring-border/20">
                                  <div className="mb-2 flex items-center justify-between">
                                    <h4 className="font-semibold text-foreground">AI Intelligence</h4>
                                    <Badge variant={contactInsights.riskLevel === 'high' ? 'destructive' : contactInsights.riskLevel === 'medium' ? 'secondary' : 'default'} className="uppercase">
                                      {contactInsights.riskLevel} Risk
                                    </Badge>
                                  </div>
                                  <p className="text-sm text-muted-foreground mb-3">{contactInsights.summary}</p>
                                  {contactInsights.highlights && (
                                    <ul className="space-y-1 text-sm">
                                      {JSON.parse(contactInsights.highlights || "[]").map((hl: string, i: number) => (
                                        <li key={i} className="flex items-start gap-2">
                                          <div className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/50" />
                                          <span>{hl}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                                
                                {contactActivity.length > 0 && (
                                  <div>
                                    <h5 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Permits ({contactActivity.length})</h5>
                                    <div className="max-h-64 space-y-2 overflow-y-auto pr-2">
                                      {contactActivity.map((activity) => (
                                        <div key={activity.id} className="rounded-md bg-background/50 p-2.5 ring-1 ring-border/20 flex flex-col gap-1 text-sm">
                                          <div className="flex items-center justify-between">
                                            <span className="font-medium text-foreground">{activity.permitType}</span>
                                            <span className="text-xs text-muted-foreground">{activity.permitNumber}</span>
                                          </div>
                                          <div className="flex items-center justify-between">
                                            <span className="text-xs text-muted-foreground">{activity.propertyAddress}</span>
                                            <Badge variant="outline" className="text-[10px] h-4 py-0">{activity.permitStatus}</Badge>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Portfolios Tab ───────────────────────────────────────── */}
      {activeTab === "portfolios" && (
        <>
          <Card className="ring-1 ring-border/40">
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-2xl">Portfolios</CardTitle>
                <CardDescription>
                  Create shareable bid portfolios and track engagement.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
                  {refreshing ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Refreshing
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 size-4" />
                      Refresh
                    </>
                  )}
                </Button>
                <Button size="sm" onClick={openNewPortfolio}>
                  <PlusCircle className="mr-2 size-4" />
                  Create Portfolio
                </Button>
              </div>
            </CardHeader>
          </Card>

          <Card className="ring-1 ring-border/40">
            <CardContent className="space-y-3 pt-6">
              {portfolios.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No portfolios yet. Create your first bid portfolio.
                </p>
              ) : (
                portfolios.map((portfolio) => {
                  const isExpanded = expandedPortfolioId === portfolio.id;
                  return (
                    <div
                      key={portfolio.id}
                      className="rounded-lg bg-muted/20 ring-1 ring-border/30"
                    >
                      <div className="flex items-start justify-between gap-3 p-3">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => togglePortfolioDetail(portfolio.id)}
                            className="inline-flex items-center gap-1.5 text-left text-sm font-semibold transition hover:text-primary"
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-3.5 shrink-0" />
                            ) : (
                              <ChevronRight className="size-3.5 shrink-0" />
                            )}
                            {portfolio.title}
                          </button>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {contactNameFor(portfolio)} · Created {formatDate(portfolio.datetimeCreated)}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <Badge
                              variant={statusVariant(portfolio.status)}
                              className={cn(
                                portfolio.status === "active" && "bg-emerald-500/20 text-emerald-400",
                                portfolio.status === "expired" && "bg-amber-500/20 text-amber-400",
                              )}
                            >
                              {portfolio.status}
                            </Badge>
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Link2 className="size-3" />
                              {portfolio.token}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyLink(portfolio.token)}
                            title="Copy shareable link"
                          >
                            <ClipboardCopy className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEditPortfolio(portfolio)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setArchivePortfolioId(portfolio.id)}
                          >
                            <Archive className="size-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* ── Expanded Detail Panel ─────────────────── */}
                      {isExpanded && (
                        <div className="border-t border-border/30 p-3">
                          {loadingDetail ? (
                            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                              <Loader2 className="size-4 animate-spin" />
                              Loading details...
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {/* Analytics summary */}
                              {analytics && (
                                <div className="grid gap-3 sm:grid-cols-3">
                                  <div className="rounded-md bg-card/50 p-2 ring-1 ring-border/20">
                                    <p className="text-xs text-muted-foreground">Page Views</p>
                                    <p className="text-lg font-semibold">{analytics.pageViews}</p>
                                  </div>
                                  <div className="rounded-md bg-card/50 p-2 ring-1 ring-border/20">
                                    <p className="text-xs text-muted-foreground">Unique Visitors</p>
                                    <p className="text-lg font-semibold">{analytics.uniqueVisitors}</p>
                                  </div>
                                  <div className="rounded-md bg-card/50 p-2 ring-1 ring-border/20">
                                    <p className="text-xs text-muted-foreground">Last Viewed</p>
                                    <p className="text-sm font-medium">
                                      {formatDate(analytics.lastViewedAt)}
                                    </p>
                                  </div>
                                </div>
                              )}

                              <Separator />

                              {/* Room configuration */}
                              <div>
                                <div className="mb-2 flex items-center justify-between">
                                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Room Configuration
                                  </p>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={saveRoomConfigs}
                                    disabled={savingRooms}
                                  >
                                    {savingRooms ? (
                                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                    ) : null}
                                    Save Rooms
                                  </Button>
                                </div>
                                {allRooms.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    No rooms found. Add rooms to the project first.
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    {allRooms.map((room) => {
                                      const cfg = roomConfigs.find((rc) => rc.roomId === room.id);
                                      return (
                                        <div
                                          key={room.id}
                                          className="rounded-md bg-card/30 p-2 ring-1 ring-border/20"
                                        >
                                          <p className="mb-1.5 text-sm font-medium">{room.name}</p>
                                          <div className="flex flex-wrap gap-3">
                                            {(
                                              [
                                                ["showPhotos", "Photos"],
                                                ["showDimensions", "Dimensions"],
                                                ["showConditions", "Conditions"],
                                                ["showScope", "Scope"],
                                                ["showInspiration", "Inspiration"],
                                              ] as const
                                            ).map(([field, label]) => (
                                              <label
                                                key={field}
                                                className="inline-flex cursor-pointer items-center gap-1.5 text-xs"
                                              >
                                                <input
                                                  type="checkbox"
                                                  checked={!!cfg?.[field]}
                                                  onChange={() => toggleRoomConfig(room.id, field)}
                                                  className="size-3.5 rounded border-border accent-primary"
                                                />
                                                {label}
                                              </label>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              <Separator />

                              {/* Comments */}
                              <div>
                                <div className="mb-2 flex items-center gap-2">
                                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Comments
                                  </p>
                                  {unreadCommentCount > 0 && (
                                    <Badge variant="destructive" className="h-5 min-w-5 justify-center px-1 text-[10px]">
                                      {unreadCommentCount}
                                    </Badge>
                                  )}
                                </div>
                                {comments.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">No comments yet.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {comments.map((comment) => (
                                      <div
                                        key={comment.id}
                                        className={cn(
                                          "rounded-md p-2 ring-1",
                                          comment.isRead
                                            ? "bg-card/30 ring-border/20"
                                            : "bg-primary/5 ring-primary/30",
                                        )}
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <div>
                                            <p className="text-xs font-medium">
                                              {comment.authorName || "Anonymous"}
                                              {comment.slideType ? (
                                                <span className="ml-1.5 text-muted-foreground">
                                                  on {comment.slideType}
                                                </span>
                                              ) : null}
                                            </p>
                                            <p className="mt-0.5 text-sm">{comment.content}</p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                              {formatDate(comment.datetimeCreated)}
                                            </p>
                                          </div>
                                          {!comment.isRead && (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => markCommentRead(comment.id)}
                                            >
                                              <Eye className="size-3.5" />
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Contact Dialog ───────────────────────────────────────── */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingContactId ? "Edit Contact" : "Add Contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="contact-company">Company Name *</Label>
                <Input
                  id="contact-company"
                  value={contactForm.companyName}
                  onChange={(e) =>
                    setContactForm((prev) => ({ ...prev, companyName: e.target.value }))
                  }
                  placeholder="Acme Construction"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-name">Contact Name *</Label>
                <Input
                  id="contact-name"
                  value={contactForm.contactName}
                  onChange={(e) =>
                    setContactForm((prev) => ({ ...prev, contactName: e.target.value }))
                  }
                  placeholder="John Smith"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Business Type *</Label>
              <Select
                value={contactForm.businessType}
                onValueChange={(value) =>
                  setContactForm((prev) => ({ ...prev, businessType: value as string }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {BUSINESS_TYPES.map((bt) => (
                    <SelectItem key={bt.value} value={bt.value}>
                      {bt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="contact-title">Title</Label>
                <Input
                  id="contact-title"
                  value={contactForm.title}
                  onChange={(e) =>
                    setContactForm((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="Project Manager"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-email">Email</Label>
                <Input
                  id="contact-email"
                  type="email"
                  value={contactForm.email}
                  onChange={(e) =>
                    setContactForm((prev) => ({ ...prev, email: e.target.value }))
                  }
                  placeholder="john@acme.com"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="contact-phone">Phone</Label>
                <Input
                  id="contact-phone"
                  type="tel"
                  value={contactForm.phone}
                  onChange={(e) =>
                    setContactForm((prev) => ({ ...prev, phone: e.target.value }))
                  }
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-license">License Number</Label>
                <Input
                  id="contact-license"
                  value={contactForm.licenseNumber}
                  onChange={(e) =>
                    setContactForm((prev) => ({ ...prev, licenseNumber: e.target.value }))
                  }
                  placeholder="CSLB #12345"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-website">Website</Label>
              <Input
                id="contact-website"
                type="url"
                value={contactForm.website}
                onChange={(e) =>
                  setContactForm((prev) => ({ ...prev, website: e.target.value }))
                }
                placeholder="https://acme.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-notes">Notes</Label>
              <Textarea
                id="contact-notes"
                value={contactForm.notes}
                onChange={(e) =>
                  setContactForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="Additional notes about this contact..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveContact} disabled={savingContact}>
              {savingContact && <Loader2 className="mr-2 size-4 animate-spin" />}
              {editingContactId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Portfolio Dialog ──────────────────────────────────────── */}
      <Dialog open={portfolioDialogOpen} onOpenChange={setPortfolioDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingPortfolioId ? "Edit Portfolio" : "Create Portfolio"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Contact *</Label>
              <Select
                value={portfolioForm.contactId}
                onValueChange={(value) =>
                  setPortfolioForm((prev) => ({ ...prev, contactId: value as string }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a contact" />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={String(contact.id)}>
                      {contact.companyName} — {contact.contactName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="portfolio-title">Title *</Label>
              <Input
                id="portfolio-title"
                value={portfolioForm.title}
                onChange={(e) =>
                  setPortfolioForm((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="Kitchen & Bath Remodel Bid Package"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="portfolio-welcome">Welcome Message</Label>
              <Textarea
                id="portfolio-welcome"
                value={portfolioForm.welcomeMessage}
                onChange={(e) =>
                  setPortfolioForm((prev) => ({ ...prev, welcomeMessage: e.target.value }))
                }
                placeholder="A personalized welcome message for the recipient..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="portfolio-overview">Overview Statement</Label>
              <Textarea
                id="portfolio-overview"
                value={portfolioForm.overviewStatement}
                onChange={(e) =>
                  setPortfolioForm((prev) => ({ ...prev, overviewStatement: e.target.value }))
                }
                placeholder="Brief overview of the project scope and goals..."
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={portfolioForm.showBudgetRanges}
                onCheckedChange={(checked) =>
                  setPortfolioForm((prev) => ({ ...prev, showBudgetRanges: checked }))
                }
              />
              <Label>Show Budget Ranges</Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="portfolio-expiration">Expiration Date</Label>
              <Input
                id="portfolio-expiration"
                type="date"
                value={portfolioForm.expirationDate}
                onChange={(e) =>
                  setPortfolioForm((prev) => ({ ...prev, expirationDate: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPortfolioDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={savePortfolio} disabled={savingPortfolio}>
              {savingPortfolio && <Loader2 className="mr-2 size-4 animate-spin" />}
              {editingPortfolioId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Archive Contact Confirmation ──────────────────────────── */}
      <AlertDialog open={archiveContactId !== null} onOpenChange={(open) => { if (!open) setArchiveContactId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive this contact? Portfolios linked to this contact will remain accessible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={archiveContact}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Archive Portfolio Confirmation ─────────────────────────── */}
      <AlertDialog open={archivePortfolioId !== null} onOpenChange={(open) => { if (!open) setArchivePortfolioId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Portfolio</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive this portfolio? The shareable link will stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={archivePortfolio}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
