import { useState, useRef, useCallback, useEffect } from 'react'
import './index.css'
import QuestionEditor from './components/QuestionEditor'
import QuestionPreview from './components/QuestionPreview'
import QuestionListModal from './components/QuestionListModal'
import PDFImporter from './components/PDFImporter'
import PdfAnnotatorModal from './components/PdfAnnotatorModal'
import { publicarQuestao } from './lib/publishToAtlas'

const EMPTY_ALT = () => ({ text: '', image: null })

const DEFAULT_QUESTION = {
  exam: 'ENEM 2020 – 1º Dia – Caderno Azul',
  number: '1',
  content: [],
  command: '',
  alternatives: [EMPTY_ALT(), EMPTY_ALT(), EMPTY_ALT(), EMPTY_ALT(), EMPTY_ALT()],
  correct: 0,
  needs_review: false,
  foreign_language: '',
}

function migrateQuestion(q) {
  if (q.content && q.alternatives?.[0] && typeof q.alternatives[0] === 'object') return q  // já no novo formato
  const content = q.content || []
  if (!q.content) {
    if (q.statement) content.push({ type: 'text', value: q.statement })
    if (q.image || q.has_image) content.push({ type: 'image', data: q.image || null, caption: q.imageCaption || '', has_image: !!q.has_image })
  }
  // Migrar alternativas de string[] para {text, image}[]
  const alternatives = (q.alternatives || []).map(a =>
    typeof a === 'string' ? { text: a, image: null } : a
  )
  const { statement, image, imageCaption, has_image, ...rest } = q
  return { ...rest, content, alternatives }
}

function sortByNumber(qs) {
  return [...qs].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0))
}

function makeNewQuestion(questions) {
  const maxNum = questions.reduce((max, q) => Math.max(max, Number(q.number) || 0), 0)
  return { ...DEFAULT_QUESTION, number: String(maxNum + 1) }
}

const BACKEND = 'http://localhost:8000'

// Retorna quais campos de texto foram alterados entre original e atual
function camposAlterados(original, atual) {
  const campos = []
  if (original.command !== atual.command) campos.push('command')
  const origAlts = original.alternatives || []
  const atualAlts = atual.alternatives || []
  const altsChanged = origAlts.some((a, i) => {
    const ot = typeof a === 'string' ? a : a?.text ?? ''
    const ct = typeof atualAlts[i] === 'string' ? atualAlts[i] : atualAlts[i]?.text ?? ''
    return ot !== ct
  })
  if (altsChanged) campos.push('alternatives')
  const origContent = JSON.stringify((original.content || []).map(b => ({ tipo: b.type, valor: b.value })))
  const atualContent = JSON.stringify((atual.content || []).map(b => ({ tipo: b.type, valor: b.value })))
  if (origContent !== atualContent) campos.push('content')
  return campos
}

// Remove base64 de imagens para não inflar correcoes.json
function stripImages(question) {
  return {
    ...question,
    content: (question.content || []).map(b =>
      b.type === 'image' ? { ...b, data: null } : b
    ),
    alternatives: (question.alternatives || []).map(a =>
      typeof a === 'object' && a !== null ? { ...a, image: null } : a
    ),
  }
}

const DRAFT_KEY = 'editor_rascunho'

