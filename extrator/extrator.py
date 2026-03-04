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

# ─── Dependências ─────────────────────────────────────────────────────────────
try:
    import fitz  # PyMuPDF
    from openai import OpenAI
except ImportError as e:
    print(f"Dependência faltando: {e}")
    print("Execute: pip install pymupdf openai")
    sys.exit(1)

# pdf2image só é necessário como fallback para PDFs escaneados
try:
    from pdf2image import convert_from_path
    _PDF2IMAGE_OK = True
except ImportError:
    _PDF2IMAGE_OK = False

# ─── Ler config.txt ───────────────────────────────────────────────────────────
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
MODELO_PRIMARIO  = "gpt-4o-mini"
MODELO_FALLBACK  = "gpt-4o"
DPI              = 150       # resolução de renderização para modo imagem/híbrido
MAX_TENTATIVAS   = 3
MIN_CHARS_TEXTO  = 200       # mínimo de caracteres para considerar página com texto
LETRAS           = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4}
POPPLER_PADRAO   = r"C:\Users\breno\poppler\poppler-24.08.0\Library\bin"

# Modo de extração:
#   "texto"   — só texto extraído (mais barato, gpt-4o-mini)
#   "imagem"  — só imagem renderizada (PDFs escaneados, gpt-4o)
#   "hibrido" — imagem + texto junto para o GPT (melhor qualidade, gpt-4o)
MODO_EXTRACAO = "texto"

PRECOS = {
    "gpt-4o-mini":        {"input": 0.15,  "output": 0.60},
    "gpt-4o":             {"input": 2.50,  "output": 10.00},
    "claude-sonnet-4-6":  {"input": 3.00,  "output": 15.00},
}

# ─── Taxonomia de classificação ───────────────────────────────────────────────

SKILLS_DISPONIVEIS = [
    # Leitura
    "leitura_grafico", "leitura_tabela", "leitura_mapa",
    "leitura_fonte_historica", "leitura_imagem",
    # Raciocínio
    "causa_consequencia", "comparacao", "inferencia_implicita",
    "analise_critica", "argumentacao",
    # Matemática aplicada
    "aplicacao_formula", "conversao_unidades", "proporcionalidade",
    "calculo_numerico", "geometria_espacial",
    # Contexto
    "situacao_real", "impacto_socioambiental", "tecnologia_sociedade",
    "cidadania_etica", "saude_bem_estar", "linguagem_comunicacao",
]

PROMPT_CLASSIFICADOR = """Você é um classificador de questões do ENEM.
Para cada questão, atribua: disciplina, tópico canônico, subtópico (livre), skills, nível cognitivo e dificuldade.

DISCIPLINAS por área:
- humanas: historia, geografia, sociologia, filosofia
- natureza: quimica, fisica, biologia
- linguagens: portugues, literatura, artes, ingles, espanhol
- matematica: matematica

TÓPICO: formato {disciplina}__{tema_snake_case}
Exemplos: historia__era_vargas, fisica__mecanica_newtoniana, matematica__porcentagem, biologia__genetica

SUBTÓPICO: refinamento livre opcional (ex: "Financeira" dentro de matematica__porcentagem)

SKILLS disponíveis (use 1 a 3):
""" + ", ".join(SKILLS_DISPONIVEIS) + """

NÍVEL COGNITIVO: recordacao | compreensao | aplicacao | analise

DIFICULDADE: 1 (fácil) a 5 (difícil)

Retorne SOMENTE JSON:
{
  "classificacoes": [
    {
      "numero": "1",
      "disciplina": "historia",
      "topic": "historia__era_vargas",
      "subtopic": "Estado Novo",
      "skills": ["leitura_fonte_historica", "analise_critica"],
      "cognitive_level": "analise",
      "difficulty": 3
    }
  ]
}"""

PROMPT_SISTEMA = """
Você é um extrator especializado em questões de provas do ENEM.
Analise o conteúdo da página da prova e extraia TODAS as questões visíveis.

Retorne SOMENTE um JSON no formato:
{
  "questoes": [
    {
      "numero": "1",
      "area": "linguagens|humanas|natureza|matematica|ingles|espanhol",
      "conteudo": [
        { "tipo": "texto", "valor": "texto de apoio ou contexto..." },
        { "tipo": "imagem", "legenda": "legenda da figura se houver", "tem_imagem": true },
        { "tipo": "texto", "valor": "texto intermediário entre imagens se houver..." }
      ],
      "comando": "",
      "alternativas": ["texto completo da A", "texto B", "texto C", "texto D", "texto E"]
    }
  ]
}

Campos:
- conteudo: array de blocos ordenados que formam o corpo da questão, ANTES das alternativas e do comando.
  * bloco "texto": trecho de texto/contexto/enunciado. Pode haver múltiplos blocos de texto.
  * bloco "imagem": indica presença de figura/gráfico/tabela/imagem no ponto correspondente do layout. Pode haver múltiplas imagens.
  * A ORDEM dos blocos deve refletir a ordem visual na página (texto → imagem → texto → imagem, etc.)
  * Se não houver texto de contexto, "conteudo" pode ser array vazio [] ou conter só blocos de imagem.
- comando: a frase/pergunta que aparece IMEDIATAMENTE ANTES das alternativas A B C D E.
  Geralmente começa com "Os recursos...", "De acordo com...", "Assinale...", "Com base...", etc.
  Se não estiver visível (ex: está dentro de uma imagem), deixe como string vazia "".
  CRÍTICO: o texto do comando NUNCA deve aparecer também em "conteudo". Se um texto for o comando, coloque-o APENAS em "comando" e NÃO o inclua em "conteudo". Os campos são mutuamente exclusivos para o mesmo trecho.
  TESTE SEMÂNTICO para identificar o comando: mentalmente concatene cada alternativa com o último parágrafo de texto antes delas. Se formar uma frase com sentido ("Esses polímeros têm vantagens porque... são degradados mais rápido" ✓), esse parágrafo é o "comando". Se não fizer sentido concatenado ("A enorme quantidade de resíduos... são degradados mais rápido" ✗), é texto de apoio e vai em "conteudo".

Marcadores de alternativa:
O texto extraído usa [A], [B], [C], [D], [E] para marcar o início de cada alternativa.
- Tudo antes de [A] é conteúdo/contexto da questão (campo "conteudo") e o comando
- O ÚLTIMO parágrafo/frase antes de [A] é o campo "comando"
- O texto entre [A] e [B] é a alternativa A; entre [B] e [C] é a alternativa B, etc.
- NÃO inclua os marcadores [A] [B] etc. no texto das alternativas extraídas

Regras gerais:
1. Inclua TODAS as questões visíveis na página, mesmo que estejam incompletas
2. Se uma questão começa na página anterior, inclua só o trecho visível nesta página
3. Alternativas SEMPRE em ordem A, B, C, D, E — extraia o texto APÓS o marcador [X]
4. Se a questão menciona imagem/figura/gráfico/tabela, inclua um bloco { "tipo": "imagem", "tem_imagem": true } na posição correta do array conteudo
5. Para língua estrangeira: área = "ingles" ou "espanhol" conforme o cabeçalho
6. NUNCA invente ou complete texto que não está na página
7. Preserve acentuação e formatação original
8. NUNCA copie exemplos do prompt — se um campo não tiver conteúdo visível, deixe vazio

Regras para questões de língua estrangeira (inglês/espanhol):
- O texto de apoio (artigo, conto, poema, crônica) INTEIRO vai em conteudo[] como bloco "texto"
- O campo "comando" é a pergunta IMEDIATAMENTE ANTES das alternativas A B C D E
  Geralmente começa com: "According to the text", "The author", "In the text", "Choose the", "Based on the text", etc.
- As linhas "A texto...", "B texto..." etc. são as ALTERNATIVAS — NUNCA coloque texto de alternativa no "comando"
- Se o texto de apoio for longo, inclua-o completo — não truncar

Exemplo de questão de inglês bem extraída:
{
  "numero": "2",
  "area": "ingles",
  "conteudo": [
    {"tipo": "texto", "valor": "TEXTO I\n\nThe act of writing is inseparable from the act of reading. Every sentence I write, I read; every paragraph, I read again..."}
  ],
  "comando": "According to the text, writing and reading",
  "alternativas": [
    "are opposing processes that rarely intersect.",
    "complement each other in the creative process.",
    "depend on different cognitive skills.",
    "are equally valued in academic settings.",
    "require distinct forms of concentration."
  ]
}
"""

