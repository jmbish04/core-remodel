import React, { useEffect, useState } from "react";
import { ChevronRight, ArrowLeft, Building2, UploadCloud, CheckCircle2, Home } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

interface Company {
  id: number;
  name: string;
}

interface Room {
  id: number;
  name: string;
  roomType: string | null;
}

export function BidPortfolioIntakeWizardApp() {
  const [step, setStep] = useState(1);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form State
  const [companyId, setCompanyId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [overviewStatement, setOverviewStatement] = useState("");
  const [showBudgetRanges, setShowBudgetRanges] = useState(false);
  const [expirationDate, setExpirationDate] = useState("");

  const [roomConfigs, setRoomConfigs] = useState<Record<number, { selected: boolean, showPhotos: boolean, showDimensions: boolean, showConditions: boolean, showScope: boolean, showInspiration: boolean }>>({});

  useEffect(() => {
    Promise.all([
      fetch("/api/bid-portfolios/companies").then(res => res.json()),
      fetch("/api/rooms").then(res => res.json())
    ]).then(([companiesData, roomsData]) => {
      const compData = companiesData as { companies?: Company[] };
      const rData = roomsData as { rooms?: Room[] };
      setCompanies(compData.companies || []);
      const loadedRooms = rData.rooms || [];
      setRooms(loadedRooms);
      
      const initialConfigs: Record<number, any> = {};
      loadedRooms.forEach((r: Room) => {
        initialConfigs[r.id] = { selected: false, showPhotos: true, showDimensions: true, showConditions: true, showScope: true, showInspiration: false };
      });
      setRoomConfigs(initialConfigs);
    }).catch(() => {
      toast.error("Failed to load setup data");
    }).finally(() => setLoading(false));
  }, []);

  const handleNext = () => setStep(s => s + 1);
  const handlePrev = () => setStep(s => s - 1);

  const handleSubmit = async () => {
    if (!companyId || !title) {
      toast.error("Company and Title are required.");
      return;
    }
    setSaving(true);
    
    // Build payload
    const selectedRooms = Object.entries(roomConfigs)
      .filter(([_, conf]) => conf.selected)
      .map(([id, conf]) => ({
        roomId: Number(id),
        showPhotos: conf.showPhotos,
        showDimensions: conf.showDimensions,
        showConditions: conf.showConditions,
        showScope: conf.showScope,
        showInspiration: conf.showInspiration
      }));

    const payload = {
      companyId: Number(companyId),
      title,
      welcomeMessage,
      overviewStatement,
      showBudgetRanges,
      expirationDate: expirationDate || null,
      rooms: selectedRooms
    };

    try {
      const res = await fetch("/api/bid-portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error);

      toast.success("Bid portfolio created successfully!");
      setTimeout(() => {
        window.location.href = `/admin/companies/${companyId}`;
      }, 1500);
    } catch (err: any) {
      toast.error(err.message || "Failed to create bid portfolio");
      setSaving(false);
    }
  };

  if (loading) return <div className="py-12 text-center">Loading wizard...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Progress Bar */}
      <div className="flex items-center justify-between relative">
        <div className="absolute left-0 top-1/2 w-full h-1 bg-muted -z-10" />
        <div className="absolute left-0 top-1/2 h-1 bg-primary -z-10 transition-all duration-300" style={{ width: `${((step - 1) / 2) * 100}%` }} />
        
        {[1, 2, 3].map(i => (
          <div key={i} className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors duration-300 ${step >= i ? "bg-primary border-primary text-primary-foreground" : "bg-background border-muted text-muted-foreground"}`}>
            {i === 1 && <Building2 className="w-5 h-5" />}
            {i === 2 && <Home className="w-5 h-5" />}
            {i === 3 && <CheckCircle2 className="w-5 h-5" />}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {step === 1 && "Basic Information"}
            {step === 2 && "Room Configuration"}
            {step === 3 && "Review & Generate"}
          </CardTitle>
          <CardDescription>
            {step === 1 && "Select the company and basic details for this bid package."}
            {step === 2 && "Select which rooms to include and what information to reveal."}
            {step === 3 && "Review the bid package before creating the portfolio link."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Target Company <span className="text-destructive">*</span></Label>
                <Select value={companyId} onValueChange={(val: string | null) => setCompanyId(val || "")}>
                  <SelectTrigger><SelectValue placeholder="Select a company..." /></SelectTrigger>
                  <SelectContent>
                    {companies.map(c => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Bid Package Title <span className="text-destructive">*</span></Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Complete Home Remodel - Initial Bid" />
              </div>

              <div className="space-y-2">
                <Label>Welcome Message (Optional)</Label>
                <Textarea value={welcomeMessage} onChange={e => setWelcomeMessage(e.target.value)} placeholder="A personal note for the contractor." />
              </div>

              <div className="space-y-2">
                <Label>Overview Statement (Optional)</Label>
                <Textarea value={overviewStatement} onChange={e => setOverviewStatement(e.target.value)} placeholder="High-level goals or scope for this bid." />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col space-y-2">
                  <Label>Expiration Date</Label>
                  <Input type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} />
                </div>
                <div className="flex flex-col justify-center space-y-2">
                  <Label className="flex items-center space-x-2">
                    <Switch checked={showBudgetRanges} onCheckedChange={setShowBudgetRanges} />
                    <span>Show Target Budget Ranges</span>
                  </Label>
                  <p className="text-xs text-muted-foreground pl-11">If enabled, the contractor will see your estimated budgets.</p>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
              {rooms.map(room => {
                const conf = roomConfigs[room.id];
                if (!conf) return null;
                return (
                  <Card key={room.id} className={`transition-colors ${conf.selected ? 'border-primary shadow-sm' : 'opacity-70'}`}>
                    <CardHeader className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Switch 
                            checked={conf.selected} 
                            onCheckedChange={(val) => setRoomConfigs(prev => ({...prev, [room.id]: {...prev[room.id], selected: val}}))}
                          />
                          <CardTitle className="text-lg">{room.name}</CardTitle>
                        </div>
                        {conf.selected && <Badge variant="secondary">Included</Badge>}
                      </div>
                    </CardHeader>
                    {conf.selected && (
                      <CardContent className="pt-0 pb-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                          <Label className="flex items-center space-x-2 font-normal cursor-pointer">
                            <Switch checked={conf.showPhotos} onCheckedChange={v => setRoomConfigs(prev => ({...prev, [room.id]: {...prev[room.id], showPhotos: v}}))} />
                            <span>Current Photos</span>
                          </Label>
                          <Label className="flex items-center space-x-2 font-normal cursor-pointer">
                            <Switch checked={conf.showDimensions} onCheckedChange={v => setRoomConfigs(prev => ({...prev, [room.id]: {...prev[room.id], showDimensions: v}}))} />
                            <span>Dimensions</span>
                          </Label>
                          <Label className="flex items-center space-x-2 font-normal cursor-pointer">
                            <Switch checked={conf.showConditions} onCheckedChange={v => setRoomConfigs(prev => ({...prev, [room.id]: {...prev[room.id], showConditions: v}}))} />
                            <span>Current Conditions</span>
                          </Label>
                          <Label className="flex items-center space-x-2 font-normal cursor-pointer">
                            <Switch checked={conf.showScope} onCheckedChange={v => setRoomConfigs(prev => ({...prev, [room.id]: {...prev[room.id], showScope: v}}))} />
                            <span>Future Scope</span>
                          </Label>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                )
              })}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="bg-muted p-4 rounded-lg">
                <h3 className="font-semibold text-lg">{title}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  For: {companies.find(c => c.id === Number(companyId))?.name || "Unknown Company"}
                </p>
                <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
                  <div><strong>Expiration:</strong> {expirationDate ? new Date(expirationDate).toLocaleDateString() : 'Never'}</div>
                  <div><strong>Show Budgets:</strong> {showBudgetRanges ? 'Yes' : 'No'}</div>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium mb-3">Included Rooms ({Object.values(roomConfigs).filter(c => c.selected).length})</h4>
                <div className="flex flex-wrap gap-2">
                  {rooms.map(room => {
                    const conf = roomConfigs[room.id];
                    if (conf?.selected) {
                      return <Badge key={room.id} variant="outline" className="bg-background">{room.name}</Badge>
                    }
                    return null;
                  })}
                </div>
              </div>
            </div>
          )}

        </CardContent>
        <CardContent className="flex justify-between border-t pt-6">
          <Button variant="outline" onClick={handlePrev} disabled={step === 1 || saving}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          
          {step < 3 ? (
            <Button onClick={handleNext} disabled={step === 1 && (!companyId || !title)}>
              Next <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? "Creating Portfolio..." : "Create Bid Portfolio"}
              {!saving && <UploadCloud className="w-4 h-4 ml-2" />}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
