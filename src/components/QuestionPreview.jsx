const LETTERS = ['A', 'B', 'C', 'D', 'E']

export default function QuestionPreview({ question }) {
  const total = 90 // default ENEM total

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

        {/* Statement */}
        {question.statement && (
          <p className="text-sm text-slate-700 leading-relaxed mb-4 whitespace-pre-wrap">
            {question.statement}
          </p>
        )}

        {/* Image */}
        {question.image && (
          <div className="mb-4 flex flex-col items-center">
            <img
              src={question.image}
              alt="Imagem da questão"
              className="max-w-full rounded-lg border border-slate-200 object-contain max-h-72"
            />
            {question.imageCaption && (
              <p className="mt-1.5 text-xs text-slate-400 text-center italic">
                {question.imageCaption}
              </p>
            )}
          </div>
        )}

        {/* Command */}
        {question.command && (
          <p className="text-sm text-slate-800 font-medium leading-relaxed mb-5">
            {question.command}
          </p>
        )}

        {/* Divider */}
        {(question.statement || question.image || question.command) && question.alternatives.some(a => a) && (
          <hr className="border-slate-100 mb-4" />
        )}

        {/* Alternatives */}
        <div className="flex flex-col gap-2">
          {question.alternatives.map((alt, i) => {
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
                    isCorrect
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {LETTERS[i]}
                </span>
                <span className={`text-sm leading-relaxed ${isCorrect ? 'text-emerald-800 font-medium' : 'text-slate-700'}`}>
                  {alt || <span className="text-slate-300 italic">Alternativa {LETTERS[i]}</span>}
                </span>
              </div>
            )
          })}
        </div>

        {/* Bookmark */}
        <div className="mt-5 flex items-center justify-between">
          <button className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-violet-600 transition">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            Marcar para revisão
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