# ─── Callbacks (injetados pelo server.py) ─────────────────────────────────────
_progress_cb = None  # fn(msg, nivel)
_partial_cb  = None  # fn(questoes_parciais)

# ─── Dependência opcional: Anthropic (para revisor Claude) ───────────────────
try:
    from anthropic import Anthropic as _AnthropicClient
    _ANTHROPIC_OK = True
except ImportError:
    _ANTHROPIC_OK = False

# ─── Utilitários ──────────────────────────────────────────────────────────────

def imagem_para_base64(img_pil) -> str:
    buf = io.BytesIO()
    img_pil.save(buf, format="JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode()


def _texto_legivel(texto: str) -> bool:
    """
    Retorna True se o texto parece conteúdo legível em português.
    PDFs com encoding não-padrão (ex: ENEM 2021) produzem caracteres
    do Private Use Area (U+E000–U+F8FF) ou substitutos (U+FFFD).
    """
    if not texto:
        return False
    chars_suspeitos = sum(
        1 for c in texto
        if 0xE000 <= ord(c) <= 0xF8FF   # Private Use Area
        or ord(c) == 0xFFFD              # Unicode replacement character
    )
    return chars_suspeitos / len(texto) < 0.05  # tolerância de 5%


def _renderizar_pagina_fitz(pagina) -> object:
    """
    Renderiza uma página do fitz como PIL Image sem precisar de pdf2image.
    Usado como fallback quando o texto está com encoding corrompido.
    """
    import PIL.Image
    mat = fitz.Matrix(DPI / 72, DPI / 72)
    pix = pagina.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    return PIL.Image.frombytes("RGB", [pix.width, pix.height], pix.samples)


def _detectar_e_dividir_colunas(img):
    """
    Detecta se a imagem tem layout de 2 colunas analisando a faixa vertical central.
    Retorna lista com 1 imagem (página inteira) ou 2 imagens (coluna esq + coluna dir).
    """
    import PIL.Image
    largura, altura = img.size

    # Analisa faixa central (30% a 70% da largura) procurando coluna de espaço branco
    x_inicio = int(largura * 0.30)
    x_fim    = int(largura * 0.70)
    img_gray = img.convert("L")
    pixels   = img_gray.load()

    # Para cada coluna vertical no range central, calcular brilho médio
    brilhos = []
    amostra_altura = min(altura, 200)  # usar primeiras linhas para eficiência
    for x in range(x_inicio, x_fim):
        total = sum(pixels[x, y] for y in range(50, amostra_altura))
        brilhos.append((x, total / (amostra_altura - 50)))

    if not brilhos:
        return [img]

    # Coluna mais clara no centro = gutter entre colunas
    x_mais_claro, brilho_max = max(brilhos, key=lambda b: b[1])
    brilho_medio = sum(b for _, b in brilhos) / len(brilhos)

    # Só divide se o ponto mais claro for significativamente mais claro que a média
    if brilho_max < brilho_medio * 1.05:
        return [img]

    # Expandir ponto mais claro para encontrar o gutter completo
    limiar = brilho_medio * 1.03
    x_esq = x_mais_claro
    x_dir = x_mais_claro
    for x in range(x_mais_claro, x_inicio, -1):
        if brilhos[x - x_inicio][1] >= limiar:
            x_esq = x
        else:
            break
    for x in range(x_mais_claro, x_fim):
        if brilhos[x - x_inicio][1] >= limiar:
            x_dir = x
        else:
            break

    x_corte = (x_esq + x_dir) // 2
    col_esq = img.crop((0, 0, x_corte, altura))
    col_dir = img.crop((x_corte, 0, largura, altura))
    return [col_esq, col_dir]


def detectar_layout(pagina) -> dict:
    """
    Analisa o layout da página usando coordenadas de blocos de texto.
    Retorna dict com: colunas (1 ou 2), rect_esq, rect_dir (se 2 colunas), imagens.
    """
    largura = pagina.rect.width
    altura  = pagina.rect.height

    try:
        blocos = pagina.get_text("dict")["blocks"]
    except Exception:
        return {"colunas": 1, "imagens": []}

    # Coordenadas x0 de blocos de texto (type=0)
    xs = [b["bbox"][0] for b in blocos if b.get("type") == 0]

    # Heurística bimodal: blocos concentrados em ambas as metades → duas colunas
    esq = sum(1 for x in xs if x < largura * 0.45)
    dir_ = sum(1 for x in xs if x > largura * 0.55)
    duas_colunas = esq >= 3 and dir_ >= 3

    # Detectar imagens e suas posições
    imagens = []
    try:
        for xref, *_ in pagina.get_images():
            rects = pagina.get_image_rects(xref)
            if rects:
                imagens.append({"rect": rects[0], "xref": xref})
    except Exception:
        pass

    if duas_colunas:
        mid = largura / 2
        return {
            "colunas": 2,
            "rect_esq": fitz.Rect(0, 0, mid, altura),
            "rect_dir": fitz.Rect(mid, 0, largura, altura),
            "imagens":  imagens,
        }
    return {"colunas": 1, "imagens": imagens}


def extrair_texto_ordenado(pagina, layout: dict) -> str:
    """
    Extrai texto em ordem visual de leitura (top→bottom, esq→dir).
    Usa get_text("dict") para detectar a fonte dos marcadores de alternativa.
    No ENEM, as letras A/B/C/D/E das alternativas usam a fonte 'BundesbahnPiStd-1'.
    Essas letras são marcadas como [A], [B], etc. no texto final para o GPT distinguir
    com precisão onde começa cada alternativa e onde está o campo 'comando'.
    """
    import re
    FONTE_ALT = "BundesbahnPiStd-1"

    try:
        dados = pagina.get_text("dict")
    except Exception:
        return pagina.get_text()

    blocos = []
    for bloco in dados.get("blocks", []):
        if bloco.get("type") != 0:
            continue
        x0, y0, x1, y1 = bloco["bbox"]

        linhas = []
        for linha in bloco.get("lines", []):
            partes = []
            for span in linha.get("spans", []):
                t = span["text"]
                if not t:
                    continue
                if span.get("font", "") == FONTE_ALT and t.strip() in "ABCDE":
                    partes.append(f"[{t.strip()}] ")
                else:
                    partes.append(t)
            linha_txt = "".join(partes).strip()
            if linha_txt:
                linhas.append(linha_txt)

        texto_bloco = "\n".join(linhas).strip()
        if texto_bloco:
            blocos.append((x0, y0, x1, y1, texto_bloco))

    if not blocos:
        return ""

    if layout["colunas"] == 2:
        mid  = pagina.rect.width / 2
        esq  = sorted([b for b in blocos if b[0] <  mid], key=lambda b: (b[1], b[0]))
        dir_ = sorted([b for b in blocos if b[0] >= mid], key=lambda b: (b[1], b[0]))
        partes = [t for *_, t in esq] + [t for *_, t in dir_]
    else:
        blocos.sort(key=lambda b: (b[1], b[0]))
        partes = [t for *_, t in blocos]

    texto = "\n\n".join(partes)
    # Mesclar marcador solto ([A]\n\ntexto → [A] texto) quando estão em blocos separados
    texto = re.sub(r'\[([ABCDE])\]\s*\n+\s*', r'[\1] ', texto)
    return texto


def validar_questao(q: dict) -> bool:
    # comando pode estar em imagem — não obrigatório para validação
    # conteudo pode ser array vazio — também válido
    return (
        q.get("numero") and
        isinstance(q.get("alternativas"), list) and
        len(q["alternativas"]) == 5
    )


def detectar_anomalias(questoes: list[dict]) -> dict[str, list[str]]:
    """
    Detecta problemas estruturais nas questões extraídas.
    Retorna {numero_questao: [lista de problemas]}.
    """
    problemas = {}

    for q in questoes:
        num = str(q.get("numero", "?"))
        erros = []

        comando = q.get("comando", "")
        alts    = q.get("alternativas", [])

        # Alternativa no campo comando: comando começa com "B ", "C ", "D " ou "E "
        # (exclui "A " pois é artigo feminino muito comum em português)
        if comando and len(comando) >= 2 and comando[0] in "BCDE" and comando[1] == " ":
            erros.append(
                f"campo 'comando' parece conter texto de alternativa: «{comando[:80]}»"
            )

        # Alternativas com comprimento muito discrepante (possível desalinhamento)
        textos = [a.get("text", a) if isinstance(a, dict) else a for a in alts]
        lens = [len(t) for t in textos if t]
        if lens and max(lens) > 0:
            ratio = min(lens) / max(lens)
            if ratio < 0.05:  # uma alternativa absurdamente menor que as outras
                erros.append("alternativas com comprimento muito discrepante — possível extração errada")

        # Conteudo vazio quando deveria haver texto (questão tem comando mas sem contexto)
        conteudo = q.get("conteudo", [])
        has_text_in_content = any(
            b.get("tipo") == "texto" and b.get("valor", "").strip()
            for b in conteudo
            if isinstance(b, dict)
        )
        if not has_text_in_content and not conteudo and not comando:
            erros.append("questão sem conteúdo e sem comando — possivelmente extração incompleta")

        if erros:
            problemas[num] = erros

    return problemas


def revisar_com_claude(img_pil, questoes_com_problema: list[dict],
                       problemas: dict[str, list[str]]) -> list[dict]:
    """
    Usa Claude claude-sonnet-4-6 para revisar questões com anomalias detectadas.
    Retorna lista de questões corrigidas (só as problemáticas são reprocessadas).
    """
    if not _ANTHROPIC_OK:
        log("Anthropic SDK não instalado — revisão Claude indisponível (pip install anthropic)", "warn")
        return questoes_com_problema

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        log("ANTHROPIC_API_KEY não configurada — revisão Claude indisponível", "warn")
        return questoes_com_problema

    img_b64 = imagem_para_base64(img_pil)
    client  = _AnthropicClient(api_key=anthropic_key)

    problemas_str = "\n".join(
        f"Q{num}: " + "; ".join(errs)
        for num, errs in problemas.items()
    )
    json_str = json.dumps(questoes_com_problema, ensure_ascii=False, indent=2)

    try:
        resposta = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8192,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type":       "base64",
                            "media_type": "image/jpeg",
                            "data":       img_b64,
                        }
                    },
                    {
                        "type": "text",
                        "text": (
                            "Esta é uma página de prova do ENEM. O sistema automático extraiu as questões "
                            "abaixo, mas detectou os seguintes problemas:\n\n"
                            f"Problemas detectados:\n{problemas_str}\n\n"
                            f"JSON extraído:\n{json_str}\n\n"
                            "Por favor, analise a imagem e corrija APENAS os campos problemáticos. "
                            "Mantenha todos os outros campos inalterados. "
                            "Retorne SOMENTE o JSON corrigido no mesmo formato, sem explicações."
                        )
                    }
                ]
            }]
        )

        uso_claude = resposta.usage
        preco_claude = PRECOS["claude-sonnet-4-6"]
        custo_claude = (uso_claude.input_tokens * preco_claude["input"] +
                        uso_claude.output_tokens * preco_claude["output"]) / 1_000_000
        log(f"Tokens Claude revisor: {uso_claude.input_tokens} in + {uso_claude.output_tokens} out | ${custo_claude:.5f} (claude-sonnet-4-6)", "info")

        texto = resposta.content[0].text.strip()
        # Limpar markdown se Claude envolver em ```json ... ```
        if texto.startswith("```"):
            texto = texto.split("```")[1]
            if texto.startswith("json"):
                texto = texto[4:]
        corrigidas = json.loads(texto)
        if isinstance(corrigidas, dict) and "questoes" in corrigidas:
            corrigidas = corrigidas["questoes"]
        if isinstance(corrigidas, list):
            return corrigidas
        log("Resposta Claude em formato inesperado — usando extração original", "warn")

    except json.JSONDecodeError:
        preview_resp = texto[:200].replace("\n", " ") if "texto" in dir() else "(sem resposta)"
        log(f"Claude retornou JSON inválido — usando extração original. Resposta: «{preview_resp}»", "warn")
    except Exception as e:
        log(f"Erro na revisão Claude: {e}", "warn")

    return questoes_com_problema


