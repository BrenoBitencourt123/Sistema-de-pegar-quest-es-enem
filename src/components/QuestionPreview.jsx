const LETTERS = ['A', 'B', 'C', 'D', 'E']

export default function QuestionPreview({ question, onToggleReview }) {
  const total = 90
  const content = question.content || []
  const hasContent = content.some(b => (b.type === 'text' && b.value) || (b.type === 'image' && (b.data || b.has_image)))

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden font-sans">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Simulado</span>
          <span className="mx-1 text-slate-300">|</span>
          <span className="text-xs font-semibold text-slate-700 truncate max-w-[220px]">
            {question.exam || 'Nome do exame'}
          </span>
        </div>
        <button className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
          </svg>
          Informar problema
        </button>
      </div>

      <div className="px-5 py-5">
        {/* Q number */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="bg-violet-100 text-violet-700 text-xs font-bold px-2.5 py-1 rounded-lg">
              Q.{question.number || '1'}
            </span>
            <span className="text-xs text-slate-400">de {total}</span>
          </div>
        </div>

        {/* Blocos de conteúdo */}
        {content.map((block, i) => {
          if (block.type === 'text') {
            return block.value ? (
              <p key={i} className="text-sm text-slate-700 leading-relaxed mb-4 whitespace-pre-wrap">
                {block.value}
              </p>
            ) : null
          }
          if (block.type === 'image') {
            return block.data ? (
              <div key={i} className="mb-4 flex flex-col items-center">
                <img
                  src={block.data}
                  alt="Imagem da questão"
                  className="max-w-full rounded-lg border border-slate-200 object-contain max-h-72"
                />
                {block.caption && (
                  <p className="mt-1.5 text-xs text-slate-400 text-center italic">{block.caption}</p>
                )}
              </div>
            ) : block.has_image ? (
              <div key={i} className="mb-4 flex items-center justify-center gap-2 px-4 py-5 rounded-xl border-2 border-dashed border-amber-200 bg-amber-50">
                <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-xs text-amber-700 font-medium">Imagem pendente — use "Anotar PDF" para inserir</span>
              </div>
            ) : null
          }
          return null
        })}

        {/* Comando */}
        {question.command && (
          <p className="text-sm text-slate-800 font-medium leading-relaxed mb-5">
            {question.command}
          </p>
        )}

        {/* Divider */}
        {(hasContent || question.command) && question.alternatives.some(a => a) && (
          <hr className="border-slate-100 mb-4" />
        )}

        {/* Alternativas */}
        <div className="flex flex-col gap-2">
          {question.alternatives.map((alt, i) => {
            const altObj = typeof alt === 'string' ? { text: alt, image: null } : alt
            const isCorrect = question.correct === i
            return (
              <div
                key={i}
                className={`flex items-start gap-3 px-3.5 py-2.5 rounded-xl border transition ${
                  isCorrect
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span
                  className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${
                    isCorrect ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {LETTERS[i]}
                </span>
                <div className="flex flex-col gap-1.5 flex-1">
                  {altObj.text && (
                    <span className={`text-sm leading-relaxed ${isCorrect ? 'text-emerald-800 font-medium' : 'text-slate-700'}`}>
                      {altObj.text}
                    </span>
                  )}
                  {altObj.image && (
                    <img src={altObj.image} alt={`Alternativa ${LETTERS[i]}`} className="max-h-32 max-w-full object-contain rounded" />
                  )}
                  {!altObj.text && !altObj.image && (
                    <span className="text-slate-300 italic text-sm">Alternativa {LETTERS[i]}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Bookmark */}
        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={onToggleReview}
            className={`flex items-center gap-1.5 text-xs font-medium transition ${
              question.needs_review
                ? 'text-orange-500 hover:text-orange-700'
                : 'text-slate-400 hover:text-orange-500'
            }`}
          >
            <svg className="w-4 h-4" fill={question.needs_review ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            {question.needs_review ? 'Marcada para revisão' : 'Marcar para revisão'}
          </button>
          <div className="flex items-center gap-3">
            <button className="text-xs font-medium text-slate-400 hover:text-slate-600 transition">Anterior</button>
            <button className="text-xs font-semibold text-violet-600 hover:text-violet-800 transition">Próxima</button>
          </div>
        </div>
      </div>
    </div>
  )
}
