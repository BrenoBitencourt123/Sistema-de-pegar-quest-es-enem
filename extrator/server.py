"""
Servidor FastAPI para extração de questões do ENEM via interface web.
Inicie com: python server.py
Acesse em:  http://localhost:8000
"""

import asyncio
import json
import os
import queue
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

from pydantic import BaseModel

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Carregar config.txt antes de importar o extrator
sys.path.insert(0, str(Path(__file__).parent))
from extrator import carregar_config, processar_prova, detectar_layout, extrair_texto_ordenado, carregar_gabarito, classificar_questoes

carregar_config()

app = FastAPI(title="Extrator ENEM")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Armazenamento de jobs em memória ────────────────────────────────────────
jobs: dict[str, queue.Queue] = {}


# ─── Worker que roda a extração em thread separada ────────────────────────────

def _worker(job_id: str, pdf_path: str, ano: int, dia: int,
            caderno: str, gabarito_path: str | None):
    q = jobs[job_id]

    def on_progress(msg: str, nivel: str = "info"):
        q.put({"tipo": "log", "msg": msg, "nivel": nivel})

    def on_partial(questoes: list):
        q.put({"tipo": "partial", "questoes": questoes})

    try:
        # Registrar callback de log nesta thread (thread-local evita conflito entre jobs simultâneos)
        _thread_log_cb.cb = on_progress

        questoes, relatorio = processar_prova(
            pdf_path=pdf_path,
            ano=ano,
            dia=dia,
            caderno=caderno,
            gabarito_path=gabarito_path,
            partial_cb=on_partial,
        )
        q.put({"tipo": "done", "questoes": questoes, "relatorio": relatorio})

    except Exception as e:
        q.put({"tipo": "erro", "msg": str(e)})
    finally:
        # Limpar PDF temporário
        try:
            os.unlink(pdf_path)
            if gabarito_path:
                os.unlink(gabarito_path)
        except Exception:
            pass
        q.put(None)  # sentinela de fim


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/extrair")
async def extrair(
    pdf: UploadFile = File(...),
    ano: int = Form(...),
    dia: int = Form(...),
    caderno: str = Form(...),
    gabarito: UploadFile | None = File(default=None),
):
    # Salvar PDF em arquivo temporário
    pdf_bytes = await pdf.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(pdf_bytes)
        pdf_path = tmp.name

    gabarito_path = None
    if gabarito and gabarito.filename:
        ext = ".pdf" if gabarito.filename.lower().endswith(".pdf") else ".txt"
        gab_bytes = await gabarito.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext, mode="wb") as tmp:
            tmp.write(gab_bytes)
            gabarito_path = tmp.name

    job_id = str(uuid.uuid4())
    jobs[job_id] = queue.Queue()

    thread = threading.Thread(
        target=_worker,
        args=(job_id, pdf_path, ano, dia, caderno, gabarito_path),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id}


