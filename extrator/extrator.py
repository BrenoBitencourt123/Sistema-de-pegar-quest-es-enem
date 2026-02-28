"""
Extrator de questões do ENEM
Converte PDF da prova → JSON compatível com o editor de questões

Uso:
    python extrator.py --pdf prova.pdf --ano 2020 --dia 1 --caderno Azul
    python extrator.py --pdf prova.pdf --ano 2020 --dia 1 --caderno Azul --gabarito gabarito.txt
"""

import argparse
import base64
import io
import json
import os
import sys
import time
from pathlib import Path

# ─── Dependências ────────────────────────────────────────────────────────────
try:
    from pdf2image import convert_from_path
    import fitz  # PyMuPDF
    from openai import OpenAI
except ImportError as e:
    print(f"Dependência faltando: {e}")
    print("Execute: pip install pdf2image pymupdf openai pillow")
    sys.exit(1)

# ─── Ler config.txt ──────────────────────────────────────────────────────────
def carregar_config():
    config_path = Path(__file__).parent / "config.txt"
    if not config_path.exists():
        return
    for linha in config_path.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if linha.startswith("#") or "=" not in linha:
            continue
        chave, _, valor = linha.partition("=")
        chave = chave.strip()
        valor = valor.strip()
        if chave and valor and valor != "cole-sua-chave-aqui":
            os.environ.setdefault(chave, valor)

carregar_config()

# ─── Configurações ────────────────────────────────────────────────────────────
MODELO_PRIMARIO  = "gpt-4o-mini"   # barato, cobre ~90% dos casos
MODELO_FALLBACK  = "gpt-4o"        # usado quando o primário falha
DPI              = 200             # qualidade da conversão PDF → imagem
TAMANHO_MINIMO   = 80              # ignorar imagens menores que NxN pixels (logos, separadores)
MAX_TENTATIVAS   = 3               # tentativas por página antes de desistir
LETRAS           = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4}
POPPLER_PADRAO   = r"C:\poppler-24.08.0\Library\bin"  # detectado no sistema

# Precos por 1M de tokens (USD) — atualizar conforme tabela OpenAI
PRECOS = {
    "gpt-4o-mini": {"input": 0.15,  "output": 0.60},
    "gpt-4o":      {"input": 2.50,  "output": 10.00},
}

PROMPT_SISTEMA = """
Você é um extrator especializado em questões de provas do ENEM.
Analise a imagem da página da prova e extraia TODAS as questões visíveis.

Retorne SOMENTE um JSON no formato:
{
  "questoes": [
    {
      "numero": "1",
      "area": "linguagens|humanas|natureza|matematica|ingles|espanhol",
      "enunciado": "",
      "tem_imagem": false,
      "legenda_imagem": "",
      "comando": "a pergunta em si — última frase antes das alternativas A B C D E",
      "alternativas": ["texto completo da A", "texto B", "texto C", "texto D", "texto E"]
    }
  ]
}

Regras:
1. Inclua TODAS as questões visíveis na página, mesmo que estejam incompletas
2. Se uma questão começa na página anterior, inclua só o trecho visível nesta página
3. Alternativas SEMPRE em ordem A, B, C, D, E (5 elementos)
4. Se a questão tem imagem/figura/gráfico/tabela, marque tem_imagem como true
5. Para língua estrangeira: área = "ingles" ou "espanhol" conforme o cabeçalho
6. NUNCA invente ou complete texto que não está visível na imagem
7. Preserve acentuação e formatação original do português
"""


# ─── Utilitários ──────────────────────────────────────────────────────────────