def carregar_exemplos_correcao(max_exemplos: int = 6) -> str:
    """
    Lê as últimas correções manuais de correcoes.json e as formata como
    exemplos few-shot para injetar no prompt do GPT.
    Apenas campos de texto (command, alternatives) são usados — imagens são ignoradas.
    """
    caminho = Path(__file__).parent / "correcoes.json"
    if not caminho.exists():
        return ""
    try:
        historico = json.loads(caminho.read_text(encoding="utf-8"))
    except Exception:
        return ""
    if not historico:
        return ""

    exemplos = historico[-max_exemplos:]
    partes = ["\n\nExemplos de correções manuais (aprenda com estes padrões de erro):"]

    for ex in exemplos:
        campos = ex.get("campos_alterados", [])
        if not campos:
            continue
        orig = ex.get("original", {})
        corr = ex.get("corrigido", {})
        num  = ex.get("numero", "?")
        partes.append(f"\n— Q{num} (campos corrigidos: {', '.join(campos)}):")

        if "command" in campos:
            partes.append(f"  comando errado:   \"{orig.get('command', '')}\"")
            partes.append(f"  comando correto:  \"{corr.get('command', '')}\"")

        if "content" in campos:
            def _resumir_content(blocos):
                textos = [b.get("value", "") or b.get("caption", "") for b in blocos if isinstance(b, dict)]
                return " | ".join(t[:80] for t in textos if t)
            orig_content = _resumir_content(orig.get("content", []))
            corr_content = _resumir_content(corr.get("content", []))
            if orig_content != corr_content:
                partes.append(f"  conteúdo errado:  [{orig_content[:200]}]")
                partes.append(f"  conteúdo correto: [{corr_content[:200]}]")

        if "alternatives" in campos:
            orig_alts = orig.get("alternatives", [])
            corr_alts = corr.get("alternatives", [])
            for i, (oa, ca) in enumerate(zip(orig_alts, corr_alts)):
                ot = oa.get("text", "") if isinstance(oa, dict) else str(oa)
                ct = ca.get("text", "") if isinstance(ca, dict) else str(ca)
                if ot != ct:
                    letter = "ABCDE"[i] if i < 5 else str(i)
                    partes.append(f"  alternativa {letter} errada:  \"{ot[:120]}\"")
                    partes.append(f"  alternativa {letter} correta: \"{ct[:120]}\"")

    if len(partes) == 1:  # só o cabeçalho, nenhum exemplo útil
        return ""

    return "\n".join(partes)


