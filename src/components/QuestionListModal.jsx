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

export default function QuestionListModal({ questions, currentIndex, onSelect, onAdd, onClose }) {
  const total    = questions.length
  const complete = questions.filter(q => getStatus(q) === 'complete').length
  const partial  = questions.filter(q => getStatus(q) === 'partial').length
  const empty    = total - complete - partial

  function handleSelect(i) {
    onSelect(i)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-bold text-slate-800">Lista de Questões</h2>
            <div className="flex items-center gap-3 mt-1">
              <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                {complete} completas
              </span>
              <span className="flex items-center gap-1 text-[10px] text-amber-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                {partial} parciais
              </span>
              <span className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-200 inline-block" />
                {empty} vazias
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Grid de questões */}
        <div className="overflow-y-auto p-4" style={{ maxHeight: '60vh' }}>
          <div className="grid grid-cols-6 gap-1.5">
            {questions.map((q, i) => {
              const status = getStatus(q)
              const isActive = i === currentIndex
              return (
                <button
                  key={i}
                  onClick={() => handleSelect(i)}
                  title={`Questão ${q.number || i + 1}`}
                  className={`
                    h-9 rounded-lg text-[11px] font-bold border transition
                    ${STATUS_STYLE[status]}
                    ${isActive ? STATUS_ACTIVE[status] : 'hover:opacity-75'}
                  `}
                >
                  {q.number || i + 1}
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">{total} questão(ões) no total</p>
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold transition shadow-sm"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nova questão
          </button>
        </div>
      </div>
    </div>
  )
}
