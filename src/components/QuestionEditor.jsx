import { useRef, useEffect } from 'react'

const LETTERS = ['A', 'B', 'C', 'D', 'E']

export default function QuestionEditor({ question, onChange }) {
  const fileInputRef = useRef(null)
  const questionRef = useRef(question)
  questionRef.current = question

  useEffect(() => {
    function handlePaste(e) {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (!file) return
          const reader = new FileReader()
          reader.onload = (ev) => {
            onChange({ ...questionRef.current, image: ev.target.result, imageCaption: questionRef.current.imageCaption || '' })
          }
          reader.readAsDataURL(file)
          e.preventDefault()
          return
        }
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [onChange])

  function handleImageUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => onChange({ ...question, image: ev.target.result, imageCaption: question.imageCaption || '' })
    reader.readAsDataURL(file)
  }

  function removeImage() {
    onChange({ ...question, image: null, imageCaption: '' })
    fileInputRef.current.value = ''
  }

  function updateAlternative(index, value) {
    const alts = [...question.alternatives]
    alts[index] = value
    onChange({ ...question, alternatives: alts })
  }

  function addAlternative() {
    if (question.alternatives.length >= 5) return
    onChange({ ...question, alternatives: [...question.alternatives, ''] })
  }

  function removeAlternative(index) {
    if (question.alternatives.length <= 2) return
    const alts = question.alternatives.filter((_, i) => i !== index)
    const correct = question.correct >= alts.length ? alts.length - 1 : question.correct
    onChange({ ...question, alternatives: alts, correct })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header info */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            Exame / Simulado
          </label>
          <input
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition"
            placeholder="Ex: ENEM 2020 – 1º Dia"
            value={question.exam}
            onChange={e => onChange({ ...question, exam: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            Número da Questão
          </label>
          <input
            type="number"
            min={1}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition"
            placeholder="1"
            value={question.number}
            onChange={e => onChange({ ...question, number: e.target.value })}
          />
        </div>
      </div>

      {/* Enunciado */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          Enunciado / Texto base
        </label>
        <textarea
          rows={5}
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition resize-none leading-relaxed"
          placeholder="Digite o enunciado da questão..."
          value={question.statement}
          onChange={e => onChange({ ...question, statement: e.target.value })}
        />
      </div>

      {/* Imagem */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          Imagem (opcional)
        </label>
        {question.image ? (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <img src={question.image} alt="preview" className="w-full max-h-48 object-contain p-3" />
            <div className="px-3 pb-3 flex flex-col gap-2">
              <input
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition"
                placeholder="Legenda da imagem (opcional)"
                value={question.imageCaption}
                onChange={e => onChange({ ...question, imageCaption: e.target.value })}
              />
              <button
                onClick={removeImage}
                className="text-xs text-red-500 hover:text-red-700 font-medium self-start transition"
              >
                Remover imagem
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full h-28 rounded-xl border-2 border-dashed border-slate-200 bg-white flex flex-col items-center justify-center gap-1.5">
            <svg className="w-6 h-6 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs text-slate-400">
              Cole a imagem com{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono text-[10px] border border-slate-200">
                Ctrl+V
              </kbd>
            </span>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
      </div>

      {/* Pergunta direta */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          Pergunta / Comando
        </label>
        <textarea
          rows={2}
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition resize-none"
          placeholder="Ex: Os recursos usados nesse pôster levam o leitor a refletir sobre a necessidade de"
          value={question.command}
          onChange={e => onChange({ ...question, command: e.target.value })}
        />
      </div>

      {/* Alternativas */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          Alternativas
        </label>
        <div className="flex flex-col gap-2">
          {question.alternatives.map((alt, i) => (
            <div key={i} className="flex items-start gap-2">
              <button
                onClick={() => onChange({ ...question, correct: i })}
                title={question.correct === i ? 'Gabarito' : 'Marcar como gabarito'}
                className={`flex-shrink-0 w-7 h-7 mt-1.5 rounded-full text-xs font-bold transition border-2 ${
                  question.correct === i
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : 'bg-white border-slate-300 text-slate-500 hover:border-violet-400 hover:text-violet-500'
                }`}
              >
                {LETTERS[i]}
              </button>
              <input
                className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition"
                placeholder={`Alternativa ${LETTERS[i]}`}
                value={alt}
                onChange={e => updateAlternative(i, e.target.value)}
              />
              {question.alternatives.length > 2 && (
                <button
                  onClick={() => removeAlternative(i)}
                  className="flex-shrink-0 mt-2.5 text-slate-400 hover:text-red-500 transition"
                  title="Remover"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
        {question.alternatives.length < 5 && (
          <button
            onClick={addAlternative}
            className="mt-3 text-xs font-semibold text-violet-600 hover:text-violet-800 flex items-center gap-1 transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Adicionar alternativa
          </button>
        )}
        <p className="mt-2 text-xs text-slate-400">Clique na letra para marcar o gabarito</p>
      </div>

      {/* Gabarito color legend */}
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-3">
        <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          {LETTERS[question.correct] ?? 'A'}
        </div>
        <p className="text-xs text-emerald-700 font-medium">
          Gabarito selecionado: alternativa <strong>{LETTERS[question.correct] ?? 'A'}</strong>
        </p>
      </div>
    </div>
  )
}
