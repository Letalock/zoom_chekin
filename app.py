# app.py
import os, re, time
from datetime import datetime, timezone
from urllib.parse import urlparse
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import bigquery

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://letalock.github.io", "https://*.unifecaf.edu.br"],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)

BQ_PROJECT   = os.getenv("BQ_PROJECT")
BQ_DATASET   = os.getenv("BQ_DATASET", "unifecaf_zoom")
BQ_TABLE     = os.getenv("BQ_TABLE", "ds_checkins")
ALLOWED_HOSTS = (".zoom.us", ".zoom.com", "meet.google.com", ".zoomgov.com")

client = bigquery.Client(project=BQ_PROJECT)

def sanitize_nome(nome: str) -> str:
    """Limpa nome, mantendo letras, acentos e espaços"""
    # Remove caracteres especiais perigosos, mas mantém espaços e acentos
    nome = re.sub(r"[<>\"';{}()\[\]]", "", nome or "").strip()
    # Remove espaços múltiplos
    nome = re.sub(r"\s+", " ", nome)
    return nome

def sanitize_cpf(cpf: str) -> str:
    return re.sub(r"[^\d]", "", cpf or "").strip()

def is_allowed_target(url: str) -> bool:
    # evita open redirect para domínios maliciosos
    try:
        u = urlparse(url)
        if u.scheme not in ("http", "https"): return False
        host = u.hostname or ""
        return (host == "meet.google.com"
                or host.endswith(".zoom.us")
                or host.endswith(".zoom.com")
                or host.endswith(".zoomgov.com"))
    except:
        return False

def extract_meeting_id(url: str) -> str:
    """Extrai o Meeting ID numérico da URL do Zoom ou código do Google Meet"""
    try:
        parsed = urlparse(url)
        if 'zoom' in (parsed.hostname or ''):
            # Exemplo: https://us06web.zoom.us/j/84240819038?pwd=...
            # Extrai: 84240819038
            match = re.search(r'/j/(\d+)', parsed.path)
            if match:
                return match.group(1)
        
        elif 'meet.google.com' in (parsed.hostname or ''):
            # Exemplo: https://meet.google.com/abc-defg-hij
            # Extrai: abc-defg-hij
            return parsed.path.strip('/')
        
        return ""
    except:
        return ""

@app.post("/checkin")
async def checkin(req: Request):
    data = await req.json()
    nome = sanitize_nome(data.get("nome",""))
    cpf = sanitize_cpf(data.get("cpf",""))
    meeting_url = (data.get("meeting") or "").strip()

    if not nome or not meeting_url or not is_allowed_target(meeting_url):
        return {"ok": False, "error": "Parâmetros inválidos."}

    meeting_id = extract_meeting_id(meeting_url)

    row = {
        "data_hora": datetime.now(timezone.utc).isoformat(),
        "nome": nome,
        "cpf": cpf or None,
        "meeting_url": meeting_url,
        "ip": req.client.host if req.client else None,
    }

    # Insere no BQ (streaming)
    table_ref = client.dataset(BQ_DATASET).table(BQ_TABLE)
    errors = client.insert_rows_json(table_ref, [row])
    if errors:
        # não bloqueia o aluno — apenas registra
        print("BQ insert errors:", errors)

    # resposta para o front
    return {"ok": True, "redirect": meeting_url}
