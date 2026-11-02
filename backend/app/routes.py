import json, logging, os, re, time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator, model_validator
from google import genai
from google.genai import types

router = APIRouter(prefix="/api/match", tags=["match"])

SAMPLES = [
 {"id":"late-chase","name":"Late-innings chase","description":"A demanding chase with wickets available.",
  "match":{"batting_team":"India","bowling_team":"Australia","format":"T20","innings":"second","score":126,"wickets":4,"overs":"15.2","target":180,"recent_events":["1","0","W","1","4","0"],"event_history_available":True}},
 {"id":"collapse","name":"Batting collapse","description":"A first-innings side has lost wickets in a short spell.",
  "match":{"batting_team":"England","bowling_team":"Pakistan","format":"T20","innings":"first","score":92,"wickets":5,"overs":"12.0","target":None,"recent_events":["0","W","0","1","W","1"],"event_history_available":True}},
 {"id":"steady-chase","name":"Steady chase","description":"A chase with a manageable equation.",
  "match":{"batting_team":"South Africa","bowling_team":"New Zealand","format":"T20","innings":"second","score":104,"wickets":2,"overs":"13.0","target":150,"recent_events":["1","1","2","0","1","1"],"event_history_available":True}}
]

class Match(BaseModel):
    batting_team: str = Field(min_length=1, max_length=40)
    bowling_team: str = Field(min_length=1, max_length=40)
    format: str = "T20"
    innings: str = "second"
    score: int = Field(ge=0, le=999)
    wickets: int = Field(ge=0, le=10)
    overs: str
    target: int | None = Field(default=None, ge=1, le=999)
    recent_events: list[str] = Field(default_factory=list, max_length=12)
    event_history_available: bool = True

    @field_validator("overs")
    @classmethod
    def valid_overs(cls, v):
        try:
            a=v.strip().split(".")
            if len(a)>2 or int(a[0])<0 or (int(a[1]) if len(a)>1 else 0) not in range(6): raise ValueError()
            return f"{int(a[0])}.{int(a[1]) if len(a)>1 else 0}"
        except Exception:
            raise ValueError("Use cricket overs notation, e.g. 16.2")

    @model_validator(mode="after")
    def valid_match(self):
        if self.batting_team.strip().lower()==self.bowling_team.strip().lower():
            raise ValueError("Teams must be different.")
        if self.innings not in ("first","second"): raise ValueError("Invalid innings.")
        if self.format not in ("T20","ODI","Test"): raise ValueError("Invalid format.")
        if self.innings=="second" and self.target is None: raise ValueError("Target required for second innings.")
        if self.innings=="first": self.target=None
        allowed={"0","1","2","3","4","6","W","Wd","Nb"}
        if any(x not in allowed for x in self.recent_events): raise ValueError("Invalid recent event.")
        return self

class BriefReq(BaseModel):
    match: Match
class AskReq(BaseModel):
    match: Match
    calculations: dict
    briefing: dict
    question: str = Field(min_length=2, max_length=500)

def balls(overs):
    a=overs.split(".")
    return int(a[0])*6+(int(a[1]) if len(a)>1 else 0)

def calculations(m):
    done=balls(m.overs)
    total={"T20":120,"ODI":300}.get(m.format)
    left=max(total-done,0) if total else None
    runs=max(m.target-m.score,0) if m.target is not None else None
    crr=round(m.score/(done/6),2) if done else 0
    rrr=round(runs/(left/6),2) if runs is not None and left and left>0 else (0 if runs==0 else None)
    event_runs=sum(int(x) for x in m.recent_events if x in {"1","2","3","4","6"})
    event_wickets=sum(x=="W" for x in m.recent_events)
    legal=sum(x not in {"Wd","Nb"} for x in m.recent_events)
    return {"completed_balls":done,"current_run_rate":crr,"runs_remaining":runs,
            "legal_balls_remaining":left,"required_run_rate":rrr,
            "wickets_remaining":10-m.wickets,"recent_runs":event_runs,
            "recent_wickets":event_wickets,"recent_legal_balls":legal,
            "recent_run_rate":round(event_runs/(legal/6),2) if legal else None,
            "event_history_available":bool(m.recent_events) and m.event_history_available}

log=logging.getLogger("overbrief")
_pool=ThreadPoolExecutor(max_workers=8)
# Per-attempt wait. Enforced on OUR side. (HttpOptions(timeout=...) is also sent to Google as the
# X-Server-Timeout header, which makes the *server* abort with 504 DEADLINE_EXCEEDED.)
ATTEMPT_SECONDS=float(os.getenv("GEMINI_TIMEOUT_SECONDS","25"))

def client():
    key=os.getenv("GEMINI_API_KEY","").strip()
    return genai.Client(api_key=key) if key else None