def imagem_para_base64(img_pil: "PIL.Image") -> str:
    buf = io.BytesIO()
    img_pil.save(buf, format="JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode()


def validar_questao(q: dict) -> bool:
    """Verifica se a questão tem os campos mínimos necessários."""
    return (
        q.get("numero") and
        isinstance(q.get("alternativas"), list) and
        len(q["alternativas"]) == 5 and
        q.get("comando")
    )


def log(msg: str, nivel: str = "info"):
    prefixos = {"info": "  ->", "ok": "  [OK]", "warn": "  [!]", "erro": "  [X]", "titulo": "\n>>"}
    print(f"{prefixos.get(nivel, '  ')} {msg}", flush=True)


# ─── Extração de imagens do PDF ───────────────────────────────────────────────

def extrair_imagens_por_pagina(pdf_path: str) -> dict[int, list[str]]:
    """
    Retorna dicionário {num_pagina: [base64_img1, base64_img2, ...]}
    Imagens ordenadas pela posição vertical (Y) na página.
    """
    log("Extraindo imagens embutidas do PDF...", "titulo")
    doc = fitz.open(pdf_path)
    resultado = {}

    for num_pag in range(len(doc)):
        pagina = doc[num_pag]
        imagens_com_pos = []

        for img in pagina.get_images(full=True):
            xref = img[0]
            base = doc.extract_image(xref)

            # Ignorar imagens pequenas (logos, ícones, separadores gráficos)
            if base["width"] < TAMANHO_MINIMO or base["height"] < TAMANHO_MINIMO:
                continue

            # Obter posição Y da imagem na página para ordenação
            rects = pagina.get_image_rects(xref)
            y_pos = rects[0].y0 if rects else 0

            # Converter CMYK para RGB para evitar negativo/invertido
            try:
                from PIL import Image as PilImage
                img_pil = PilImage.open(io.BytesIO(base["image"]))
                if img_pil.mode in ("CMYK", "CMYK;I", "L;I"):
                    img_pil = img_pil.convert("RGB")
                    buf = io.BytesIO()
                    img_pil.save(buf, format="PNG")
                    b64 = base64.b64encode(buf.getvalue()).decode()
                    data_uri = f"data:image/png;base64,{b64}"
                else:
                    b64 = base64.b64encode(base["image"]).decode()
                    data_uri = f"data:image/{base['ext']};base64,{b64}"
            except Exception:
                b64 = base64.b64encode(base["image"]).decode()
                data_uri = f"data:image/{base['ext']};base64,{b64}"

            imagens_com_pos.append((y_pos, data_uri))

        # Ordenar por posição vertical (de cima para baixo)
        imagens_com_pos.sort(key=lambda x: x[0])
        resultado[num_pag] = [img for _, img in imagens_com_pos]

        if resultado[num_pag]:
            log(f"Página {num_pag + 1}: {len(resultado[num_pag])} imagem(ns) encontrada(s)", "ok")

    doc.close()
    return resultado


# ─── Chamada à API ────────────────────────────────────────────────────────────

def chamar_gpt(client: OpenAI, img_b64: str, num_pagina: int, modelo: str) -> tuple[dict, dict]:
    resposta = client.chat.completions.create(
        model=modelo,
        max_tokens=4096,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": PROMPT_SISTEMA},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{img_b64}",
                            "detail": "high"
                        }
                    },
                    {
                        "type": "text",
                        "text": f"Esta é a página {num_pagina} da prova. Extraia todas as questões visíveis."
                    }
                ]
            }
        ]
    )
    uso = {
        "modelo":  modelo,
        "input":   resposta.usage.prompt_tokens,
        "output":  resposta.usage.completion_tokens,
    }
    return json.loads(resposta.choices[0].message.content), uso


def processar_pagina(client: OpenAI, pagina_pil, num_pagina: int) -> tuple[list[dict], list[dict]]:
    """Tenta extrair questões com modelo primário, faz fallback se necessário.
    Retorna (questoes, lista_de_uso) onde cada item de uso é {modelo, input, output}."""
    img_b64 = imagem_para_base64(pagina_pil)
    usos = []

    for tentativa in range(1, MAX_TENTATIVAS + 1):
        modelo = MODELO_FALLBACK if tentativa > 1 else MODELO_PRIMARIO
        if tentativa > 1:
            log(f"Tentativa {tentativa} com {modelo}...", "warn")

        try:
            resultado, uso = chamar_gpt(client, img_b64, num_pagina, modelo)
            usos.append(uso)

            preco = PRECOS.get(modelo, {"input": 0, "output": 0})
            custo = (uso["input"] * preco["input"] + uso["output"] * preco["output"]) / 1_000_000
            log(f"Tokens p.{num_pagina}: {uso['input']} in + {uso['output']} out = {uso['input']+uso['output']} total | ${custo:.5f} ({modelo})", "info")

            questoes = resultado.get("questoes", [])

            if not isinstance(questoes, list):
                raise ValueError("Resposta não contém lista de questões")

            validas = [q for q in questoes if validar_questao(q)]

            if not validas and questoes:
                log(f"Questões extraídas mas inválidas, retentando...", "warn")
                continue

            return validas, usos

        except json.JSONDecodeError:
            log(f"JSON inválido na tentativa {tentativa}", "warn")
        except Exception as e:
            log(f"Erro na tentativa {tentativa}: {e}", "warn")
            if tentativa < MAX_TENTATIVAS:
                time.sleep(2)

    log(f"Página {num_pagina} falhou após {MAX_TENTATIVAS} tentativas", "erro")
    return [], usos


# ─── Associar imagens às questões ─────────────────────────────────────────────

