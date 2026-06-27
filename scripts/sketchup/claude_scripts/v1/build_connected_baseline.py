"""
build_connected_baseline.py — HARD SAVE-STATE of the Colby St townhouse.

Reproduces colby_st_CONNECTED_v2_cantilevers.skp exactly: a single connected wall network,
strict 300" exterior width, origin at the front-left entry corner (0,0,0), 6.5" party walls /
4.5" interior partitions, 11" floor assembly, with the upper-level cantilevers, setbacks, decked
lightwell, stacked plumbing, pony-wall stair well, and stepped stairs. NO interior FF&E (kitchen,
fixtures) — this is the bare coordinate grid to branch remodel phases from.

This is the rollback point. Re-run to return to the approved baseline before any Phase-N edits.

USAGE:
    pip install "mcp>=1.0.0" httpx
    export TRIMBLE_ACCESS_TOKEN=...
    python build_connected_baseline.py     # -> colby_st_CONNECTED_v2_cantilevers.skp
"""
import asyncio, os, json, subprocess, httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

MCP_URL="https://api.sketchup.com/mcp/v1/sketchup/mcp"
OUT_FILE="colby_st_CONNECTED_v2_cantilevers.skp"

# wall tuple: (name, axis, fixed, lo, hi, height, thickness, openings[(start,end,sill,head)])
LOWER_WALLS=[
 ("EXT_L_entry","V",3.25,0,146,108,6.5,None),
 ("EXT_L_rest","V",3.25,146,657.5,96,6.5,[(400,470,36,84)]),
 ("EXT_R","V",296.75,0,657.5,96,6.5,[(80,200,36,84),(520,620,36,84)]),
 ("EXT_FRONT_entry","H",3.25,0,73,108,6.5,[(22,52,0,84)]),
 ("EXT_FRONT_garage","H",3.25,73,300,96,6.5,[(110,250,0,96)]),
 ("EXT_BACK","H",654.25,0,300,96,6.5,[(45,125,0,80),(180,260,0,80)]),
 ("DIV_entry_garage","V",73.25,6.5,146,108,4.5,None),
 ("DIV_entry_walk","H",146,6.5,71,108,4.5,[(20,56,0,84)]),
 ("GARAGE_W","V",73.25,146,270.75,96,4.5,None),
 ("GARAGE_back","H",270.75,6.5,293.5,96,4.5,[(95,145,0,84)]),
 ("CENTRAL","V",149.75,270.75,651,96,4.5,[(410,446,0,84),(560,596,0,84)]),
 ("FAM_front","H",381,6.5,147.5,96,4.5,[(40,90,0,84)]),
 ("STAIR_R","V",232.25,272,388,96,4.5,None),
 ("STAIR_back","H",388,152,232,96,4.5,[(170,206,0,84)]),
 ("ALCOVE_bath_div","V",225.25,388,489,84,4.5,[(430,466,0,84)]),
 ("BATH_back","H",487,225.25,293.5,96,4.5,None),
 ("GUEST_front","H",489,152,293.5,96,4.5,[(160,196,0,84)]),
]
UPPER_WALLS=[
 ("EXT_L","V",3.25,0,723,96,6.5,[(150,230,36,84),(450,530,36,84)]),
 ("EXT_R","V",296.75,0,723,96,6.5,[(150,230,36,84),(560,650,36,84)]),
 ("EXT_BACK","H",719.75,0,300,96,6.5,[(40,120,36,84),(190,270,36,84)]),
 ("KIT_FRONT","H",36,6.5,111.5,96,6.5,[(40,90,36,84)]),
 ("FRONT_Lwing","H",3.25,111.5,150,96,6.5,None),
 ("FRONT_Rwing","H",3.25,260,300,96,6.5,None),
 ("BAY_front","H",-26.75,150,260,96,6.5,[(165,245,30,84)]),
 ("BAY_L","V",153.25,-30,6.5,96,6.5,None),
 ("BAY_R","V",256.75,-30,6.5,96,6.5,None),
 ("KIT_E","V",113.5,36,308,96,4.5,[(150,186,0,84)]),
 ("KIT_back","H",190,6.5,111.5,96,4.5,[(40,90,0,84)]),
 ("GREAT_back","H",308,116,293.5,96,4.5,[(150,210,0,84)]),
 ("SHAFT_L","V",149.75,272,388,42,4.5,None),
 ("SHAFT_R","V",234.25,272,388,42,4.5,None),
 ("SHAFT_front","H",272,152,234,42,4.5,None),
 ("PBATH_front","H",388,223,293.5,96,4.5,[(245,281,0,84)]),
 ("PBATH_L","V",223,388,487,96,4.5,None),
 ("PBATH_back","H",487,223,293.5,96,4.5,None),
 ("HALL_R","V",211,308,544,96,4.5,None),
 ("CENTRAL_up","V",149.75,491,723,96,4.5,None),
 ("PRIM_front","H",491,150,293.5,96,4.5,[(200,236,0,84)]),
 ("BR2_front","H",544,6.5,149.75,96,4.5,[(60,96,0,84)]),
 ("BR3_front","H",360,6.5,148,96,4.5,[(60,96,0,84)]),
 ("BR3_back","H",487,6.5,128,96,4.5,[(40,76,0,84)]),
 ("LW_R","V",128,491,540,42,4.5,None),
 ("LW_back","H",540,6.5,128,42,4.5,None),
 ("BATH2_R","V",92,280,360,96,4.5,[(300,336,0,84)]),
 ("BATH2_back","H",280,6.5,92,96,4.5,None),
]

