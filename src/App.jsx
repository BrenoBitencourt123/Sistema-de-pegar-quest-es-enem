import { useState, useRef } from 'react'
import './index.css'
import QuestionEditor from './components/QuestionEditor'
import QuestionPreview from './components/QuestionPreview'
import QuestionListModal from './components/QuestionListModal'
import PDFImporter from './components/PDFImporter'
import PdfAnnotatorModal from './components/PdfAnnotatorModal'

const DEFAULT_QUESTION = {
  exam: 'ENEM 2020 – 1º Dia – Caderno Azul',
  number: '1',
  statement: '',
  image: null,
  imageCaption: '',
  command: '',
  alternatives: ['', '', '', '', ''],
  correct: 0,
}

function makeNewQuestion(questions) {
  const maxNum = questions.reduce((max, q) => Math.max(max, Number(q.number) || 0), 0)
  return { ...DEFAULT_QUESTION, number: String(maxNum + 1) }
}

export default function App() {
  const [questions, setQuestions]         = useState([DEFAULT_QUESTION])
  const [currentIndex, setCurrentIndex]   = useState(0)
  const [activeTab, setActiveTab]         = useState('editor')
  const [showPDFImporter, setShowPDFImporter] = useState(false)
  const [showQuestionList, setShowQuestionList] = useState(false)
  const [annotatorFile, setAnnotatorFile] = useState(null)
  const importRef        = useRef(null)
  const annotatorInputRef = useRef(null)

  const question = questions[currentIndex]

  function updateQuestion(updated) {
    setQuestions(prev => prev.map((q, i) => i === currentIndex ? updated : q))
  }

  function handlePDFImport(questoes) {
    setQuestions(questoes)
    setCurrentIndex(0)
  }

  function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        const list = Array.isArray(data) ? data : [data]
        setQuestions(list)
        setCurrentIndex(0)
      } catch {
        alert('Arquivo JSON inválido.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleAnnotatorSave(images) {
    setQuestions(prev => {
      const updated = [...prev]
      for (const img of images) {
        if (img.role !== 'stem') continue
        const idx = updated.findIndex(q => String(q.number) === String(img.questionNumber))
        if (idx !== -1) {
          updated[idx] = { ...updated[idx], image: img.dataUrl }
        }
      }
      return updated
    })
    setAnnotatorFile(null)
  }

  function handleAddQuestion() {
    const nova = makeNewQuestion(questions)
    setQuestions(prev => [...prev, nova])
    setCurrentIndex(questions.length)
    setShowQuestionList(false)
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
          </div>
        </div>

        <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
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
                <span className="w-2 h-2 rounded-full bg-violet-500" />
                <h2 className="text-sm font-bold text-slate-700">
                  Questão {question.number || currentIndex + 1}
                </h2>
                <span className="text-xs text-slate-400">de {questions.length}</span>
              </div>
              <div className="flex items-center gap-1">
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
                <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                  Tempo real
                </span>
              </div>
              <QuestionPreview question={question} />
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