def associar_imagens(questoes_por_pagina: list[tuple[int, list[dict]]],
                     imagens_por_pagina: dict[int, list[str]]) -> list[dict]:
    """
    Associa imagens embutidas às questões que têm tem_imagem=True.
    Usa um índice global de imagens, consumindo-as em ordem de página.
    """
    # Fila de imagens em ordem de aparecimento (página, depois posição Y)
    fila_imagens = []
    for num_pag in sorted(imagens_por_pagina.keys()):
        fila_imagens.extend(imagens_por_pagina[num_pag])

    idx_img = 0
    questoes_final = []

    for num_pag, questoes in questoes_por_pagina:
        for q in questoes:
            imagem = None
            if q.get("tem_imagem") and idx_img < len(fila_imagens):
                imagem = fila_imagens[idx_img]
                idx_img += 1
            questoes_final.append((q, imagem))

    return questoes_final


# ─── Gabarito ─────────────────────────────────────────────────────────────────

def carregar_gabarito(caminho: str) -> dict[str, str]:
    """
    Le um arquivo de gabarito em .txt ou .pdf.
    Formatos aceitos:
        01 A  /  01 - A  /  01:A  (um por linha)
        ou separado por virgulas: 01:A,02:C,...
    """
    gabarito = {}
    if not caminho or not Path(caminho).exists():
        return gabarito

    if caminho.lower().endswith(".pdf"):
        doc = fitz.open(caminho)
        texto = "\n".join(pagina.get_text() for pagina in doc)
        doc.close()
    else:
        texto = Path(caminho).read_text(encoding="utf-8")

    # Tentar formato "01 A" ou "01:A" por linha
    for linha in texto.splitlines():
        linha = linha.strip()
        if not linha:
            continue
        partes = linha.replace(":", " ").replace(",", " ").split()
        if len(partes) >= 2:
            num, letra = partes[0].lstrip("0") or "0", partes[1].upper()
            if letra in LETRAS:
                gabarito[num] = letra

    log(f"Gabarito carregado: {len(gabarito)} respostas", "ok")
    return gabarito


# ─── Montar JSON final ────────────────────────────────────────────────────────

_PLACEHOLDERS = {
    "string vazia se não houver",
    "texto de apoio",
    "fonte ou legenda",
}

def _limpar(texto: str) -> str:
    """Remove textos que o modelo copiou literalmente do prompt de exemplo."""
    if not texto:
        return ""
    tl = texto.lower()
    if any(p in tl for p in _PLACEHOLDERS):
        return ""
    return texto


def montar_json_final(questoes_com_imagem: list[tuple[dict, str]],
                      gabarito: dict[str, str],
                      ano: int, dia: int, caderno: str) -> list[dict]:
    resultado = []

    for q, imagem in questoes_com_imagem:
        numero = str(q.get("numero", "")).lstrip("0") or "0"
        letra_correta = gabarito.get(numero, "")
        correct = LETRAS.get(letra_correta, 0)

        resultado.append({
            "exam":         f"ENEM {ano} – {dia}º Dia – Caderno {caderno}",
            "number":       q.get("numero", ""),
            "area":         q.get("area", ""),
            "statement":    _limpar(q.get("enunciado", "")),
            "image":        imagem,
            "imageCaption": _limpar(q.get("legenda_imagem", "")),
            "command":      q.get("comando", ""),
            "alternatives": q.get("alternativas", ["", "", "", "", ""]),
            "correct":      correct,
        })

    # Ordenar por número da questão
    resultado.sort(key=lambda q: int(q["number"]) if str(q["number"]).isdigit() else 0)

    return resultado


# ─── Salvar progresso incremental ────────────────────────────────────────────

