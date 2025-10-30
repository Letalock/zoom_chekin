# app.py
import os
import re
from datetime import datetime, timezone
from urllib.parse import urlparse
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import bigquery
import json 
from google.oauth2 import service_account
# import dotenv 
##from .main import router as main_router

# novs importações para proxy interno
import httpx
# dotenv.load_dotenv()
app = FastAPI(title="Check-in UniFECAF", version="1.0.0", servers=[{"url": "/"}]) 


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://letalock.github.io",
        "https://*.unifecaf.edu.br",
        "http://localhost:3000"  # Para testes locais
    ],
    allow_credentials=True,
    allow_methods=["POST", "OPTIONS", "GET"],
    allow_headers=["*"],
)

# Inclui o roteador do main.py no aplicativo principal
##app.include_router(main_router) 

# Configurações
BQ_PROJECT = os.getenv("BQ_PROJECT", "unifecaf-data") 
BQ_DATASET = os.getenv("BQ_DATASET", "unifecaf_zoom")
BQ_TABLE = os.getenv("BQ_TABLE", "ds_checkins")

# credenciais para obter token localmente (ajuste via .env)
SERVICE_USER = os.getenv("SERVICE_USER", "zoom")
SERVICE_PASS = os.getenv("SERVICE_PASS")
credentials_json = os.getenv('GOOGLE_CREDENTIALS_JSON', 'undefined')

key_dict = json.loads(credentials_json)
credentials = service_account.Credentials.from_service_account_info(key_dict)
client = bigquery.Client(project=BQ_PROJECT, credentials=credentials)

def sanitize_nome(nome: str) -> str:
    """Limpa nome, mantendo letras, acentos e espaços"""
    nome = re.sub(r"[<>\"';{}()\[\]]", "", nome or "").strip()
    nome = re.sub(r"\s+", " ", nome)
    return nome

def sanitize_cpf(cpf: str) -> str:
    """Remove tudo exceto dígitos"""
    return re.sub(r"[^\d]", "", cpf or "").strip()

def is_allowed_target(url: str) -> bool:
    """Valida se é URL do Zoom ou Google Meet"""
    try:
        u = urlparse(url)
        if u.scheme not in ("http", "https"):
            return False
        host = (u.hostname or "").lower()
        
        # Google Meet
        if host == "meet.google.com":
            return True
        
        # Zoom
        if (host == "zoom.us" or host.endswith(".zoom.us") or
            host == "zoom.com" or host.endswith(".zoom.com") or
            host == "zoomgov.com" or host.endswith(".zoomgov.com")):
            return bool(re.match(r"^\/(j|wc\/join|s)\/", u.path))
        
        return False
    except:
        return False

def extract_meeting_id(url: str) -> str:
    """Extrai Meeting ID da URL"""
    try:
        parsed = urlparse(url)
        hostname = (parsed.hostname or "").lower()
        
        # Zoom: /j/1234567890
        if "zoom" in hostname:
            match = re.search(r'/j/(\d+)', parsed.path)
            if match:
                return match.group(1)
        
        # Google Meet: /abc-defg-hij
        elif "meet.google.com" in hostname:
            return parsed.path.strip('/')
        
        return ""
    except:
        return ""

@app.get("/")
async def root():
    """Endpoint raiz"""
    return {
        "service": "Check-in UniFECAF",
        "version": "1.0.0",
        "status": "online"
    }

@app.get("/health")
async def health():
    """Health check para Docker/Kubernetes"""
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "checkin-api"
    }

@app.post("/zoom/checkin")
async def checkin(req: Request):
    try:
        data = await req.json()
    except:
        return {"ok": False, "error": "JSON inválido"}
    
    nome = sanitize_nome(data.get("nome", ""))
    cpf = sanitize_cpf(data.get("cpf", ""))
    meeting_url = (data.get("meeting") or data.get("link_zoom") or "").strip()

    # Validações
    if not nome or len(nome) < 3:
        return {"ok": False, "error": "Nome inválido"}
    
    if not meeting_url or not is_allowed_target(meeting_url):
        return {"ok": False, "error": "URL da reunião inválida"}

    meeting_id = extract_meeting_id(meeting_url)

    # Monta payload para encaminhar ao main.py
    forward_payload = {
        "nome": nome,
        "cpf": cpf or None,
        "link_zoom": meeting_url,
        "ip": req.client.host if req.client else None,
    }


    # tenta encaminhar para /token -> /zoom/checkin no mesmo serviço
    base = str(req.base_url)  # ex: http://127.0.0.1:8080/
    token_url = base + "token"
    checkin_url = base + "zoom/checkin"

    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            # 1) obtém token
            auth_resp = await http.post(token_url, data={"username": SERVICE_USER, "password": SERVICE_PASS})
            if auth_resp.status_code == 200:
                token = auth_resp.json().get("access_token")
                headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
                # 2) encaminha ao endpoint de inserção
                resp = await http.post(checkin_url, json=forward_payload, headers=headers)
                if resp.status_code in (200, 201):
                    # retorna a resposta do main (preserva dados se houver)
                    try:
                        body = resp.json()
                    except:
                        body = {"ok": True}
                    # mantém comportamento de redirecionamento para frontend
                    return {"ok": True, "redirect": meeting_url, "backend": body}
                else:
                    # log breve e fallback para inserção direta
                    print(f"Forward to /zoom/checkin failed: {resp.status_code} {resp.text}")
            else:
                print(f"Token request failed: {auth_resp.status_code} {auth_resp.text}")
    except Exception as e:
        print(f"Erro ao encaminhar para /zoom/checkin: {e}")

    # fallback: inserir diretamente (comportamento antigo) caso encaminhamento falhe
    row = {
        "data_hora": datetime.now(timezone.utc).isoformat(),
        "nome": nome,
        "cpf": cpf or None,
        "link_zoom": meeting_url,   # <- nome da coluna IGUAL ao BQ
        "meeting_id": meeting_id or None,
        "ip": req.client.host if req.client else None,
    }

    try:
        table_id = f"{BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE}"
        errors = client.insert_rows_json(table_id, [row])
        if errors:
            print("BigQuery insert errors:", errors)
            return {"ok": False, "error": "BQ insert failed", "details": errors, "row": row}
    except Exception as e:
        print("Exceção BigQuery fallback:", e)
        return {"ok": False, "error": "BQ exception", "details": str(e)}

    return {"ok": True, "redirect": meeting_url, "fallback_insert": True}