def log(msg: str, nivel: str = "info"):
    prefixos = {"info": "  ->", "ok": "  [OK]", "warn": "  [!]", "erro": "  [X]", "titulo": "\n>>"}
    texto = f"{prefixos.get(nivel, '  ')} {msg}"
    try:
        print(texto, flush=True)
    except UnicodeEncodeError:
        print(texto.encode("ascii", errors="replace").decode("ascii"), flush=True)


# ─── Chamadas à API ───────────────────────────────────────────────────────────

def _chamar_gpt_texto(client: OpenAI, texto: str, num_pagina: int, modelo: str) -> tuple[dict, dict]:
    """Envia texto extraído do PDF — muito mais barato que visão."""
    prompt = PROMPT_SISTEMA + carregar_exemplos_correcao()
    resposta = client.chat.completions.create(
        model=modelo,
        max_tokens=4096,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"Texto extraído da página {num_pagina} da prova:\n\n{texto}\n\nExtraia todas as questões."}
        ]
    )
    uso = {
        "modelo": modelo,
        "input":  resposta.usage.prompt_tokens,
        "output": resposta.usage.completion_tokens,
    }
    return json.loads(resposta.choices[0].message.content), uso


def _chamar_gpt_imagem(client: OpenAI, img_b64: str, num_pagina: int, modelo: str) -> tuple[dict, dict]:
    """Fallback: envia imagem da página (PDFs escaneados)."""
    prompt = PROMPT_SISTEMA + carregar_exemplos_correcao()
    resposta = client.chat.completions.create(
        model=modelo,
        max_tokens=4096,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{img_b64}",
                            "detail": "auto"
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
        "modelo": modelo,
        "input":  resposta.usage.prompt_tokens,
        "output": resposta.usage.completion_tokens,
    }
    return json.loads(resposta.choices[0].message.content), uso


def _chamar_gpt_hibrido(client: OpenAI, texto: str, img_b64: str, num_pagina: int, modelo: str) -> tuple[dict, dict]:
    """Modo híbrido: envia imagem da página + texto extraído. Melhor qualidade para PDFs com layout complexo."""
    prompt = PROMPT_SISTEMA + carregar_exemplos_correcao()
    resposta = client.chat.completions.create(
        model=modelo,
        max_tokens=4096,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": prompt},
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
                        "text": (
                            f"Esta é a página {num_pagina} da prova.\n\n"
                            f"Texto extraído automaticamente (use para garantir acurácia dos caracteres):\n"
                            f"---\n{texto}\n---\n\n"
                            "Extraia todas as questões visíveis. Use a imagem para entender o layout e "
                            "o texto para transcrever com precisão."
                        )
                    }
                ]
            }
        ]
    )
    uso = {
        "modelo": modelo,
        "input":  resposta.usage.prompt_tokens,
        "output": resposta.usage.completion_tokens,
    }
    return json.loads(resposta.choices[0].message.content), uso


