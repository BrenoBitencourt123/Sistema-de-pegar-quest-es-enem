function getStatus(q) {
  const hasContent = !!(q.statement?.trim() || q.image || q.command?.trim())
  const altsOk = q.alternatives.length >= 2 && q.alternatives.every(a => a.trim())
  if (hasContent && altsOk) return 'complete'
  if (hasContent || q.alternatives.some(a => a.trim())) return 'partial'
  return 'empty'
}

const STATUS_STYLE = {
  complete: 'bg-emerald-500 text-white border-emerald-500',
  partial:  'bg-amber-400 text-white border-amber-400',
  empty:    'bg-slate-100 text-slate-400 border-slate-200',
}

const STATUS_ACTIVE = {
  complete: 'ring-2 ring-emerald-400 ring-offset-1',
  partial:  'ring-2 ring-amber-400 ring-offset-1',
  empty:    'ring-2 ring-violet-400 ring-offset-1',
}

export default function QuestionList({ questions, currentIndex, onSelect }) {
  const total = questions.length
  const complete = questions.filter(q => getStatus(q) === 'complete').length
  const partial  = questions.filter(q => getStatus(q) === 'partial').length

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100">
        <p className="text-xs font-bold text-slate-700">Questões</p>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            {complete} completas
          </span>
          <span className="flex items-center gap-1 text-[10px] text-amber-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            {partial} parciais
          </span>
          <span className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-slate-200 inline-block" />
            {total - complete - partial} vazias
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-5 gap-1.5">
          {questions.map((q, i) => {
            const status = getStatus(q)
            const isActive = i === currentIndex
            return (
              <button
                key={i}
                onClick={() => onSelect(i)}
                title={`Questão ${q.number || i + 1} — ${status === 'complete' ? 'Completa' : status === 'partial' ? 'Parcial' : 'Vazia'}`}
                className={`
                  h-8 rounded-lg text-[11px] font-bold border transition
                  ${STATUS_STYLE[status]}
                  ${isActive ? STATUS_ACTIVE[status] : 'hover:opacity-80'}
                `}
              >
                {q.number || i + 1}
              </button>
            )
          })}
        </div>
      </div>

      {/* Footer navigation */}
      <div className="px-3 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
        <button
          onClick={() => onSelect(Math.max(0, currentIndex - 1))}
          disabled={currentIndex === 0}
          className="flex-1 flex items-center justify-center gap-1 text-xs font-medium text-slate-500 hover:text-violet-600 disabled:opacity-30 disabled:cursor-not-allowed transition py-1.5 rounded-lg hover:bg-violet-50"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Anterior
        </button>
        <span className="text-xs text-slate-400 font-medium whitespace-nowrap">
          {currentIndex + 1} / {total}
        </span>
        <button
          onClick={() => onSelect(Math.min(total - 1, currentIndex + 1))}
          disabled={currentIndex === total - 1}
          className="flex-1 flex items-center justify-center gap-1 text-xs font-medium text-slate-500 hover:text-violet-600 disabled:opacity-30 disabled:cursor-not-allowed transition py-1.5 rounded-lg hover:bg-violet-50"
        >
          Próxima
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
