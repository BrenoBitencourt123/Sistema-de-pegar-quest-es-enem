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
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Carregar config.txt antes de importar o extrator
sys.path.insert(0, str(Path(__file__).parent))
from extrator import carregar_config, processar_prova

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

    try:
        # Substituir o log global por nosso callback
        import extrator as ext
        ext._progress_cb = on_progress

        questoes = processar_prova(
            pdf_path=pdf_path,
            ano=ano,
            dia=dia,
            caderno=caderno,
            gabarito_path=gabarito_path,
        )
        q.put({"tipo": "done", "questoes": questoes})

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
        while True:
            # Ler da fila sem bloquear o event loop
            try:
                item = await loop.run_in_executor(None, q.get, True, 30)
            except Exception:
                yield "data: {\"tipo\":\"erro\",\"msg\":\"Timeout\"}\n\n"
                break

            if item is None:
                # Fim do stream
                del jobs[job_id]
                break

            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

            if item.get("tipo") in ("done", "erro"):
                # Aguardar sentinela
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


@app.get("/")
def root():
    return {"status": "ok", "msg": "Servidor de extração ENEM rodando"}


# ─── Patch no log() do extrator para usar callback ───────────────────────────

import extrator as _ext

_ext._progress_cb = None
_original_log = _ext.log

def _patched_log(msg: str, nivel: str = "info"):
    _original_log(msg, nivel)  # manter print no terminal também
    if _ext._progress_cb:
        _ext._progress_cb(msg, nivel)

_ext.log = _patched_log


# ─── Iniciar servidor ────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n[OK] Servidor ENEM iniciado")
    print("  API: http://localhost:8000")
    print("  Aguardando requisicoes do editor...\n")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")