def salvar_progresso(questoes: list[dict], caminho_saida: str):
    """Salva o que já foi processado, para não perder em caso de erro."""
    Path(caminho_saida).write_text(
        json.dumps(questoes, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


# ─── Pipeline principal ───────────────────────────────────────────────────────

def processar_prova(pdf_path: str, ano: int, dia: int, caderno: str,
                    gabarito_path: str = None, poppler_path: str = None):

    saida = f"questoes_{ano}_dia{dia}_{caderno.lower()}.json"
    log(f"ENEM {ano} – Dia {dia} – Caderno {caderno}", "titulo")
    log(f"PDF: {pdf_path}")
    log(f"Saída: {saida}")

    # 1. Converter PDF em imagens
    log("Convertendo PDF em imagens...", "titulo")
    kwargs = {"dpi": DPI}
    poppler_path = poppler_path or POPPLER_PADRAO
    if poppler_path and os.path.exists(poppler_path):
        kwargs["poppler_path"] = poppler_path

    paginas = convert_from_path(pdf_path, **kwargs)
    log(f"{len(paginas)} páginas encontradas", "ok")

    # 2. Extrair imagens embutidas
    imagens_por_pagina = extrair_imagens_por_pagina(pdf_path)

    # 3. Processar páginas com GPT-4o
    log("Processando páginas com GPT-4o...", "titulo")
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("\nERRO: variável OPENAI_API_KEY não definida.")
        print("Execute: set OPENAI_API_KEY=sua-chave   (Windows)")
        sys.exit(1)

    client = OpenAI(api_key=api_key)
    questoes_por_pagina = []
    questoes_acumuladas = []
    total_input = 0
    total_output = 0
    custo_total = 0.0

    for i, pagina in enumerate(paginas):
        log(f"Página {i + 1}/{len(paginas)}...", "info")
        questoes, usos = processar_pagina(client, pagina, i + 1)

        for uso in usos:
            preco = PRECOS.get(uso["modelo"], {"input": 0, "output": 0})
            total_input  += uso["input"]
            total_output += uso["output"]
            custo_total  += (uso["input"] * preco["input"] + uso["output"] * preco["output"]) / 1_000_000

        if questoes:
            log(f"{len(questoes)} questão(ões) extraída(s)", "ok")
            questoes_por_pagina.append((i, questoes))
        else:
            log(f"Nenhuma questão nesta página", "info")

        # Salvar progresso a cada 5 páginas
        if (i + 1) % 5 == 0:
            parcial = montar_json_final(
                associar_imagens(questoes_por_pagina, imagens_por_pagina),
                {}, ano, dia, caderno
            )
            salvar_progresso(parcial, saida + ".parcial.json")
            log(f"Progresso salvo ({len(parcial)} questões até agora)", "ok")

    # 4. Associar imagens às questões
    log("Associando imagens às questões...", "titulo")
    questoes_com_imagem = associar_imagens(questoes_por_pagina, imagens_por_pagina)
    com_imagem = sum(1 for _, img in questoes_com_imagem if img)
    log(f"{com_imagem} questão(ões) com imagem associada", "ok")

    # 5. Carregar gabarito
    gabarito = carregar_gabarito(gabarito_path)

    # 6. Montar JSON final
    log("Montando JSON final...", "titulo")
    questoes_finais = montar_json_final(
        questoes_com_imagem, gabarito, ano, dia, caderno
    )

    # Remover arquivo parcial
    parcial = Path(saida + ".parcial.json")
    if parcial.exists():
        parcial.unlink()

    # 7. Salvar
    Path(saida).write_text(
        json.dumps(questoes_finais, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    log(f"Concluído! {len(questoes_finais)} questões salvas em: {saida}", "titulo")

    # Resumo de tokens e custo
    log(f"--- Tokens totais ---", "info")
    log(f"Input:  {total_input:,} tokens", "info")
    log(f"Output: {total_output:,} tokens", "info")
    log(f"Total:  {total_input + total_output:,} tokens", "info")
    log(f"Custo estimado: ${custo_total:.4f} USD", "ok")

    # Resumo
    sem_gabarito = sum(1 for q in questoes_finais if not gabarito.get(q["number"]))
    if sem_gabarito:
        log(f"{sem_gabarito} questão(ões) sem gabarito — correct=0 por padrão", "warn")
    incompletas = sum(1 for q in questoes_finais if not q["command"])
    if incompletas:
        log(f"{incompletas} questão(ões) incompletas — revise no editor", "warn")

    return questoes_finais


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Extrator de questões do ENEM — PDF → JSON"
    )
    parser.add_argument("--pdf",       required=True,  help="Caminho para o PDF da prova")
    parser.add_argument("--ano",       required=True,  type=int, help="Ano da prova (ex: 2020)")
    parser.add_argument("--dia",       required=True,  type=int, choices=[1, 2], help="Dia da prova (1 ou 2)")
    parser.add_argument("--caderno",   required=True,  help="Cor do caderno (ex: Azul, Amarelo)")
    parser.add_argument("--gabarito",  default=None,   help="Caminho para arquivo de gabarito (.txt)")
    parser.add_argument("--poppler",   default=None,   help="Caminho do Poppler (necessário no Windows)")

    args = parser.parse_args()

    if not Path(args.pdf).exists():
        print(f"ERRO: arquivo não encontrado: {args.pdf}")
        sys.exit(1)

    processar_prova(
        pdf_path=args.pdf,
        ano=args.ano,
        dia=args.dia,
        caderno=args.caderno,
        gabarito_path=args.gabarito,
        poppler_path=args.poppler,
    )