BUILD=r'''
null=None
def mqb(w,d,h):
    g=GeometryInput(); g.set_vertices([SUPoint3D(0,0,0),SUPoint3D(w,0,0),SUPoint3D(w,d,0),SUPoint3D(0,d,0),
        SUPoint3D(0,0,h),SUPoint3D(w,0,h),SUPoint3D(w,d,h),SUPoint3D(0,d,h)])
    for fv in [[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7],[0,3,2,1]]:
        lp=LoopInput()
        for i in fv: lp.add_vertex_index(i)
        _,g=g.add_face(lp)
    return g
def getmat(n,r,g,b):
    ex={m.get_name():m for m in model.get_materials()}
    if n in ex: return ex[n]
    m=Material(); m.set_name(n); m.set_color(SUColor(r,g,b,255)); model.add_materials([m]); return m
def applymat(grp,mat):
    for f in grp.get_entities().get_faces(): f.set_front_material(mat); f.set_back_material(mat)
def box(parent,name,x,y,z,w,d,h,mat):
    gg=Group(); parent.get_entities().add_group(gg); gg.set_name(name)
    gg.get_entities().fill(mqb(w,d,h),weld_vertices=True); applymat(gg,mat)
    gg.set_transform(SUTransformation([1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1])); return gg
def wall(parent,name,axis,fixed,lo,hi,z,h,t,mat,openings=None):
    def seg(n,a,b,zz,hh):
        if b-a<=0 or hh<=0: return
        if axis=="V": box(parent,n,fixed-t/2.0,a,zz,t,b-a,hh,mat)
        else:         box(parent,n,a,fixed-t/2.0,zz,b-a,t,hh,mat)
    ops=sorted([(max(o[0],lo),min(o[1],hi),o[2],o[3]) for o in (openings or []) if o[1]>lo and o[0]<hi])
    cur=lo; i=0
    for a,b,sill,head in ops:
        if a>cur: seg(name+"_%d"%i,cur,a,z,h); i+=1
        if sill>0: seg(name+"_sl%d"%i,a,b,z,sill); i+=1
        if head<h: seg(name+"_hd%d"%i,a,b,z+head,h-head); i+=1
        cur=max(cur,b)
    if cur<hi: seg(name+"_%d"%i,cur,hi,z,h)

matw=getmat("Walls",232,229,223); matlf=getmat("Lower_Floor",150,150,160)
matuf=getmat("Upper_Floor",178,170,158); matp=getmat("Patio_Deck",168,138,102)
matst=getmat("Stairs",120,120,130); matap=getmat("Appliance",205,210,215); matlw=getmat("Lightwell_Deck",150,160,150)
lay_lo=Layer(); lay_lo.set_name("Lower_Level"); lay_up=Layer(); lay_up.set_name("Upper_Level")
model.add_layers([lay_lo,lay_up])

LOWER=__LOWER__
UPPER=__UPPER__

L=Group(); model.get_entities().add_group(L); L.set_name("Lower_Level")
box(L,"Lower_Slab",0,0,-6,300,657.5,6,matlf)
for nm,ax,fx,lo,hi,h,t,op in LOWER: wall(L,nm,ax,fx,lo,hi,0.0,h,t,matw,op)
box(L,"Washer",192,392,0,27,30,36,matap); box(L,"Dryer",192,426,0,27,30,36,matap)
box(L,"Patio",9,657.5,0,282,116,4,matp)
sx,sy0,sw,srun=152.0,272.0,80.0,116.0; NST=14; rise=107.0/NST; tread=srun/NST
for i in range(NST): box(L,"Stair_%d"%i,sx,sy0+i*tread,0.0,sw,srun-i*tread,(i+1)*rise,matst)
L.set_layer(lay_lo)

U=Group(); model.get_entities().add_group(U); U.set_name("Upper_Level")
box(U,"USlab_front",0,0,96,300,272,11,matuf); box(U,"USlab_left",0,272,96,152,116,11,matuf)
box(U,"USlab_right",232,272,96,68,116,11,matuf); box(U,"USlab_back",0,388,96,300,335,11,matuf)
box(U,"USlab_bay",150,-30,96,110,30,11,matuf); box(U,"Lightwell_Deck",6.5,491,103,121.5,49,4,matlw)
for nm,ax,fx,lo,hi,h,t,op in UPPER: wall(U,nm,ax,fx,lo,hi,107.0,h,t,matw,op)
U.set_layer(lay_up)

# style
ro=model.get_rendering_options()
for k,v in {"RENDER_MODE":TypedValue(int_value=2),"DRAW_SILHOUETTES":TypedValue(bool_value=True),
"SKY_COLOR":TypedValue(color_value=SUColor(180,200,220,255)),"GROUND_COLOR":TypedValue(color_value=SUColor(170,185,155,255)),
"AMBIENT_OCCLUSION":TypedValue(bool_value=True),"AMBIENT_OCCLUSION_DISTANCE":TypedValue(float_value=15.0)}.items():
    try: ro[RenderingOptionKey[k]]=v
    except Exception: pass
try: model.get_shadow_info()[ShadowInfoKey["DISPLAY_SHADOWS"]]=TypedValue(bool_value=True)
except Exception: pass

CX,CY=150.0,372.0
def topdown(czt,ez):
    c=Camera(); c.set_orientation(SUPoint3D(CX,CY,ez),SUPoint3D(CX,CY,czt),SUVector3D(0,1,0))
    c.enable_perspective(); c.set_perspective_frustum_fov(31.0); return c
def heroc():
    az=math.radians(75); el=math.radians(28)
    dx=math.cos(az)*math.cos(el); dy=-math.sin(az)*math.cos(el); dz=math.sin(el)
    dist=1.18*max((803/2)/math.tan(math.radians(17.5)),(300/2)/math.tan(math.atan(1.6*math.tan(math.radians(17.5)))))
    c=Camera(); c.set_orientation(SUPoint3D(CX+dist*dx,CY+dist*dy,110+dist*dz),SUPoint3D(CX,CY,60),SUVector3D(0,0,1))
    c.enable_perspective(); c.set_perspective_frustum_fov(35.0); return c
lays={l.get_name():l for l in model.get_layers()}
slo=Scene(); slo.set_name("Lower Level"); sup=Scene(); sup.set_name("Upper Level"); she=Scene(); she.set_name("Hero")
model.add_scenes([slo,sup,she])
slo.set_use_camera(True); slo.set_camera(topdown(48,1620)); slo.set_use_hidden_layers(True); slo.add_layer(lays["Upper_Level"])
sup.set_use_camera(True); sup.set_camera(topdown(155,1720)); sup.set_use_hidden_layers(True); sup.add_layer(lays["Lower_Level"])
she.set_use_camera(True); she.set_camera(heroc()); she.set_use_hidden_layers(False)
model.set_active_scene(she); model.set_camera(heroc())
result={"ok":True}
'''

