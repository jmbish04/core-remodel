import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import type { Descendant } from "slate";
import {
  Store,
  Phone,
  Mail,
  Globe,
  MapPin,
  User,
  Plus,
  Loader2,
  Paperclip,
  Trash2,
  ArrowLeft,
  Sparkles,
  FileText,
  Search,
  ExternalLink,
  ChevronRight,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface Attachment {
  id: number;
  type: string;
  url: string;
  aiDescription?: string | null;
}

interface ResearchSession {
  id: number;
  status: "pending" | "researching" | "embedding" | "generating" | "complete" | "failed";
  topic: string;
}

interface JournalEntry {
  id: number;
  companyName: string;
  phoneNumber?: string | null;
  email?: string | null;
  website?: string | null;
  contactPerson?: string | null;
  address?: string | null;
  notes?: string | null;
  researchSessionId?: number | null;
  createdAt: string;
  updatedAt: string;
  attachmentsCount: number;
  attachments?: Attachment[];
  researchSession?: ResearchSession | null;
}

function defaultEditorValue(): Descendant[] {
  return [
    {
      type: "p",
      children: [{ text: "Enter your showroom trip notes, pricing details, and conversations here..." }],
    } as unknown as Descendant,
  ];
}

export function ShoppingJournalApp() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Navigation states: 'list' | 'create' | 'view'
  const [viewMode, setViewMode] = useState<"list" | "create" | "view">("list");
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  
  // Form states
  const [companyName, setCompanyName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [address, setAddress] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [saving, setSaving] = useState(false);

  // Plate Editor
  const [editorValue, setEditorValue] = useState<Descendant[]>(defaultEditorValue());
  const editor = usePlateEditor({
    value: editorValue,
  });

  // Fetch entries
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/shopping-journal", { credentials: "include" });
      const payload = await response.json();
      if (response.ok && payload.success) {
        setEntries(payload.entries || []);
      } else {
        toast.error("Failed to load journal entries");
      }
    } catch (error) {
      console.error(error);
      toast.error("Connection error loading journal");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Handle Google Places Auto-enrich
  const handleAutoEnrich = async () => {
    const searchVal = companyName || phoneNumber || address;
    if (!searchVal || searchVal.length < 3) {
      toast.warning("Please enter a company name, phone, or address to enrich.");
      return;
    }

    setEnriching(true);
    try {
      const response = await fetch("/api/shopping-journal/enrich", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchVal }),
      });
      const result = await response.json();

      if (response.ok && result.success && result.data) {
        const { companyName: cName, address: addr, phoneNumber: phone, website: web } = result.data;
        if (cName) setCompanyName(cName);
        if (addr) setAddress(addr);
        if (phone) setPhoneNumber(phone);
        if (web) setWebsite(web);
        toast.success("Details enriched successfully via Google Places!");
      } else {
        toast.error(result.message || "No matching company details found.");
      }
    } catch (err) {
      toast.error("Enrichment failed. Quota limit exceeded or network failure.");
    } finally {
      setEnriching(false);
    }
  };

  // Handle create
  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) {
      toast.error("Company name is required");
      return;
    }

    setSaving(true);
    try {
      // 1. Create the journal entry
      const response = await fetch("/api/shopping-journal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          phoneNumber: phoneNumber || null,
          email: email || null,
          website: website || null,
          contactPerson: contactPerson || null,
          address: address || null,
          notes: JSON.stringify(editorValue),
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to save showroom entry");
      }

      const entryId = payload.entryId;

      // 2. Upload attachments if any exist
      if (files.length > 0) {
        setUploadProgress(true);
        const formData = new FormData();
        files.forEach((file) => {
          formData.append("files", file);
        });

        const uploadRes = await fetch(`/api/shopping-journal/${entryId}/attachments`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        const uploadPayload = await uploadRes.json();
        if (!uploadRes.ok) {
          toast.error(uploadPayload.error || "Failed to upload attachments");
        }
      }

      toast.success("Showroom visit logged! AI agents dispatched to analyze cost impact & initiate deep research.");
      
      // Reset form
      setCompanyName("");
      setPhoneNumber("");
      setEmail("");
      setWebsite("");
      setContactPerson("");
      setAddress("");
      setFiles([]);
      setEditorValue(defaultEditorValue());
      setViewMode("list");
      fetchEntries();
    } catch (err: any) {
      toast.error(err.message || "Failed to log visit");
    } finally {
      setSaving(false);
      setUploadProgress(false);
    }
  };

  // Handle delete
  const handleDeleteEntry = async (id: number) => {
    if (!confirm("Are you sure you want to delete this showroom visit log? All attachments will be removed.")) {
      return;
    }

    try {
      const response = await fetch(`/api/shopping-journal/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (response.ok) {
        toast.success("Log deleted successfully");
        setViewMode("list");
        setSelectedEntry(null);
        fetchEntries();
      } else {
        toast.error("Failed to delete log");
      }
    } catch {
      toast.error("Delete operation failed");
    }
  };

  // View specific entry details
  const handleOpenEntry = async (entry: JournalEntry) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/shopping-journal/${entry.id}`, { credentials: "include" });
      const payload = await response.json();
      if (response.ok && payload.success) {
        setSelectedEntry(payload.entry);
        setViewMode("view");
      } else {
        toast.error("Failed to load details");
      }
    } catch {
      toast.error("Network error loading entry detail");
    } finally {
      setLoading(false);
    }
  };

  // Filter entries
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const norm = searchQuery.toLowerCase();
    return entries.filter(
      (e) =>
        e.companyName.toLowerCase().includes(norm) ||
        (e.contactPerson && e.contactPerson.toLowerCase().includes(norm)) ||
        (e.address && e.address.toLowerCase().includes(norm))
    );
  }, [entries, searchQuery]);

  // Read-only Plate Renderer
  const renderReadOnlyNotes = (notesJson: string | null | undefined) => {
    if (!notesJson) return <p className="text-muted-foreground italic text-xs">No notes captured.</p>;
    try {
      const parsed = JSON.parse(notesJson) as Descendant[];
      return (
        <div className="space-y-1.5 text-sm text-foreground/80 leading-relaxed">
          {parsed.map((node: any, idx: number) => {
            if (node.type === "p") {
              return <p key={idx}>{node.children?.[0]?.text || ""}</p>;
            }
            return <div key={idx}>{node.children?.[0]?.text || ""}</div>;
          })}
        </div>
      );
    } catch {
      return <p className="text-sm">{notesJson}</p>;
    }
  };

  if (loading && viewMode === "list") {
    return (
      <div className="flex min-h-[50svh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading shopping journals...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground py-6 px-4 md:px-8 space-y-6">
      
      {/* 1. TIMELINE / DASHBOARD LIST VIEW */}
      {viewMode === "list" && (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <Store className="size-6 text-zinc-400" />
                Shopping Journal
              </h1>
              <p className="text-sm text-muted-foreground">
                Document showroom visits, quotes, verbal agreements, and run automated AI deep-research audits.
              </p>
            </div>
            <Button
              className="w-full md:w-auto bg-zinc-200 text-zinc-950 hover:bg-zinc-300 ring-1 ring-border/40 font-medium"
              onClick={() => {
                setEditorValue(defaultEditorValue());
                setViewMode("create");
              }}
            >
              <Plus className="mr-2 size-4" />
              Log Showroom Trip
            </Button>
          </div>

          <div className="flex items-center gap-3 bg-card/60 backdrop-blur border border-border/40 rounded-lg px-3 py-2">
            <Search className="size-4 text-muted-foreground" />
            <Input
              className="bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/60 h-8"
              placeholder="Search company, contact, or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {filteredEntries.length === 0 ? (
            <Card className="border border-border/40 bg-card/30 py-12 flex flex-col items-center justify-center text-center space-y-4">
              <Store className="size-10 text-muted-foreground/40" />
              <div className="space-y-1">
                <CardTitle className="text-zinc-300">No Showrooms Visited Yet</CardTitle>
                <CardDescription className="max-w-md">
                  Click 'Log Showroom Trip' to store contractor interviews, fixture shopping pricing details, and photos.
                </CardDescription>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredEntries.map((entry) => (
                <Card
                  key={entry.id}
                  onClick={() => handleOpenEntry(entry)}
                  className="group hover:border-zinc-500 cursor-pointer border border-border/40 bg-card/30 transition duration-200 flex flex-col justify-between hover:bg-card/50"
                >
                  <CardHeader className="space-y-1.5 pb-3">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-sm font-semibold truncate group-hover:text-zinc-200 pr-2">
                        {entry.companyName}
                      </CardTitle>
                      <Badge variant="outline" className="text-[10px] text-zinc-400 capitalize whitespace-nowrap">
                        {entry.attachmentsCount} {entry.attachmentsCount === 1 ? "file" : "files"}
                      </Badge>
                    </div>
                    {entry.address && (
                      <p className="text-[11px] text-muted-foreground/80 flex items-center gap-1 truncate">
                        <MapPin className="size-3 flex-shrink-0" />
                        {entry.address}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3 pb-4 flex-1 flex flex-col justify-between">
                    <div className="text-xs text-muted-foreground/90 line-clamp-3 leading-relaxed mb-3">
                      {entry.notes ? (
                        JSON.parse(entry.notes)[0]?.children?.[0]?.text || "No descriptive notes captured."
                      ) : (
                        "No notes captured."
                      )}
                    </div>
                    
                    <div className="space-y-2 pt-2 border-t border-border/20">
                      {entry.researchSession ? (
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground/75 flex items-center gap-1">
                            <Sparkles className="size-3 text-emerald-400 animate-pulse" />
                            Deep Research:
                          </span>
                          <span
                            className={cn(
                              "font-medium",
                              entry.researchSession.status === "complete" ? "text-emerald-400" :
                              entry.researchSession.status === "failed" ? "text-red-400" :
                              "text-amber-400"
                            )}
                          >
                            {entry.researchSession.status === "complete" ? "Ready" :
                             entry.researchSession.status === "failed" ? "Failed" :
                             "Processing..."}
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-muted-foreground/50 italic flex items-center gap-1">
                          No research session linked.
                        </div>
                      )}
                      
                      <div className="text-[10px] text-muted-foreground/40 text-right">
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. LOG / NEW SHOPPING TRIP VIEWPORT */}
      {viewMode === "create" && (
        <Card className="border border-border/40 bg-card/30 max-w-4xl mx-auto ring-1 ring-border/40">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/20 pb-4">
            <div className="space-y-1">
              <CardTitle className="text-lg flex items-center gap-2">
                <Store className="size-5 text-zinc-400" />
                Log Showroom Visit
              </CardTitle>
              <CardDescription>
                Provide any single detail (e.g. phone) and click 'Auto-Enrich' to fetch details automatically via Google.
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setViewMode("list")}>
              <ArrowLeft className="size-4" />
            </Button>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={handleSaveEntry} className="space-y-6">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="companyName">Company / Showroom Name *</Label>
                  <div className="flex gap-2">
                    <Input
                      id="companyName"
                      placeholder="e.g. Porcelanosa Tile"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleAutoEnrich}
                      disabled={enriching}
                      className="px-3"
                    >
                      {enriching ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5 mr-1" />}
                      Enrich
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contactPerson">Contact Person</Label>
                  <Input
                    id="contactPerson"
                    placeholder="e.g. John Doe (Designer)"
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phoneNumber">Phone Number</Label>
                  <Input
                    id="phoneNumber"
                    placeholder="e.g. (415) 555-0190"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="e.g. designer@showroom.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="website">Website Address</Label>
                  <Input
                    id="website"
                    placeholder="e.g. www.porcelanosa-usa.com"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="address">Mailing Address</Label>
                  <Input
                    id="address"
                    placeholder="e.g. 123 Showroom Ave, San Francisco, CA 94103"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              </div>

              <Separator className="bg-border/20" />

              {/* Rich Notes Editor */}
              <div className="space-y-2">
                <Label>Ultra Rich Narrative Notes (Plate.js)</Label>
                <div className="rounded-lg border border-border/60 bg-card/30 p-2.5">
                  <Plate
                    editor={editor}
                    onValueChange={({ value }) => setEditorValue(value as Descendant[])}
                  >
                    <PlateContent
                      className="min-h-[160px] max-h-[300px] overflow-y-auto rounded bg-background/60 border border-border/40 px-3 py-2 text-sm focus-visible:outline-none"
                      placeholder="Enter showroom notes, pricing options, quotes..."
                    />
                  </Plate>
                </div>
              </div>

              <Separator className="bg-border/20" />

              {/* Attachments Upload */}
              <div className="space-y-3">
                <Label>Upload Showroom Photos & Documents (PDFs, Invoices, Photos)</Label>
                <div className="flex items-center justify-center border border-dashed border-border/60 hover:border-zinc-500 rounded-lg p-6 bg-card/25 cursor-pointer relative group">
                  <input
                    type="file"
                    multiple
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  />
                  <div className="text-center space-y-1.5 pointer-events-none">
                    <Paperclip className="size-6 text-muted-foreground/60 group-hover:text-zinc-300 mx-auto" />
                    <p className="text-xs text-zinc-300">Drag & drop files or click to browse</p>
                    <p className="text-[10px] text-muted-foreground/50">Supports JPG, PNG, PDF, DOCX</p>
                  </div>
                </div>
                {files.length > 0 && (
                  <div className="rounded-lg bg-card/40 border border-border/30 p-3 space-y-1">
                    <Label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block">Selected Files ({files.length})</Label>
                    <div className="max-h-[120px] overflow-y-auto space-y-1">
                      {files.map((file, idx) => (
                        <div key={idx} className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                          <FileText className="size-3.5 flex-shrink-0 text-zinc-500" />
                          {file.name} ({(file.size / 1024).toFixed(1)} KB)
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" type="button" onClick={() => setViewMode("list")} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  className="bg-zinc-200 text-zinc-950 hover:bg-zinc-300 ring-1 ring-border/40 font-medium"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {uploadProgress ? "Uploading Files..." : "Saving visit..."}
                    </>
                  ) : (
                    "Save Showroom Visit"
                  )}
                </Button>
              </div>

            </form>
          </CardContent>
        </Card>
      )}

      {/* 3. VIEW EXISTING JOURNAL ENTRY VIEWPORT */}
      {viewMode === "view" && selectedEntry && (
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between border-b border-border/20 pb-4">
            <Button variant="ghost" size="sm" onClick={() => setViewMode("list")}>
              <ArrowLeft className="size-4 mr-2" />
              Back to Journal
            </Button>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                className="bg-red-950/40 text-red-400 border border-red-800/40 hover:bg-red-900/40"
                onClick={() => handleDeleteEntry(selectedEntry.id)}
              >
                <Trash2 className="size-4 mr-1.5" />
                Delete Entry
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Showroom metadata and details */}
            <div className="space-y-4 md:col-span-1">
              <Card className="border border-border/40 bg-card/30 ring-1 ring-border/40">
                <CardHeader className="pb-3">
                  <Badge className="w-fit bg-zinc-800 text-zinc-200 mb-1 border-0" variant="outline">
                    Showroom details
                  </Badge>
                  <CardTitle className="text-base text-zinc-200">{selectedEntry.companyName}</CardTitle>
                  <CardDescription className="text-[11px] text-muted-foreground">
                    Logged: {new Date(selectedEntry.createdAt).toLocaleString()}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  
                  {selectedEntry.contactPerson && (
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold block tracking-wider">Contact Person</span>
                      <p className="flex items-center gap-2 text-zinc-300">
                        <User className="size-3.5 text-zinc-500" />
                        {selectedEntry.contactPerson}
                      </p>
                    </div>
                  )}

                  {selectedEntry.phoneNumber && (
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold block tracking-wider">Phone Number</span>
                      <a href={`tel:${selectedEntry.phoneNumber}`} className="flex items-center gap-2 text-zinc-300 hover:text-zinc-200">
                        <Phone className="size-3.5 text-zinc-500" />
                        {selectedEntry.phoneNumber}
                      </a>
                    </div>
                  )}

                  {selectedEntry.email && (
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold block tracking-wider">Email Address</span>
                      <a href={`mailto:${selectedEntry.email}`} className="flex items-center gap-2 text-zinc-300 hover:text-zinc-200">
                        <Mail className="size-3.5 text-zinc-500" />
                        {selectedEntry.email}
                      </a>
                    </div>
                  )}

                  {selectedEntry.website && (
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold block tracking-wider">Website</span>
                      <a
                        href={selectedEntry.website.startsWith("http") ? selectedEntry.website : `https://${selectedEntry.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-zinc-300 hover:text-zinc-100 hover:underline truncate group"
                      >
                        <Globe className="size-3.5 text-zinc-500 flex-shrink-0" />
                        <span className="truncate">{selectedEntry.website}</span>
                        <ExternalLink className="size-3 text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </a>
                    </div>
                  )}

                  {selectedEntry.address && (
                    <div className="space-y-0.5 pt-2 border-t border-border/20">
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold block tracking-wider">Mailing Address</span>
                      <p className="flex items-start gap-1.5 text-zinc-300 leading-normal text-xs">
                        <MapPin className="size-3.5 text-zinc-500 mt-0.5 flex-shrink-0" />
                        <span>{selectedEntry.address}</span>
                      </p>
                    </div>
                  )}

                </CardContent>
              </Card>

              {/* Deep Research Widget */}
              <Card className="border border-border/40 bg-zinc-950/30 ring-1 ring-border/40">
                <CardHeader className="pb-2 flex flex-row items-center gap-2">
                  <Sparkles className="size-4 text-emerald-400" />
                  <CardTitle className="text-xs uppercase font-bold tracking-wider text-zinc-300">Deep AI Research</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-xs leading-normal">
                  {selectedEntry.researchSession ? (
                    <div className="space-y-2">
                      <p className="text-muted-foreground/90">
                        An automated research query was dispatched to check ratings and competitive cost structures.
                      </p>
                      
                      <div className="rounded border border-zinc-800 bg-black/35 p-2 space-y-1.5">
                        <div className="font-semibold text-zinc-300 truncate">
                          {selectedEntry.researchSession.topic}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground/60 uppercase text-[9px]">Status</span>
                          <span
                            className={cn(
                              "font-semibold uppercase text-[10px]",
                              selectedEntry.researchSession.status === "complete" ? "text-emerald-400" :
                              selectedEntry.researchSession.status === "failed" ? "text-red-400" :
                              "text-amber-400 animate-pulse"
                            )}
                          >
                            {selectedEntry.researchSession.status}
                          </span>
                        </div>
                      </div>

                      {selectedEntry.researchSession.status === "complete" ? (
                        <a
                          href="/admin/planning/research"
                          className="flex items-center justify-center gap-1.5 w-full bg-zinc-850 hover:bg-zinc-800 border border-zinc-700/60 rounded px-2.5 py-1.5 font-medium text-center text-[11px] transition"
                        >
                          View Deep Research Report
                          <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <div className="text-[10px] text-muted-foreground/50 italic flex items-center justify-center p-1">
                          Research results compiling... check back later.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 text-center py-2 text-muted-foreground/60 italic">
                      <p>No research pipeline linked.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Visit notes & uploads */}
            <div className="space-y-6 md:col-span-2">
              <Card className="border border-border/40 bg-card/30 ring-1 ring-border/40">
                <CardHeader>
                  <CardTitle className="text-base text-zinc-200">Showroom Visit Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border border-border/30 bg-black/20 p-4 min-h-[140px]">
                    {renderReadOnlyNotes(selectedEntry.notes)}
                  </div>
                </CardContent>
              </Card>

              {/* Uploaded attachments deck with AI descriptions */}
              <Card className="border border-border/40 bg-card/30 ring-1 ring-border/40">
                <CardHeader>
                  <CardTitle className="text-base text-zinc-200">
                    Attachments ({selectedEntry.attachments?.length || 0})
                  </CardTitle>
                  <CardDescription>
                    All files are processed through Workers AI Vision to automatically summarize specs & details.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!selectedEntry.attachments || selectedEntry.attachments.length === 0 ? (
                    <p className="text-sm text-muted-foreground/50 italic py-4">No attachments logged for this visit.</p>
                  ) : (
                    <div className="space-y-4">
                      {selectedEntry.attachments.map((attach) => {
                        const isImage = attach.type.startsWith("image/");
                        return (
                          <div
                            key={attach.id}
                            className="rounded-lg border border-border/50 bg-black/25 overflow-hidden flex flex-col md:flex-row gap-4 p-3 hover:border-zinc-700/80 transition"
                          >
                            {isImage ? (
                              <div className="w-full md:w-36 h-28 flex-shrink-0 bg-zinc-900 rounded overflow-hidden relative">
                                <img
                                  src={attach.url}
                                  alt="Attachment"
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              </div>
                            ) : (
                              <div className="w-full md:w-36 h-28 flex-shrink-0 bg-zinc-900 rounded flex flex-col items-center justify-center text-center p-2">
                                <FileText className="size-8 text-zinc-500 mb-1" />
                                <span className="text-[10px] text-zinc-400 font-semibold truncate w-full px-1">
                                  {attach.type.split("/")[1]?.toUpperCase() || "DOC"}
                                </span>
                              </div>
                            )}

                            <div className="flex-1 flex flex-col justify-between py-1 space-y-3">
                              <div className="space-y-1.5">
                                <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">AI Visual Description</span>
                                <p className="text-xs text-zinc-300 leading-relaxed font-normal">
                                  {attach.aiDescription || "AI Vision is extracting metadata description..."}
                                </p>
                              </div>

                              <a
                                href={attach.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 w-fit text-[11px] text-zinc-400 hover:text-zinc-200 transition"
                              >
                                View original file
                                <ExternalLink className="size-3" />
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