def model_name():
    return os.getenv("GEMINI_MODEL","gemini-3.8-flash").strip() or "gemini-3.8-flash"

def model_chain():
    p=model_name(); f=os.getenv("GEMINI_FALLBACK_MODEL","gemini-3.5-flash-lite").strip()
    return [p]+([f] if f and f!=p else [])

def thinking_cfg():
    """gemini-3.8-flash thinks at 'medium' by default, which is slow for a JSON task. Use 'low'."""
    lvl=os.getenv("GEMINI_THINKING_LEVEL","low").strip().upper()
    if lvl in ("","OFF","NONE"): return None
    try: return types.ThinkingConfig(thinking_level=lvl)
    except Exception: return None

def is_auth_error(e):
    m=str(e).lower()
    return any(k in m for k in ("api_key_invalid","api key not valid","permission_denied","unauthenticated","401","403"))

def is_transient(e):
    m=str(e).lower()
    return isinstance(e,TimeoutError) or any(k in m for k in ("504","503","429","deadline","timed out","timeout","unavailable","overloaded","resource_exhausted"))

def gemini_call(contents,**cfg):
    """One call, hardened: low thinking, client-side deadline, then next model on failure.
    Every attempt is logged with timing so the terminal shows what really happened."""
    c=client()
    if not c: raise RuntimeError("GEMINI_API_KEY is not configured.")
    think=thinking_cfg()
    last=None
    for model in model_chain():
        for use_think in ([True,False] if think else [False]):
            kw=dict(cfg)
            if use_think: kw["thinking_config"]=think
            t0=time.time()
            fut=_pool.submit(c.models.generate_content,model=model,contents=contents,
                             config=types.GenerateContentConfig(**kw))
            try:
                res=fut.result(timeout=ATTEMPT_SECONDS)
                log.info("gemini ok model=%s thinking=%s %.1fs",model,use_think,time.time()-t0)
                return res
            except FutTimeout:
                last=TimeoutError(f"{model} did not answer within {ATTEMPT_SECONDS:.0f}s")
                log.warning("gemini TIMEOUT model=%s thinking=%s after %.1fs",model,use_think,time.time()-t0)
                break
            except Exception as e:
                last=e
                log.warning("gemini FAIL model=%s thinking=%s %.1fs: %s",model,use_think,time.time()-t0,str(e)[:400])
                if use_think and "thinking" in str(e).lower(): continue  # model rejects the setting: retry plain
                if is_auth_error(e): raise
                break
    raise last

def parse_json_text(text):
    """Gemini sometimes wraps JSON in ```fences``` or adds prose; recover the object."""
    if not text: raise ValueError("Gemini returned an empty response.")
    t=text.strip()
    t=re.sub(r"^```(?:json)?\s*|\s*```$","",t,flags=re.I)
    try: d=json.loads(t)
    except json.JSONDecodeError:
        a,b=t.find("{"),t.rfind("}")
        if a<0 or b<=a: raise ValueError("Gemini did not return JSON.")
        d=json.loads(t[a:b+1])
    if isinstance(d,list) and d and isinstance(d[0],dict): d=d[0]
    if not isinstance(d,dict): raise ValueError("Gemini returned an unexpected JSON shape.")
    return d

def _num(v):
    if v is None or isinstance(v,bool): return None
    m=re.search(r"\d+",str(v))
    return int(m.group()) if m else None

def normalize_extraction(x):
    """Turn loosely-typed model output into the exact shape the form expects."""
    out={k:None for k in ("batting_team","bowling_team","format","innings","score","wickets","overs","target")}
    for k in ("batting_team","bowling_team"):
        v=x.get(k)
        if isinstance(v,str) and v.strip(): out[k]=v.strip()[:40]
    score,wk=x.get("score"),x.get("wickets")
    if isinstance(score,str) and re.fullmatch(r"\s*\d+\s*[/-]\s*\d+\s*",score):  # "126/4" in one field
        a,b=re.split(r"[/-]",score); score,wk=a,(wk if wk is not None else b)
    out["score"]=_num(score)
    w=_num(wk); out["wickets"]=w if w is not None and 0<=w<=10 else None
    out["target"]=_num(x.get("target"))
    ov=x.get("overs")
    if ov is not None:
        m=re.search(r"(\d+)(?:\.(\d))?",str(ov))
        if m and int(m.group(2) or 0)<=5: out["overs"]=f"{int(m.group(1))}.{int(m.group(2) or 0)}"
    f=str(x.get("format") or "").upper()
    out["format"]="ODI" if "ODI" in f else "Test" if "TEST" in f else "T20" if "T20" in f or "T-20" in f else None
    i=str(x.get("innings") or "").lower()
    out["innings"]="first" if re.search(r"first|1st|\b1\b",i) else "second" if re.search(r"second|2nd|chase|\b2\b",i) else None
    if out["innings"] is None and out["target"]: out["innings"]="second"
    return out