function carregarRascunho() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export default function App() {
  const [questions, setQuestions] = useState(() => {
    const draft = carregarRascunho()
    if (draft?.questions?.length) return draft.questions.map(migrateQuestion)
    return [DEFAULT_QUESTION]
  })
  const [currentIndex, setCurrentIndex] = useState(() => {
    const draft = carregarRascunho()
    return draft?.currentIndex || 0
  })
  const [activeTab, setActiveTab]         = useState('editor')
  const [showPDFImporter, setShowPDFImporter] = useState(false)
  const [showQuestionList, setShowQuestionList] = useState(false)
  const [annotatorFile, setAnnotatorFile] = useState(null)
  // originals: snapshot imutável de cada questão extraída do PDF (null = sem PDF importado)
  const [originals, setOriginals]         = useState(null)
  const [correcaoEnviada, setCorrecaoEnviada] = useState(false)
  const [publishState, setPublishState]   = useState('idle') // 'idle' | 'loading' | 'success' | 'error'
  const [publishError, setPublishError]   = useState('')
  const [batchState, setBatchState]       = useState('idle') // 'idle' | 'loading' | 'done'
  const [batchResult, setBatchResult]     = useState(null)   // { ok, erros }
  const [showBatchModal, setShowBatchModal] = useState(false)
  const importRef        = useRef(null)
  const annotatorInputRef = useRef(null)
  const gabaritoInputRef  = useRef(null)

  // Auto-save no localStorage — tenta com imagens, cai sem imagens se estourar o limite
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ questions, currentIndex }))
    } catch {
      // Imagens encheram o localStorage — salva sem elas
      try {
        const draft = { questions: questions.map(stripImages), currentIndex }
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
      } catch {
        // Ainda cheio — ignora
      }
    }
  }, [questions, currentIndex])

  function limparRascunho() {
    if (!window.confirm('Deseja descartar o rascunho e começar do zero?')) return
    localStorage.removeItem(DRAFT_KEY)
    setQuestions([DEFAULT_QUESTION])
    setCurrentIndex(0)
    setOriginals(null)
    setCorrecaoEnviada(false)
  }

  const question = questions[currentIndex]

  function updateQuestion(updated) {
    const numberChanged = questions[currentIndex]?.number !== updated.number
    if (numberChanged) {
      const updatedList = questions.map((q, i) => i === currentIndex ? updated : q)
      const sorted = sortByNumber(updatedList)
      const newIdx = sorted.findIndex(q => q.number === updated.number)
      setQuestions(sorted)
      setCurrentIndex(newIdx >= 0 ? newIdx : currentIndex)
    } else {
      setQuestions(prev => prev.map((q, i) => i === currentIndex ? updated : q))
    }
    setCorrecaoEnviada(false)
  }

  function toggleReview() {
    setQuestions(prev => prev.map((q, i) =>
      i === currentIndex ? { ...q, needs_review: !q.needs_review } : q
    ))
  }

  const original = originals?.[currentIndex] ?? null
  const mudancas = original ? camposAlterados(original, question) : []
  const temMudancas = mudancas.length > 0

  const enviarCorrecao = useCallback(async () => {
    if (!original || !temMudancas) return
    try {
      await fetch(`${BACKEND}/correcao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numero: String(question.number),
          original: stripImages(original),
          corrigido: stripImages(question),
          campos_alterados: mudancas,
        }),
      })
      // Atualizar o original para o estado atual (próxima edição gera nova correção)
      setOriginals(prev => prev.map((o, i) => i === currentIndex ? stripImages(question) : o))
      setCorrecaoEnviada(true)
    } catch (err) {
      alert('Erro ao enviar correção: ' + err.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original, question, mudancas, currentIndex])

  function handlePDFImport(questoes) {
    setQuestions(questoes)
    setCurrentIndex(0)
    // Guardar snapshot dos originais extraídos (sem imagens base64 para economizar memória)
    setOriginals(questoes.map(stripImages))
    setCorrecaoEnviada(false)
  }

  function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        const list = (Array.isArray(data) ? data : [data]).map(migrateQuestion)
        setQuestions(list)
        setCurrentIndex(0)
      } catch {
        alert('Arquivo JSON inválido.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const ALT_ROLES = { A: 0, B: 1, C: 2, D: 3, E: 4 }

  function handleAnnotatorSave(images) {
    setQuestions(prev => {
      const updated = [...prev]
      for (const img of images) {
        const idx = updated.findIndex(q => String(q.number) === String(img.questionNumber))
        if (idx === -1) continue
        const q = updated[idx]

        if (img.role === 'stem') {
          // Imagem do enunciado → primeiro bloco de imagem vazio ou novo bloco
          const content = [...(q.content || [])]
          const emptyImgIdx = content.findIndex(b => b.type === 'image' && !b.data)
          if (emptyImgIdx !== -1) {
            content[emptyImgIdx] = { ...content[emptyImgIdx], data: img.dataUrl }
          } else {
            content.push({ type: 'image', data: img.dataUrl, caption: '', has_image: true })
          }
          updated[idx] = { ...q, content }

        } else if (img.role in ALT_ROLES) {
          // Imagem de alternativa → atualiza o campo image da alternativa correspondente
          const altIdx = ALT_ROLES[img.role]
          const alternatives = [...(q.alternatives || [])]
          if (altIdx < alternatives.length) {
            alternatives[altIdx] = { ...alternatives[altIdx], image: img.dataUrl }
            updated[idx] = { ...q, alternatives }
          }
        }
      }
      return updated
    })
    setAnnotatorFile(null)
  }

  function handleAddQuestion() {
    const nova = makeNewQuestion(questions)
    const sorted = sortByNumber([...questions, nova])
    const newIdx = sorted.findIndex(q => q === nova)
    setQuestions(sorted)
    setCurrentIndex(newIdx >= 0 ? newIdx : sorted.length - 1)
    setShowQuestionList(false)
  }

  function isQuestionComplete(q) {
    const hasContent = !!(
      q.content?.some(b => (b.type === 'text' && b.value?.trim()) || (b.type === 'image' && b.data)) ||
      q.command?.trim()
    )
    const altFilled = a => typeof a === 'string' ? a.trim() : (a?.text?.trim() || a?.image)
    return hasContent && q.alternatives.length >= 2 && q.alternatives.every(altFilled)
  }

  async function handlePublish() {
    setPublishState('loading')
    setPublishError('')
    try {
      await publicarQuestao(question)
      setPublishState('success')
      setTimeout(() => setPublishState('idle'), 3000)
    } catch (err) {
      setPublishError(err.message)
      setPublishState('error')
    }
  }

  async function handlePublishAll() {
    const elegíveis = questions.filter(q => isQuestionComplete(q) && !q.needs_review)
    if (elegíveis.length === 0) {
      alert('Nenhuma questão elegível para publicação.\nVerifique se estão completas e sem "Marcar para revisão".')
      return
    }
    setBatchState('loading')
    setBatchResult(null)
    setShowBatchModal(true)
    let ok = 0
    const erros = []
    for (const q of elegíveis) {
      try {
        await publicarQuestao(q)
        ok++
      } catch (err) {
        erros.push({ number: q.number, msg: err.message })
      }
    }
    setBatchState('done')
    setBatchResult({ ok, erros, total: elegíveis.length })
  }

  const [classificandoState, setClassificandoState] = useState('idle') // 'idle' | 'loading'

  function disciplinaParaArea(disciplina) {
    if (!disciplina) return null
    const d = disciplina.toLowerCase()
    if (['historia', 'geografia', 'sociologia', 'filosofia'].includes(d)) return 'humanas'
    if (['quimica', 'fisica', 'biologia'].includes(d)) return 'natureza'
    if (['portugues', 'literatura', 'artes', 'ingles', 'espanhol'].includes(d)) return 'linguagens'
    if (d === 'matematica') return 'matematica'
    return null
  }

  async function handleClassificar() {
    const elegiveis = questions.filter(q => q.number && q.command && q.alternatives.length >= 2)
    if (elegiveis.length === 0) {
      alert('Nenhuma questão elegível para classificação.\nVerifique se possuem número, comando e ao menos 2 alternativas.')
      return
    }
    setClassificandoState('loading')
    try {
      const res = await fetch(`${BACKEND}/classificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questoes: elegiveis.map(q => ({
            number: q.number,
            area: q.area || 'matematica',
            command: [
              ...(q.content || []).filter(b => b.type === 'text' && b.value?.trim()).map(b => b.value.trim()),
              q.command?.trim(),
            ].filter(Boolean).join('\n\n'),
            alternatives: q.alternatives,
          })),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { classificacoes } = await res.json()
      setQuestions(prev => prev.map(q => {
        const cls = classificacoes[String(q.number)]
        if (!cls) return q
        const area = q.area || disciplinaParaArea(cls.disciplina)
        return { ...q, ...cls, area }
      }))
      alert(`${Object.keys(classificacoes).length} questões classificadas com sucesso!`)
    } catch (err) {
      alert(`Erro ao classificar: ${err.message}`)
    } finally {
      setClassificandoState('idle')
    }
  }

  async function handleCarregarGabarito(file) {
    if (!file) return
    // Detecta o caderno a partir do campo exam da primeira questão
    const examStr = questions[0]?.exam || ''
    const caderno = examStr.match(/azul|rosa|amarelo|branco|cinza/i)?.[0] || 'Azul'

    const form = new FormData()
    form.append('gabarito', file)
    form.append('caderno', caderno)

    try {
      const res = await fetch(`${BACKEND}/gabarito`, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { gabarito } = await res.json()

      const LETTERS = ['A', 'B', 'C', 'D', 'E']
      let preenchidas = 0

      setQuestions(prev => prev.map(q => {
        const num = String(parseInt(q.number) || 0)
        const lang = q.foreign_language || ''
        const chave = lang === 'ingles' ? `${num}-en` : lang === 'espanhol' ? `${num}-es` : num
        const letra = (gabarito[chave] || gabarito[num] || '').toUpperCase()
        const idx = LETTERS.indexOf(letra)
        if (idx === -1) return q
        preenchidas++
        return { ...q, correct: idx }
      }))

      alert(`Gabarito aplicado! ${preenchidas} questões atualizadas.`)
    } catch (err) {
      alert(`Erro ao carregar gabarito: ${err.message}`)
    }
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(questions, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'questoes.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-violet-50 to-slate-100 font-sans">

      {/* Modais */}
      {showPDFImporter && (
        <PDFImporter
          onImport={handlePDFImport}
          onPartialUpdate={(questoes) => { setQuestions(questoes); setCurrentIndex(0) }}
          onClose={() => setShowPDFImporter(false)}
        />
      )}
      {annotatorFile && (
        <PdfAnnotatorModal
          file={annotatorFile}
          onSave={handleAnnotatorSave}
          onClose={() => setAnnotatorFile(null)}
        />
      )}
      {showQuestionList && (
        <QuestionListModal
          questions={questions}
          currentIndex={currentIndex}
          onSelect={setCurrentIndex}
          onAdd={handleAddQuestion}
          onClose={() => setShowQuestionList(false)}
        />
      )}

      {/* Modal de resultado da publicação em lote */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm p-6 flex flex-col gap-4">
            {batchState === 'loading' ? (
              <>
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 animate-spin text-emerald-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  <p className="text-sm font-semibold text-slate-700">Publicando questões no Atlas...</p>
                </div>
                <p className="text-xs text-slate-400">Isso pode levar alguns segundos.</p>
              </>
            ) : batchResult && (
              <>
                <div className="flex items-center gap-3">
                  {batchResult.erros.length === 0 ? (
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-bold text-slate-800">
                      {batchResult.ok} de {batchResult.total} publicadas
                    </p>
                    {batchResult.erros.length > 0 && (
                      <p className="text-xs text-amber-600">{batchResult.erros.length} com erro</p>
                    )}
                  </div>
                </div>
                {batchResult.erros.length > 0 && (
                  <div className="bg-red-50 rounded-xl border border-red-200 p-3 max-h-36 overflow-y-auto">
                    {batchResult.erros.map((e, i) => (
                      <p key={i} className="text-xs text-red-700">
                        <strong>Q{e.number}:</strong> {e.msg}
                      </p>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => { setShowBatchModal(false); setBatchState('idle') }}
                  className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-semibold text-slate-700 transition"
                >
                  Fechar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Navbar */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-[1200px] mx-auto px-4 h-14 flex items-center justify-between gap-3">

          {/* Logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-800 leading-none">Editor de Questões</h1>
              <p className="text-xs text-slate-400 leading-none mt-0.5">Formato ENEM</p>
            </div>
          </div>

          {/* Mobile tab toggle */}
          <div className="flex lg:hidden items-center gap-1 bg-slate-100 rounded-lg p-1">
            {['editor', 'preview'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-semibold capitalize transition ${
                  activeTab === tab ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                {tab === 'editor' ? 'Editor' : 'Preview'}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Novo projeto */}
            <button
              onClick={limparRascunho}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition border border-slate-200"
              title="Descartar rascunho e começar do zero"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Novo</span>
            </button>

            {/* Questões */}
            <button
              onClick={() => setShowQuestionList(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg transition border border-slate-200"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              <span className="hidden sm:inline">Questões</span>
              <span className="bg-violet-100 text-violet-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {questions.length}
              </span>
            </button>

            {/* Carregar Gabarito */}
            <button
              onClick={() => gabaritoInputRef.current.click()}
              className="flex items-center gap-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 px-3 py-2 rounded-lg transition border border-teal-200"
              title="Carregar gabarito PDF/TXT e aplicar nas questões"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="hidden sm:inline">Gabarito</span>
            </button>

            {/* Anotar PDF */}
            <button
              onClick={() => annotatorInputRef.current.click()}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-2 rounded-lg transition border border-indigo-200"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              <span className="hidden sm:inline">Anotar PDF</span>
            </button>

            {/* Importar PDF */}
            <button
              onClick={() => setShowPDFImporter(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-2 rounded-lg transition border border-orange-200"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <span className="hidden sm:inline">Importar PDF</span>
            </button>

            {/* Importar JSON */}
            <button
              onClick={() => importRef.current.click()}
              className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 px-3 py-2 rounded-lg transition border border-violet-200"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span className="hidden sm:inline">Importar JSON</span>
            </button>

            {/* Exportar JSON */}
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 px-3 py-2 rounded-lg transition border border-slate-200"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="hidden sm:inline">Exportar JSON</span>
            </button>

            {/* Classificar todas */}
            <button
              onClick={handleClassificar}
              disabled={classificandoState === 'loading'}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-violet-500 hover:bg-violet-600 disabled:opacity-60 disabled:cursor-not-allowed px-3 py-2 rounded-lg transition shadow-sm"
            >
              {classificandoState === 'loading' ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              )}
              <span className="hidden sm:inline">
                {classificandoState === 'loading' ? 'Classificando...' : 'Classificar tudo'}
              </span>
            </button>

            {/* Publicar todas no Atlas */}
            <button
              onClick={handlePublishAll}
              disabled={batchState === 'loading'}
              className="flex items-center gap-1.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed px-3 py-2 rounded-lg transition shadow-sm"
            >
              {batchState === 'loading' ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 11l3-3m0 0l3 3m-3-3v8m0-13a9 9 0 110 18 9 9 0 010-18z" />
                </svg>
              )}
              <span className="hidden sm:inline">
                {batchState === 'loading' ? 'Publicando...' : 'Publicar tudo'}
              </span>
            </button>
          </div>
        </div>

        <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        <input
          ref={gabaritoInputRef}
          type="file"
          accept=".pdf,.txt"
          className="hidden"
          onChange={e => { handleCarregarGabarito(e.target.files[0]); e.target.value = '' }}
        />
        <input
          ref={annotatorInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={e => { setAnnotatorFile(e.target.files[0] || null); e.target.value = '' }}
        />
      </header>

      {/* Main — 2 colunas */}
      <main className="max-w-[1200px] mx-auto px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6 items-start">

          {/* Editor */}
          <div className={`lg:w-[480px] flex-shrink-0 w-full ${activeTab !== 'editor' ? 'hidden lg:block' : ''}`}>
            {/* Barra de navegação entre questões */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${question.needs_review ? 'bg-orange-400' : 'bg-violet-500'}`} />
                <h2 className="text-sm font-bold text-slate-700">
                  Questão {question.number || currentIndex + 1}
                </h2>
                <span className="text-xs text-slate-400">de {questions.length}</span>
                {question.needs_review && (
                  <span className="text-[10px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full">
                    Revisar
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Botão de correção — aparece quando há mudanças em relação ao original extraído */}
                {temMudancas && !correcaoEnviada && (
                  <button
                    onClick={enviarCorrecao}
                    title="Registrar esta correção para melhorar extrações futuras"
                    className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-300 px-2 py-1 rounded-lg transition"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    Treinar IA
                  </button>
                )}
                {correcaoEnviada && (
                  <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    Correção salva
                  </span>
                )}
                <button
                  onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
                  disabled={currentIndex === 0}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => setCurrentIndex(i => Math.min(questions.length - 1, i + 1))}
                  disabled={currentIndex === questions.length - 1}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
              <QuestionEditor question={question} onChange={updateQuestion} />
            </div>
          </div>

          {/* Preview */}
          <div className={`flex-1 w-full ${activeTab !== 'preview' ? 'hidden lg:block' : ''}`}>
            <div className="sticky top-20">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <h2 className="text-sm font-bold text-slate-700">Preview</h2>
                <div className="ml-auto flex items-center gap-2">
                  {publishState === 'success' && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      Publicada!
                    </span>
                  )}
                  {publishState === 'error' && (
                    <span className="text-xs text-red-500 font-medium" title={publishError}>
                      Erro ao publicar
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      if (!question.number || !question.command) return
                      setClassificandoState('loading')
                      try {
                        const res = await fetch(`${BACKEND}/classificar`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            questoes: [{
                              number: question.number,
                              area: question.area || 'matematica',
                              command: [
                                ...(question.content || []).filter(b => b.type === 'text' && b.value?.trim()).map(b => b.value.trim()),
                                question.command?.trim(),
                              ].filter(Boolean).join('\n\n'),
                              alternatives: question.alternatives,
                            }],
                          }),
                        })
                        if (!res.ok) throw new Error(`HTTP ${res.status}`)
                        const { classificacoes } = await res.json()
                        const cls = classificacoes[String(question.number)]
                        if (cls) {
                          const area = question.area || disciplinaParaArea(cls.disciplina)
                          setQuestions(prev => prev.map(q => q.number === question.number ? { ...q, ...cls, area } : q))
                        }
                      } catch (err) {
                        alert(`Erro ao classificar: ${err.message}`)
                      } finally {
                        setClassificandoState('idle')
                      }
                    }}
                    disabled={classificandoState === 'loading'}
                    className="flex items-center gap-1.5 text-xs font-semibold text-white bg-violet-500 hover:bg-violet-600 disabled:opacity-60 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition shadow-sm"
                  >
                    {classificandoState === 'loading' ? (
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    )}
                    Classificar
                  </button>
                  {isQuestionComplete(question) && !question.needs_review && (
                    <button
                      onClick={handlePublish}
                      disabled={publishState === 'loading'}
                      className="flex items-center gap-1.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition shadow-sm"
                    >
                      {publishState === 'loading' ? (
                        <>
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                          Publicando…
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 11l3-3m0 0l3 3m-3-3v8m0-13a9 9 0 110 18 9 9 0 010-18z" />
                          </svg>
                          Publicar no Atlas
                        </>
                      )}
                    </button>
                  )}
                  <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                    Tempo real
                  </span>
                </div>
              </div>
              <QuestionPreview question={question} onToggleReview={toggleReview} />
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