def processar_pagina(client: OpenAI, conteudo, num_pagina: int, modo: str = "texto",
                     texto_extra: str = "") -> tuple[list[dict], list[dict]]:
    """
    modo="texto":   conteudo é uma string de texto extraído
    modo="imagem":  conteudo é uma PIL Image
    modo="hibrido": conteudo é uma PIL Image; texto_extra é o texto extraído do fitz
    """
    # No modo híbrido usamos gpt-4o por padrão (melhor visão)
    modelo_base = MODELO_FALLBACK if modo == "hibrido" else MODELO_PRIMARIO
    usos = []

    for tentativa in range(1, MAX_TENTATIVAS + 1):
        modelo = MODELO_FALLBACK if tentativa > 1 else modelo_base
        if tentativa > 1:
            log(f"Tentativa {tentativa} com {modelo}...", "warn")

        try:
            if modo == "texto":
                resultado, uso = _chamar_gpt_texto(client, conteudo, num_pagina, modelo)
            elif modo == "hibrido":
                img_b64 = imagem_para_base64(conteudo)
                resultado, uso = _chamar_gpt_hibrido(client, texto_extra, img_b64, num_pagina, modelo)
            else:
                img_b64 = imagem_para_base64(conteudo)
                resultado, uso = _chamar_gpt_imagem(client, img_b64, num_pagina, modelo)

            usos.append(uso)

            preco = PRECOS.get(modelo, {"input": 0, "output": 0})
            custo = (uso["input"] * preco["input"] + uso["output"] * preco["output"]) / 1_000_000
            log(f"Tokens p.{num_pagina}: {uso['input']} in + {uso['output']} out | ${custo:.5f} ({modelo}) [{modo}]", "info")

            questoes = resultado.get("questoes", [])
            if not isinstance(questoes, list):
                raise ValueError("Resposta não contém lista de questões")

            log(f"GPT retornou {len(questoes)} questão(ões) bruta(s)", "info")
            validas = []
            for q in questoes:
                if validar_questao(q):
                    validas.append(q)
                else:
                    motivo = []
                    if not q.get("numero"):
                        motivo.append("sem número")
                    alts = q.get("alternativas", [])
                    if not isinstance(alts, list) or len(alts) != 5:
                        n_alts = len(alts) if isinstance(alts, list) else "inválido"
                        motivo.append(f"alternativas={n_alts}")
                        if isinstance(alts, list) and alts:
                            preview_alts = " | ".join(str(a)[:40] for a in alts[:3])
                            log(f"  Q{q.get('numero','?')} rejeitada: {', '.join(motivo)} — conteúdo: [{preview_alts}]", "warn")
                        else:
                            log(f"  Q{q.get('numero','?')} rejeitada: {', '.join(motivo) or 'inválida'} — GPT não extraiu alternativas (possível questão com alternativas em imagem ou texto não chegou completo)", "warn")
                    else:
                        log(f"  Q{q.get('numero','?')} rejeitada: {', '.join(motivo) or 'inválida'}", "warn")

            if not validas and questoes:
                log("Todas as questões são inválidas, retentando...", "warn")
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


# ─── Gabarito ─────────────────────────────────────────────────────────────────