def demo_brief(m,c,note=None):
    if m.innings=="second":
        what=f"{m.batting_team} are {m.score}/{m.wickets} after {m.overs} overs and need {c['runs_remaining']} from {c['legal_balls_remaining']} legal balls."
    else:
        what=f"{m.batting_team} have scored {m.score}/{m.wickets} after {m.overs} overs in the first innings."
    if m.recent_events:
        what+=f" The supplied recent sequence produced {c['recent_runs']} runs and {c['recent_wickets']} wicket(s)."
    else:
        what+=" No recent ball-by-ball sequence was supplied, so this is a scoreboard-based catch-up."
    why=f"The current run rate is {c['current_run_rate']:.2f} per over."
    if c["required_run_rate"] is not None: why+=f" The required rate is {c['required_run_rate']:.2f}; that gap helps explain the demand of the chase."
    watch="Watch how the batting side balances scoring options with the wickets available. The supplied information does not reveal player intent or conditions, so treat this as a cue rather than a prediction."
    return {"what_happened":what,"why_it_matters":why,"what_to_watch":watch,
            "confidence_note":note or "Demo-mode explanation based only on the match details and recent events you supplied."}

def demo_answer(req):
    k=req.calculations
    return (f"{req.match.batting_team} need {k.get('runs_remaining')} runs from {k.get('legal_balls_remaining')} balls. "
            f"The current rate is {k.get('current_run_rate')} and the required rate is {k.get('required_run_rate')}. "
            "That difference is the main numerical pressure. I don't have player-level commentary or conditions unless you provide them.")

def gemini_json(prompt, system):
    res=gemini_call(prompt,system_instruction=system,response_mime_type="application/json",temperature=0.3)
    return parse_json_text(res.text)

BRIEF_KEYS=("what_happened","why_it_matters","what_to_watch","confidence_note")

@router.get("/samples")
def samples():
    return SAMPLES

@router.post("/brief")
def brief(req: BriefReq):
    m=req.match; c=calculations(m)
    system=("You are OVERBRIEF, a friendly cricket-savvy friend catching someone up on a match they missed. "
            "Write in a warm, natural, conversational voice, like talking to a friend, in short plain sentences. "
            "Use only supplied facts. Never invent players, events, pitch, field settings or captain intent. "
            "If recent events are absent, say so casually. Separate what happened from what might matter. "
            "No predictions, betting or fantasy advice. "
            "Return JSON with string fields: what_happened, why_it_matters, what_to_watch, confidence_note. "
            "Each field is 1 to 3 sentences. Do not use markdown or bullet points.")
    prompt=f"Match: {m.model_dump()}\nCalculations: {c}\nWrite a catch-up. Describe only supplied events. Explain match equation plainly. Suggest useful things to watch without claiming to know intent."
    has_key=client() is not None
    if not has_key and os.getenv("DEMO_MODE","true").lower()!="true":
        raise HTTPException(503,"Set GEMINI_API_KEY or enable DEMO_MODE.")
    data=None; mode="demo"; ai_error=None
    if has_key:
        try:
            data=gemini_json(prompt,system); mode="gemini"
            for k in BRIEF_KEYS:
                if not isinstance(data.get(k),str) or not data[k].strip(): raise ValueError("AI response missing field: "+k)
        except Exception as e:
            # Never leave the user staring at a spinner: degrade to the Python-calculated briefing.
            ai_error=str(e)[:300]; data=None
            log.error("brief: Gemini unavailable, using calculated briefing: %s",ai_error)
    if data is None:
        note=("The AI explanation was unavailable, so this briefing is built only from the calculated figures and what you supplied."
              if ai_error else None)
        data=demo_brief(m,c,note); mode="fallback" if ai_error else "demo"
    return {"match":m.model_dump(),"calculations":c,"briefing":data,"generated_by":mode,"ai_error":ai_error}