from sketchup_secrets import TRIMBLE_API_KEY, get_secret

async def main():
    tok=TRIMBLE_API_KEY
    if not tok: raise SystemExit("Missing TRIMBLE_API_KEY")
    code=BUILD.replace("__LOWER__",json.dumps(LOWER_WALLS)).replace("__UPPER__",json.dumps(UPPER_WALLS))
    hc=httpx.AsyncClient(headers={"Authorization":f"Bearer {tok}"},timeout=httpx.Timeout(30.0,read=300.0))
    async with streamable_http_client(url=MCP_URL,http_client=hc) as (r,w,_):
        async with ClientSession(r,w) as s:
            await s.initialize()
            for sk in ["sketchup-sdk","sketchup-clean-geometry","sketchup-styles","sketchup-camera","sketchup-scenes"]:
                await s.call_tool("read_skill",arguments={"name":sk})
            print(await s.call_tool("build_model",arguments={"clean":True,"code":code}))
            res = await s.call_tool("save_model",arguments={"filename":OUT_FILE,"keep_session":False})
            print(res)
            # Extract download URL and download the file automatically
            url = None
            if hasattr(res, "structuredContent") and res.structuredContent and "download_url" in res.structuredContent:
                url = res.structuredContent["download_url"]
            elif isinstance(getattr(res, "__dict__", None), dict) and "download_url" in res.__dict__:
                url = res.__dict__["download_url"]
            
            if url:
                print(f"Downloading {OUT_FILE}...")
                dl_res = await hc.get(url, follow_redirects=True)
                if dl_res.status_code == 200:
                    with open(OUT_FILE, "wb") as f:
                        f.write(dl_res.content)
                    print(f"Successfully saved {OUT_FILE} locally!")
                else:
                    print(f"Failed to download. Status: {dl_res.status_code}")

if __name__=="__main__":
    asyncio.run(main())