def _visao_gabarito(pdf_path: str, caderno: str) -> dict[str, str]:
    """
    Extrai gabarito de PDF via GPT Vision, processando todas as páginas.
    Entende o formato ENEM: Linguagens tem colunas INGLÊS/ESPANHOL (Q1-5 diferentes),
    Ciências Humanas tem coluna única. Retorna chaves como "6", "46", "1-en", "1-es".
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        log("OPENAI_API_KEY não configurada — gabarito por visão indisponível", "warn")
        return {}
    try:
        doc = fitz.open(pdf_path)
        num_paginas = len(doc)
        client_gab = OpenAI(api_key=api_key)
        resultado = {}

        for idx in range(num_paginas):
            pagina_img = _renderizar_pagina_fitz(doc[idx])
            img_b64 = imagem_para_base64(pagina_img)
            resposta = client_gab.chat.completions.create(
                model=MODELO_PRIMARIO,
                max_tokens=2048,
                response_format={"type": "json_object"},
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{img_b64}", "detail": "high"}
                        },
                        {
                            "type": "text",
                            "text": (
                                f"Esta imagem é um gabarito do ENEM (página {idx + 1} de {num_paginas}), caderno {caderno}.\n"
                                "Regras de extração:\n"
                                "1. Tabela de LINGUAGENS: tem subcoluna INGLÊS e ESPANHOL.\n"
                                "   - Para questões onde as respostas INGLÊS e ESPANHOL são IGUAIS: use chave '\"N\"' (ex: '\"6\"': 'C').\n"
                                "   - Para questões onde são DIFERENTES (normalmente Q1-5): use chaves '\"N-en\"' e '\"N-es\"' separadas.\n"
                                "2. Tabela de CIÊNCIAS HUMANAS ou qualquer outra com coluna única: use chave '\"N\"'.\n"
                                "3. Se a página não contiver gabarito, retorne objeto vazio.\n"
                                "Retorne APENAS JSON no formato:\n"
                                "{\"gabarito\": {\"1-en\": \"A\", \"1-es\": \"A\", \"2-en\": \"A\", \"2-es\": \"C\", \"6\": \"C\", \"46\": \"D\", ...}}"
                            )
                        }
                    ]
                }]
            )
            dados = json.loads(resposta.choices[0].message.content)
            gab_pagina = dados.get("gabarito", {})
            if isinstance(gab_pagina, dict):
                for chave, letra in gab_pagina.items():
                    letra = str(letra).upper()
                    if letra in LETRAS:
                        resultado[str(chave)] = letra
            elif isinstance(gab_pagina, list):
                # fallback: lista de pares [num, letra]
                for par in gab_pagina:
                    if len(par) == 2:
                        num = str(par[0]).lstrip("0") or "0"
                        letra = str(par[1]).upper()
                        if letra in LETRAS:
                            resultado[num] = letra

        doc.close()
        return resultado
    except Exception as e:
        log(f"Erro ao extrair gabarito por visão: {e}", "warn")
        return {}


def _parsear_texto_gabarito(texto: str, caderno: str) -> dict[str, str]:
    """
    Tenta parsear texto extraído de gabarito (TXT ou PDF digital).
    Formato ENEM: Linguagens tem 3 colunas (QUESTÃO | INGLÊS | ESPANHOL),
    Ciências Humanas tem 2 colunas (QUESTÃO | GABARITO).
    Retorna chaves "N", "N-en", "N-es".
    """
    gabarito = {}

    # Modo atual da tabela: None, "linguagens" ou "simples"
    modo = None
    linhas = texto.splitlines()

    for linha in linhas:
        linha = linha.strip()
        if not linha:
            continue

        linha_upper = linha.upper()

        # Detectar cabeçalho da tabela de Linguagens (tem INGLÊS e ESPANHOL)
        if "INGL" in linha_upper and "ESPANH" in linha_upper:
            modo = "linguagens"
            continue

        # Detectar cabeçalho de tabela simples (GABARITO sem subdivisão)
        if "GABARITO" in linha_upper and "INGL" not in linha_upper:
            modo = "simples"
            continue

        # Ignorar linhas de cabeçalho de área (LINGUAGENS, CIÊNCIAS, etc.)
        if any(k in linha_upper for k in ("LINGUAGENS", "CIÊNCIAS", "HUMANIDADES", "MATEMÁTICA", "NATUREZA", "QUESTÃO")):
            continue

        partes = linha.replace(":", " ").replace(",", " ").split()
        if len(partes) < 2:
            continue

        # Primeiro token deve ser número
        token0 = partes[0].lstrip("0")
        if not token0.isdigit():
            continue

        num = token0 or "0"

        if modo == "linguagens" and len(partes) >= 3:
            # 3 colunas: num, ingles, espanhol
            letra_en = partes[1].upper()
            letra_es = partes[2].upper()
            if letra_en in LETRAS and letra_es in LETRAS:
                if letra_en == letra_es:
                    gabarito[num] = letra_en  # mesma resposta, chave simples
                else:
                    gabarito[f"{num}-en"] = letra_en
                    gabarito[f"{num}-es"] = letra_es
        elif len(partes) >= 2:
            # 2 colunas: num, letra
            letra = partes[1].upper()
            if letra in LETRAS:
                gabarito[num] = letra

    return gabarito


def carregar_gabarito(caminho: str, caderno: str = "Azul") -> dict[str, str]:
    gabarito = {}
    if not caminho or not Path(caminho).exists():
        return gabarito

    eh_pdf = caminho.lower().endswith(".pdf")

    if eh_pdf:
        doc  = fitz.open(caminho)
        texto = "\n".join(p.get_text() for p in doc)
        doc.close()
    else:
        texto = Path(caminho).read_text(encoding="utf-8")

    # 1. Tentar parsear o texto (funciona para TXT e PDFs digitais bem formatados)
    if texto.strip():
        gabarito = _parsear_texto_gabarito(texto, caderno)

    # 2. Se texto falhou e é PDF → visão como fallback
    if not gabarito and eh_pdf:
        log(f"Gabarito — texto não parseável, usando visão (caderno {caderno})...", "info")
        gabarito = _visao_gabarito(caminho, caderno)

    if gabarito:
        amostra = list(gabarito.items())[:5]
        log(f"Gabarito carregado: {len(gabarito)} respostas. Amostra: {amostra}", "ok")
    else:
        log("Gabarito carregado: 0 respostas — verifique o formato do arquivo", "warn")
    return gabarito


# ─── Montar JSON ──────────────────────────────────────────────────────────────

_PLACEHOLDERS = {
    "string vazia se não houver",
    "texto de apoio",
    "fonte ou legenda",
    "última frase antes das alternativas",
    "a pergunta em si",
}

def _limpar(texto: str) -> str:
    if not texto:
        return ""
    if any(p in texto.lower() for p in _PLACEHOLDERS):
        return ""
    return texto


def _montar_content(q: dict) -> list[dict]:
    """
    Constrói o array content a partir dos blocos do GPT.
    Suporta o novo formato (conteudo[]) e o formato legado (enunciado + tem_imagem).
    """
    # Novo formato: array de blocos
    if "conteudo" in q and isinstance(q["conteudo"], list):
        content = []
        for bloco in q["conteudo"]:
            tipo = bloco.get("tipo", "")
            if tipo == "texto":
                valor = _limpar(bloco.get("valor", ""))
                if valor:
                    content.append({"type": "text", "value": valor})
            elif tipo == "imagem":
                content.append({
                    "type":      "image",
                    "data":      None,
                    "caption":   _limpar(bloco.get("legenda", "")),
                    "has_image": bool(bloco.get("tem_imagem", True)),
                })
        return content

    # Fallback: formato legado (enunciado + tem_imagem)
    content = []
    enunciado = _limpar(q.get("enunciado", ""))
    if enunciado:
        content.append({"type": "text", "value": enunciado})
    if q.get("tem_imagem") or q.get("legenda_imagem"):
        content.append({
            "type":      "image",
            "data":      None,
            "caption":   _limpar(q.get("legenda_imagem", "")),
            "has_image": bool(q.get("tem_imagem", False)),
        })
    return content


def montar_json(questoes_por_pagina: list[tuple[int, list[dict]]],
                gabarito: dict[str, str],
                ano: int, dia: int, caderno: str) -> list[dict]:
    resultado = []

    for _num_pag, questoes in questoes_por_pagina:
        for q in questoes:
            numero_base = str(q.get("numero", "")).lstrip("0") or "0"
            # Q1-Q5 aparecem duas vezes no caderno (inglês e espanhol) — adicionar sufixo
            area = q.get("area", "")
            if area == "ingles":
                numero = f"{numero_base}-en"
            elif area == "espanhol":
                numero = f"{numero_base}-es"
            else:
                numero = numero_base
            # Busca gabarito: tenta chave com sufixo de idioma, depois chave simples
            letra_correta = gabarito.get(numero) or gabarito.get(numero_base, "")
            correct = LETRAS.get(letra_correta)  # None quando sem gabarito

            content = _montar_content(q)
            command = _limpar(q.get("comando", ""))
            needs_review = False

            # Pós-processamento: se command vier vazio e o último bloco de content for texto,
            # move automaticamente para command (padrão de erro mais comum do GPT em modo imagem)
            if not command and content and content[-1].get("type") == "text":
                command = content[-1].get("value", "").strip()
                content = content[:-1]
                needs_review = True  # auto-corrigido, usuário deve conferir
                log(f"  Q{numero}: comando movido do content -> command | marcada para revisao", "warn")
            elif not command:
                needs_review = True  # command vazio sem texto para mover
                log(f"  Q{numero}: command vazio -> marcada para revisao", "warn")

            resultado.append({
                "exam":            f"ENEM {ano} – {dia}º Dia – Caderno {caderno}",
                "number":          q.get("numero", ""),
                "area":            q.get("area", ""),
                "content":         content,
                "command":         command,
                "alternatives":    [{"text": a, "image": None} for a in q.get("alternativas", ["", "", "", "", ""])],
                "correct":         correct,
                "needs_review":    needs_review,
                # Classificação taxonômica (preenchida em passo separado)
                "disciplina":      None,
                "topic":           None,
                "subtopic":        None,
                "skills":          [],
                "cognitive_level": None,
                "difficulty":      None,
            })

    resultado.sort(key=lambda q: int(q["number"]) if str(q["number"]).isdigit() else 0)

    if gabarito:
        acertos = sum(1 for q in resultado if q.get("correct") is not None)
        sem = len(resultado) - acertos
        log(f"Gabarito aplicado: {acertos}/{len(resultado)} questões com resposta correta identificada", "ok")
        if sem:
            nums_sem = [q["number"] for q in resultado if q.get("correct") is None]
            log(f"  Sem gabarito: questoes {nums_sem[:10]}{'...' if len(nums_sem) > 10 else ''}", "warn")

    return resultado


# ─── Classificação taxonômica ─────────────────────────────────────────────────

def classificar_questoes(questoes: list[dict], client: OpenAI,
                         batch_size: int = 8) -> tuple[list[dict], dict]:
    """
    Classifica questões com disciplina, tópico, skills e nível cognitivo.
    Retorna (questoes_atualizadas, uso_tokens).
    """
    idx_por_numero = {q["number"]: i for i, q in enumerate(questoes)}
    total_input = total_output = 0

    n_lotes = (len(questoes) + batch_size - 1) // batch_size
    log(f"Classificando {len(questoes)} questões em {n_lotes} lote(s)...", "titulo")

    for inicio in range(0, len(questoes), batch_size):
        lote = questoes[inicio : inicio + batch_size]
        lote_num = inicio // batch_size + 1

        # Resumo de cada questão para o classificador (sem enviar texto de imagem)
        linhas = []
        for q in lote:
            alts = " | ".join(
                (t[:60] + "…" if len(t) > 60 else t)
                for a in q["alternatives"]
                for t in [a["text"] if isinstance(a, dict) else a]
            )
            linhas.append(
                f'Q{q["number"]} ({q["area"]}): {q["command"][:200]}\n'
                f'Alternativas: {alts}'
            )
        payload = "\n\n---\n".join(linhas)

        for tentativa in range(1, 3):
            modelo = MODELO_FALLBACK if tentativa > 1 else MODELO_PRIMARIO
            try:
                resposta = client.chat.completions.create(
                    model=modelo,
                    max_tokens=2048,
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": PROMPT_CLASSIFICADOR},
                        {"role": "user",   "content": f"Classifique estas {len(lote)} questões:\n\n{payload}"},
                    ]
                )
                total_input  += resposta.usage.prompt_tokens
                total_output += resposta.usage.completion_tokens

                resultado = json.loads(resposta.choices[0].message.content)
                for c in resultado.get("classificacoes", []):
                    num = str(c.get("numero", ""))
                    idx = idx_por_numero.get(num)
                    if idx is not None:
                        questoes[idx].update({
                            "disciplina":      c.get("disciplina"),
                            "topic":           c.get("topic"),
                            "subtopic":        c.get("subtopic"),
                            "skills":          c.get("skills", []),
                            "cognitive_level": c.get("cognitive_level"),
                            "difficulty":      c.get("difficulty"),
                        })

                log(f"Lote {lote_num}/{n_lotes} classificado", "ok")
                break

            except Exception as e:
                log(f"Classificação lote {lote_num} tentativa {tentativa}: {e}", "warn")
                if tentativa == 2:
                    log(f"Lote {lote_num} não classificado", "erro")

    preco = PRECOS.get(MODELO_PRIMARIO, {"input": 0, "output": 0})
    custo = (total_input * preco["input"] + total_output * preco["output"]) / 1_000_000
    log(f"Classificação — Tokens: {total_input + total_output:,} | ${custo:.4f}", "info")

    uso = {"input": total_input, "output": total_output, "custo": round(custo, 6)}
    return questoes, uso


# ─── Pipeline principal ───────────────────────────────────────────────────────

def processar_prova(pdf_path: str, ano: int, dia: int, caderno: str,
                    gabarito_path: str = None, poppler_path: str = None,
                    partial_cb=None, modo_extracao: str = None):

    saida = f"questoes_{ano}_dia{dia}_{caderno.lower()}.json"
    log(f"ENEM {ano} – Dia {dia} – Caderno {caderno}", "titulo")

    # 1. Abrir PDF com fitz e verificar se tem texto extraível
    doc = fitz.open(pdf_path)
    n_paginas = len(doc)
    log(f"{n_paginas} páginas encontradas", "ok")

    # Amostrar algumas páginas do meio para checar tipo do PDF
    amostras = [doc[i].get_text() for i in range(1, min(4, n_paginas))]
    tem_texto_bruto = any(len(t.strip()) >= MIN_CHARS_TEXTO for t in amostras)
    texto_legivel   = any(len(t.strip()) >= MIN_CHARS_TEXTO and _texto_legivel(t) for t in amostras)

    # Determinar modo de extração (parâmetro sobrescreve a constante global)
    _modo_cfg = modo_extracao or MODO_EXTRACAO
    if _modo_cfg == "hibrido":
        log("Modo híbrido (imagem + texto) ativado — usando gpt-4o para melhor qualidade", "ok")
        modo = "hibrido"
    elif _modo_cfg == "imagem":
        log("Modo imagem forçado", "warn")
        modo = "imagem"
        if not _PDF2IMAGE_OK:
            raise RuntimeError("pdf2image não instalado. Execute: pip install pdf2image pillow")
    elif texto_legivel:
        log("PDF digital detectado — usando extração de texto (modo econômico)", "ok")
        modo = "texto"
    elif tem_texto_bruto:
        # Tem texto mas com encoding não-padrão — fitz rendering por página como fallback
        log("PDF com encoding não-padrão — usando renderização por página via fitz", "warn")
        modo = "texto"
    else:
        log("PDF escaneado detectado — usando visão (modo imagem)", "warn")
        modo = "imagem"
        if not _PDF2IMAGE_OK:
            raise RuntimeError("pdf2image não instalado. Execute: pip install pdf2image pillow")

    # Pular capa (1ª pág) e contra-capa (última pág)
    indices_proc = list(range(1, n_paginas - 1)) if n_paginas > 2 else list(range(n_paginas))
    log(f"Pulando capa e contra-capa — {len(indices_proc)} páginas para processar", "info")

    # 2. Carregar gabarito
    gabarito = carregar_gabarito(gabarito_path, caderno)

    # 3. Processar páginas
    modelo_log = MODELO_FALLBACK if modo == "hibrido" else MODELO_PRIMARIO
    log(f"Processando páginas com {modelo_log} (modo={modo})...", "titulo")
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY não definida. Configure em extrator/config.txt")

    client = OpenAI(api_key=api_key)

    # Para modo imagem puro: converter PDF em imagens antecipadamente via pdf2image
    paginas_img = None
    if modo == "imagem" and _PDF2IMAGE_OK:
        log("Convertendo PDF em imagens...", "info")
        kwargs = {"dpi": DPI}
        pp = poppler_path or POPPLER_PADRAO
        if pp and os.path.exists(pp):
            kwargs["poppler_path"] = pp
        todas_paginas = convert_from_path(pdf_path, **kwargs)
        paginas_img = [todas_paginas[i] for i in indices_proc if i < len(todas_paginas)]

    questoes_por_pagina = []
    total_input = 0
    total_output = 0
    custo_total = 0.0
    ultimo_numero_visto = 0  # para detecção de gaps entre páginas

    # Páginas que provavelmente são instruções (primeiras 2 do intervalo processado)
    PAGINAS_INSTRUCOES = 2

    for seq, idx_pagina in enumerate(indices_proc):
        log(f"Página {seq + 1}/{len(indices_proc)} (PDF pág. {idx_pagina + 1})...", "info")

        # ── Estágio 1: detectar layout da página ──────────────────────────────
        pagina_fitz = doc[idx_pagina]
        layout = detectar_layout(pagina_fitz)
        if layout["colunas"] == 2:
            log(f"Layout: 2 colunas detectadas", "info")
        if layout["imagens"]:
            log(f"Imagens na página: {len(layout['imagens'])}", "info")

        # ── Estágio 2: extrair texto estruturado ──────────────────────────────
        img_pag = None  # renderização da página (usada em modo híbrido e revisão)

        if modo in ("texto", "hibrido"):
            texto_pag = extrair_texto_ordenado(pagina_fitz, layout)
            n_chars   = len(texto_pag.strip())
            legivel   = _texto_legivel(texto_pag)

            import re as _re
            n_marcadores = len(_re.findall(r'\[[ABCDE]\] ', texto_pag))
            if n_marcadores:
                log(f"Texto extraído: {n_chars} chars | legível: {legivel} | marcadores [A]-[E]: {n_marcadores}", "info")
            else:
                log(f"Texto extraído: {n_chars} chars | legível: {legivel} | marcadores [A]-[E]: 0 — alternativas podem estar em imagem", "warn")

            if n_chars >= 50:
                preview = texto_pag.strip()[:150].replace("\n", " ")
                log(f"Preview: «{preview}»", "info")

            if n_chars < MIN_CHARS_TEXTO:
                if modo == "hibrido":
                    log(f"Texto insuficiente ({n_chars} chars) — modo híbrido usa só imagem", "warn")
                    img_pag = _renderizar_pagina_fitz(pagina_fitz)
                    questoes, usos = processar_pagina(client, img_pag, idx_pagina + 1, modo="imagem")
                else:
                    log(f"Texto insuficiente ({n_chars} < {MIN_CHARS_TEXTO} chars) — pulando", "warn")
                    continue

            elif modo == "hibrido":
                img_pag = _renderizar_pagina_fitz(pagina_fitz)
                questoes, usos = processar_pagina(client, img_pag, idx_pagina + 1,
                                                  modo="hibrido", texto_extra=texto_pag)
            elif not legivel:
                log("Encoding corrompido — usando renderização fitz como fallback", "warn")
                img_pag = _renderizar_pagina_fitz(pagina_fitz)
                questoes, usos = processar_pagina(client, img_pag, idx_pagina + 1, modo="imagem")
            else:
                questoes, usos = processar_pagina(client, texto_pag, idx_pagina + 1, modo="texto")
        else:
            img_pag = paginas_img[seq]
            colunas = _detectar_e_dividir_colunas(img_pag)
            if len(colunas) == 2:
                log("Layout 2 colunas detectado — processando coluna por coluna", "info")
                questoes, usos = [], []
                for i, col in enumerate(colunas):
                    nome_col = "esquerda" if i == 0 else "direita"
                    log(f"Coluna {nome_col}...", "info")
                    q_col, u_col = processar_pagina(client, col, idx_pagina + 1, modo="imagem")
                    questoes.extend(q_col)
                    usos.extend(u_col)
            else:
                questoes, usos = processar_pagina(client, img_pag, idx_pagina + 1, modo="imagem")

        for uso in usos:
            preco = PRECOS.get(uso["modelo"], {"input": 0, "output": 0})
            total_input  += uso["input"]
            total_output += uso["output"]
            custo_total  += (uso["input"] * preco["input"] + uso["output"] * preco["output"]) / 1_000_000

        # ── Estágio 4: validador de anomalias ─────────────────────────────────
        if questoes:
            anomalias = detectar_anomalias(questoes)
            if anomalias:
                log(f"Anomalias detectadas em {len(anomalias)} questão(ões) — acionando revisor Claude", "warn")
                for num, erros in anomalias.items():
                    for e in erros:
                        log(f"  Q{num}: {e}", "warn")

                # ── Estágio 5: revisor Claude (só páginas com problemas) ───────
                if img_pag is None:
                    img_pag = _renderizar_pagina_fitz(pagina_fitz)
                questoes = revisar_com_claude(img_pag, questoes, anomalias)
                log("Revisão Claude concluída", "ok")

        if questoes:
            nums = [q.get("numero", "?") for q in questoes]
            log(f"{len(questoes)} questão(ões) extraída(s): Q{', Q'.join(str(n) for n in nums)}", "ok")

            # Detecção de gaps: compara com o último número visto
            nums_int = sorted([int(n) for n in nums if str(n).isdigit()])
            if nums_int:
                if ultimo_numero_visto > 0:
                    primeiro = nums_int[0]
                    if primeiro > ultimo_numero_visto + 1:
                        perdidas = list(range(ultimo_numero_visto + 1, primeiro))
                        log(f"Gap detectado: Q{perdidas[0]}-Q{perdidas[-1]} não encontradas (entre Q{ultimo_numero_visto} e Q{primeiro})", "warn")
                ultimo_numero_visto = max(nums_int)

            questoes_por_pagina.append((seq, questoes))
        elif seq < PAGINAS_INSTRUCOES:
            log("Sem questões — provavelmente página de instruções (esperado)", "info")
        else:
            log("Nenhuma questão extraída nesta página", "warn")

        # Enviar atualização parcial ao frontend após cada página
        if partial_cb and questoes_por_pagina:
            parcial = montar_json(questoes_por_pagina, gabarito, ano, dia, caderno)
            partial_cb(parcial)

        # Salvar progresso em disco a cada 5 páginas
        if (seq + 1) % 5 == 0 and questoes_por_pagina:
            parcial = montar_json(questoes_por_pagina, gabarito, ano, dia, caderno)
            Path(saida + ".parcial.json").write_text(
                json.dumps(parcial, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            log(f"Progresso salvo ({len(parcial)} questões até agora)", "ok")

    doc.close()

    # 4. Resultado final (extração)
    questoes_finais = montar_json(questoes_por_pagina, gabarito, ano, dia, caderno)
    Path(saida + ".parcial.json").unlink(missing_ok=True)

    log(f"Extração concluída! {len(questoes_finais)} questões", "titulo")
    log(f"Tokens extração — Input: {total_input:,} | Output: {total_output:,} | Total: {total_input + total_output:,}", "info")
    log(f"Custo extração: ${custo_total:.4f} USD", "ok")

    sem_gabarito = sum(1 for q in questoes_finais if q.get("correct") is None)
    if sem_gabarito and gabarito:
        log(f"{sem_gabarito} questão(ões) sem gabarito", "warn")

    # 5. Classificação taxonômica
    questoes_finais, uso_class = classificar_questoes(questoes_finais, client)

    custo_total += uso_class["custo"]
    total_input  += uso_class["input"]
    total_output += uso_class["output"]

    Path(saida).write_text(
        json.dumps(questoes_finais, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    log(f"Custo total (extração + classificação): ${custo_total:.4f} USD", "ok")

    relatorio = {
        "total_input":  total_input,
        "total_output": total_output,
        "custo_total":  round(custo_total, 6),
        "n_questoes":   len(questoes_finais),
        "modo":         modo,
    }
    return questoes_finais, relatorio


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extrator de questões do ENEM — PDF → JSON")
    parser.add_argument("--pdf",      required=True,               help="Caminho para o PDF da prova")
    parser.add_argument("--ano",      required=True,  type=int,    help="Ano da prova (ex: 2020)")
    parser.add_argument("--dia",      required=True,  type=int, choices=[1, 2])
    parser.add_argument("--caderno",  required=True,               help="Cor do caderno (ex: Azul)")
    parser.add_argument("--gabarito", default=None,                help="Gabarito em .txt ou .pdf")
    parser.add_argument("--poppler",  default=None,                help="Caminho do Poppler (Windows)")
    parser.add_argument("--modo",     default=None, choices=["texto", "imagem", "hibrido"],
                        help="Modo de extração: texto (padrão), imagem (PDFs escaneados), hibrido (melhor qualidade, gpt-4o)")
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
        modo_extracao=args.modo,
    )