@app.get("/progresso/{job_id}")
async def progresso(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job não encontrado")

    q = jobs[job_id]

    async def gerar():
        loop = asyncio.get_event_loop()
        segundos_idle = 0
        MAX_IDLE = 600  # 10 minutos de inatividade total antes de desistir

        while True:
            # Aguardar próximo item com check de 30s para emitir heartbeat
            try:
                item = await loop.run_in_executor(None, q.get, True, 30)
                segundos_idle = 0  # reset ao receber qualquer item
            except Exception:
                # Nenhum item em 30s — emite heartbeat SSE e continua aguardando
                segundos_idle += 30
                if segundos_idle >= MAX_IDLE:
                    yield "data: {\"tipo\":\"erro\",\"msg\":\"Timeout: servidor sem resposta por 10 minutos\"}\n\n"
                    break
                yield ": heartbeat\n\n"  # comentário SSE — mantém conexão viva
                continue

            if item is None:
                # Sentinela de fim
                del jobs[job_id]
                break

            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

            if item.get("tipo") in ("done", "erro"):
                # Aguardar sentinela final
                try:
                    await loop.run_in_executor(None, q.get, True, 5)
                except Exception:
                    pass
                del jobs[job_id]
                break

    return StreamingResponse(
        gerar(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


class CorrecaoPayload(BaseModel):
    numero: str
    original: dict
    corrigido: dict
    campos_alterados: list[str]


@app.post("/correcao")
async def salvar_correcao(payload: CorrecaoPayload):
    """
    Salva uma correção manual feita pelo usuário no editor.
    As correções são usadas como exemplos few-shot nas próximas extrações.
    """
    caminho = Path(__file__).parent / "correcoes.json"
    historico: list = []
    if caminho.exists():
        try:
            historico = json.loads(caminho.read_text(encoding="utf-8"))
        except Exception:
            historico = []

    historico.append({
        "numero":          payload.numero,
        "campos_alterados": payload.campos_alterados,
        "original":        payload.original,
        "corrigido":       payload.corrigido,
        "timestamp":       time.time(),
    })

    # Manter no máximo 200 correções para não crescer indefinidamente
    if len(historico) > 200:
        historico = historico[-200:]

    caminho.write_text(json.dumps(historico, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "total": len(historico)}


@app.get("/correcoes/count")
def contar_correcoes():
    caminho = Path(__file__).parent / "correcoes.json"
    if not caminho.exists():
        return {"total": 0}
    try:
        historico = json.loads(caminho.read_text(encoding="utf-8"))
        return {"total": len(historico)}
    except Exception:
        return {"total": 0}


@app.post("/preview-texto")
async def preview_texto(pdf: UploadFile = File(...)):
    """
    Extrai o texto de cada página do PDF usando PyMuPDF + detecção de layout,
    SEM chamar nenhuma IA. Útil para inspecionar o que seria enviado ao GPT.
    """
    import fitz
    import re

    pdf_bytes = await pdf.read()
    paginas = []

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for i, pagina in enumerate(doc):
            layout = detectar_layout(pagina)
            texto  = extrair_texto_ordenado(pagina, layout)
            n_marc = len(re.findall(r'\[[ABCDE]\] ', texto))

            debug = {"colunas": layout["colunas"]}
            if layout["colunas"] == 2:
                mid = layout.get("mid", pagina.rect.width / 2)
                debug["mid_px"]  = round(mid, 1)
                debug["mid_pct"] = round(mid / pagina.rect.width * 100, 1)
                try:
                    blocos = [b for b in pagina.get_text("dict")["blocks"] if b.get("type") == 0]
                    debug["blocos_esq"] = sum(1 for b in blocos if (b["bbox"][0] + b["bbox"][2]) / 2 < mid)
                    debug["blocos_dir"] = sum(1 for b in blocos if (b["bbox"][0] + b["bbox"][2]) / 2 >= mid)
                    debug["total_blocos"] = len(blocos)
                except Exception:
                    pass

            paginas.append({
                "pagina":       i + 1,
                "colunas":      layout["colunas"],
                "n_marcadores": n_marc,
                "chars":        len(texto),
                "debug":        debug,
                "texto":        texto,
            })
        doc.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar PDF: {e}")

    return {"paginas": paginas}


@app.post("/gabarito")
async def aplicar_gabarito(
    gabarito: UploadFile = File(...),
    caderno: str = Form(default="Azul"),
):
    """
    Recebe um PDF ou TXT de gabarito e retorna o dicionário de respostas.
    Chaves: "N", "N-en", "N-es". Valores: "A"–"E".
    """
    ext = ".pdf" if gabarito.filename.lower().endswith(".pdf") else ".txt"
    gab_bytes = await gabarito.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext, mode="wb") as tmp:
        tmp.write(gab_bytes)
        gab_path = tmp.name

    try:
        resultado = carregar_gabarito(gab_path, caderno)
    finally:
        try:
            os.unlink(gab_path)
        except Exception:
            pass

    return {"gabarito": resultado}


class QuestaoSimples(BaseModel):
    number: str
    area: str = "matematica"
    command: str = ""
    alternatives: list  # [str | {"text": str}]


class ClassificarPayload(BaseModel):
    questoes: list[QuestaoSimples]


@app.post("/classificar")
async def classificar(payload: ClassificarPayload):
    """
    Recebe questões no formato do editor e retorna campos de classificação
    (disciplina, topic, subtopic, skills, cognitive_level, difficulty).
    """
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY não configurada")

    client = OpenAI(api_key=api_key)

    # Converter para o formato esperado por classificar_questoes()
    questoes_fmt = []
    for q in payload.questoes:
        alts = []
        for a in q.alternatives:
            if isinstance(a, dict):
                alts.append({"text": a.get("text", "")})
            else:
                alts.append({"text": str(a)})
        questoes_fmt.append({
            "number": q.number,
            "area": q.area,
            "command": q.command,
            "alternatives": alts,
        })

    classificadas, _ = classificar_questoes(questoes_fmt, client)

    campos = ["disciplina", "topic", "subtopic", "skills", "cognitive_level", "difficulty"]
    resultado = {}
    for q in classificadas:
        cls = {c: q.get(c) for c in campos if q.get(c) is not None}
        if cls:
            resultado[str(q["number"])] = cls

    return {"classificacoes": resultado}


@app.get("/")
def root():
    return {"status": "ok", "msg": "Servidor de extração ENEM rodando"}


# ─── Patch no log() do extrator para usar callback por thread ────────────────
# Cada job roda em sua própria thread. Usando threading.local() cada thread
# tem seu próprio callback — jobs simultâneos não se interferem.

import threading
import extrator as _ext

_thread_log_cb = threading.local()  # atributo .cb por thread
_original_log = _ext.log

def _patched_log(msg: str, nivel: str = "info"):
    _original_log(msg, nivel)  # manter print no terminal
    cb = getattr(_thread_log_cb, 'cb', None)
    if cb:
        cb(msg, nivel)

_ext.log = _patched_log


# ─── Iniciar servidor ────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n[OK] Servidor ENEM iniciado")
    print("  API: http://localhost:8000")
    print("  Aguardando requisicoes do editor...\n")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")