@router.post("/ask")
def ask(req: AskReq):
    system=("You are OVERBRIEF, a friendly cricket-savvy friend explaining a match to someone who missed it. "
            "Talk naturally, like a person chatting, not like a report. Start with the direct answer in the first sentence, "
            "then briefly explain why in plain, everyday words. Use short sentences and 2 to 5 sentences total, under 110 words. "
            "Explain any cricket term the first time you use it. Do not use bullet points, headings, bold or asterisks. "
            "Stay strictly grounded: use only the supplied match details, calculations and briefing. "
            "Never invent players, deliveries, tactics, pitch or conditions. If something wasn't provided, say so casually, "
            "for example: I don't have that detail from what you shared. "
            "No predictions, betting or fantasy advice. If asked who will win, say you can't call it, but explain what the numbers show.")
    prompt=f"Match: {req.match.model_dump()}\nCalculations: {req.calculations}\nBriefing: {req.briefing}\nFan question: {req.question}"
    if client() is None:
        if os.getenv("DEMO_MODE","true").lower()!="true": raise HTTPException(503,"Gemini API key is not configured.")
        return {"answer":demo_answer(req),"generated_by":"demo"}
    try:
        res=gemini_call(prompt,system_instruction=system,temperature=0.5)
        if not (res.text or "").strip(): raise ValueError("empty answer")
        return {"answer":res.text.strip(),"generated_by":"gemini"}
    except Exception as e:
        log.error("ask: Gemini unavailable: %s",str(e)[:300])
        return {"answer":demo_answer(req)+" (AI was unavailable, so this answer uses calculated figures only.)","generated_by":"fallback"}

def sniff_image(raw):
    """Trust the bytes, not the browser-supplied Content-Type (often blank or wrong)."""
    if raw[:8]==b"\x89PNG\r\n\x1a\n": return "image/png"
    if raw[:3]==b"\xff\xd8\xff": return "image/jpeg"
    if raw[:4]==b"RIFF" and raw[8:12]==b"WEBP": return "image/webp"
    return None

# Plain `def` (not async): the Gemini SDK call is blocking; FastAPI runs `def` routes in a thread pool.
@router.post("/extract")
def extract(file: UploadFile = File(...)):
    raw=file.file.read(8*1024*1024+1)
    if len(raw)>8*1024*1024: raise HTTPException(413,"Image must be under 8 MB.")
    if not raw: raise HTTPException(400,"The uploaded file is empty.")
    mime=sniff_image(raw)
    if not mime: raise HTTPException(400,"Upload a PNG, JPG or WEBP image.")
    if client() is None: raise HTTPException(503,"Screenshot extraction needs GEMINI_API_KEY. Use manual entry instead.")
    prompt=("Read this cricket scoreboard screenshot. Return one JSON object with keys: batting_team, bowling_team, "
            "format (T20, ODI or Test), innings (first or second), score (integer runs), wickets (integer), "
            "overs (cricket notation string like \"16.2\"), target (integer or null). "
            "Use null for anything unclear or not visible. Do not guess or infer missing values.")
    try:
        res=gemini_call([types.Part.from_bytes(data=raw,mime_type=mime),prompt],
                        response_mime_type="application/json",temperature=0.1)
        data=normalize_extraction(parse_json_text(res.text))
    except Exception as e:
        log.error("extract failed: %s",str(e)[:400])
        if is_transient(e):
            raise HTTPException(504,"Google's model is slow or busy right now. Please try again, or enter the details manually.")
        raise HTTPException(502,f"Could not read the scoreboard: {str(e)[:300]}")
    missing=[k for k,v in data.items() if v is None]
    return {"extracted":data,"missing":missing,"notes":["Check all extracted values before generating the briefing."]}

@router.get("/diagnose")
def diagnose():
    """Open http://localhost:8000/api/match/diagnose to see exactly what Gemini does for YOUR key."""
    key=os.getenv("GEMINI_API_KEY","").strip()
    out={"key_present":bool(key),"key_length":len(key),"configured_model":model_name(),
         "fallback_model":os.getenv("GEMINI_FALLBACK_MODEL","gemini-3.5-flash-lite"),
         "thinking_level":os.getenv("GEMINI_THINKING_LEVEL","low"),"attempt_timeout_s":ATTEMPT_SECONDS,"tests":[]}
    if not key: return out
    c=client()
    try: out["models_available_to_key"]=sorted(m.name.replace("models/","") for m in c.models.list() if "gemini" in m.name and "flash" in m.name)[:40]
    except Exception as e: out["models_list_error"]=str(e)[:300]
    for model in model_chain():
        for think in (True,False):
            kw={"temperature":0}
            if think:
                tc=thinking_cfg()
                if not tc: continue
                kw["thinking_config"]=tc
            t0=time.time(); row={"model":model,"thinking_low":think}
            fut=_pool.submit(c.models.generate_content,model=model,contents="Reply with the single word OK.",config=types.GenerateContentConfig(**kw))
            try: row.update(ok=True,reply=(fut.result(timeout=ATTEMPT_SECONDS).text or "").strip()[:40])
            except FutTimeout: row.update(ok=False,error=f"no answer within {ATTEMPT_SECONDS:.0f}s")
            except Exception as e: row.update(ok=False,error=str(e)[:300])
            row["seconds"]=round(time.time()-t0,1); out["tests"].append(row)
    return out