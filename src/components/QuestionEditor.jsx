import { useRef, useEffect, useState } from 'react'

const LETTERS = ['A', 'B', 'C', 'D', 'E']

// ─── Bloco de Imagem ──────────────────────────────────────────────────────────

function ImageBlock({ block, onChange, onRemove, onMoveUp, onMoveDown, canMoveUp, canMoveDown }) {
  const fileInputRef = useRef(null)

  function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => onChange({ ...block, data: ev.target.result, has_image: true })
    reader.readAsDataURL(file)
  }

  function removeData() {
    onChange({ ...block, data: null })
    fileInputRef.current.value = ''
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Controles do bloco */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-100">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Imagem</span>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp} disabled={!canMoveUp} title="Mover para cima"
            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50 disabled:opacity-30 disabled:cursor-not-allowed transition">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button onClick={onMoveDown} disabled={!canMoveDown} title="Mover para baixo"
            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50 disabled:opacity-30 disabled:cursor-not-allowed transition">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button onClick={onRemove} title="Remover bloco"
            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Conteúdo da imagem */}
      {block.data ? (
        <div className="p-3 flex flex-col gap-2">
          <img src={block.data} alt="preview" className="w-full max-h-48 object-contain rounded" />
          <input
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition"
            placeholder="Legenda da imagem (opcional)"
            value={block.caption}
            onChange={e => onChange({ ...block, caption: e.target.value })}
          />
          <button onClick={removeData} className="text-xs text-red-500 hover:text-red-700 font-medium self-start transition">
            Remover imagem
          </button>
        </div>
      ) : block.has_image ? (
        <div className="p-3 flex flex-col gap-2">
          <div
            className="w-full h-20 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-amber-100 transition"
            onClick={() => fileInputRef.current.click()}
          >
            <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs text-amber-700 font-medium">Imagem identificada — cole com Ctrl+V ou clique</span>
          </div>
          <input
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition"
            placeholder="Legenda da imagem (opcional)"
            value={block.caption}
            onChange={e => onChange({ ...block, caption: e.target.value })}
          />
        </div>
      ) : (
        <div className="p-3 flex flex-col gap-2">
          <div
            className="w-full h-20 rounded-lg border-2 border-dashed border-slate-200 bg-white flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-slate-50 transition"
            onClick={() => fileInputRef.current.click()}
          >
            <svg className="w-5 h-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs text-slate-400">
              Cole com{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono text-[10px] border border-slate-200">Ctrl+V</kbd>
              {' '}ou clique para enviar
            </span>
          </div>
          <input
            className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition"
            placeholder="Legenda da imagem (opcional)"
            value={block.caption}
            onChange={e => onChange({ ...block, caption: e.target.value })}
          />
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
    </div>
  )
}

// ─── Bloco de Texto ───────────────────────────────────────────────────────────

function FmtBtn({ active, onClick, title, children }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      className={`w-5 h-5 flex items-center justify-center rounded text-[11px] transition ${
        active
          ? 'bg-violet-100 text-violet-700'
          : 'text-slate-400 hover:text-violet-600 hover:bg-violet-50'
      }`}
    >
      {children}
    </button>
  )
}

function TextBlock({ block, onChange, onRemove, onMoveUp, onMoveDown, canMoveUp, canMoveDown }) {
  const fmt = block.format || {}
  const bold = fmt.bold || false
  const color = fmt.color || 'default'
  const align = fmt.align || 'left'

  function setFormat(patch) {
    onChange({ ...block, format: { ...fmt, ...patch } })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-100">
        {/* Formatação */}
        <div className="flex items-center gap-0.5">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mr-1.5">Texto</span>
          <span className="text-slate-200 mr-1">|</span>
          {/* Negrito */}
          <FmtBtn active={bold} onClick={() => setFormat({ bold: !bold })} title="Negrito">
            <span className="font-bold">B</span>
          </FmtBtn>
          {/* Cor acinzentada */}
          <FmtBtn active={color === 'muted'} onClick={() => setFormat({ color: color === 'muted' ? 'default' : 'muted' })} title="Texto acinzentado (citação/fonte)">
            <span className={color === 'muted' ? 'text-slate-400' : ''}>A</span>
          </FmtBtn>
          <span className="text-slate-200 mx-0.5">|</span>
          {/* Alinhamento esquerda */}
          <FmtBtn active={align === 'left'} onClick={() => setFormat({ align: 'left' })} title="Alinhar à esquerda">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h10M4 14h16M4 18h10" />
            </svg>
          </FmtBtn>
          {/* Alinhamento centro */}
          <FmtBtn active={align === 'center'} onClick={() => setFormat({ align: 'center' })} title="Centralizar">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 10h10M4 14h16M7 18h10" />
            </svg>
          </FmtBtn>
          {/* Alinhamento direita */}
          <FmtBtn active={align === 'right'} onClick={() => setFormat({ align: 'right' })} title="Alinhar à direita">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M10 10h10M4 14h16M10 18h10" />
            </svg>
          </FmtBtn>
        </div>
        {/* Controles de bloco */}
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp} disabled={!canMoveUp} title="Mover para cima"
            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50 disabled:opacity-30 disabled:cursor-not-allowed transition">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button onClick={onMoveDown} disabled={!canMoveDown} title="Mover para baixo"
            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50 disabled:opacity-30 disabled:cursor-not-allowed transition">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button onClick={onRemove} title="Remover bloco"
            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <textarea
        rows={4}
        className="w-full px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none leading-relaxed"
        placeholder="Digite o texto de contexto ou enunciado..."
        value={block.value}
        onChange={e => onChange({ ...block, value: e.target.value })}
      />
    </div>
  )
}

// ─── Botão "Adicionar bloco" ──────────────────────────────────────────────────

function AddBlockButton({ onAddText, onAddImage }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative flex justify-center">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-violet-600 transition px-2 py-0.5 rounded-lg hover:bg-violet-50"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Adicionar bloco
      </button>
      {open && (
        <div className="absolute top-full mt-1 z-10 bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-[140px]">
          <button
            onClick={() => { onAddText(); setOpen(false) }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h8" />
            </svg>
            Bloco de texto
          </button>
          <button
            onClick={() => { onAddImage(); setOpen(false) }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Bloco de imagem
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Editor principal ─────────────────────────────────────────────────────────

export default function QuestionEditor({ question, onChange }) {
  const questionRef = useRef(question)
  questionRef.current = question

  // Paste global → preenche o primeiro bloco de imagem vazio, ou cria um novo
  useEffect(() => {
    function handlePaste(e) {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => {
          const q = questionRef.current
          const content = [...(q.content || [])]
          const emptyIdx = content.findIndex(b => b.type === 'image' && !b.data)
          if (emptyIdx !== -1) {
            content[emptyIdx] = { ...content[emptyIdx], data: ev.target.result, has_image: true }
          } else {
            content.push({ type: 'image', data: ev.target.result, caption: '', has_image: true })
          }
          onChange({ ...q, content })
        }
        reader.readAsDataURL(file)
        e.preventDefault()
        return
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [onChange])

  const content = question.content || []

  function updateBlock(index, updated) {
    const next = [...content]
    next[index] = updated
    onChange({ ...question, content: next })
  }

  function removeBlock(index) {
    onChange({ ...question, content: content.filter((_, i) => i !== index) })
  }

  function moveBlock(index, dir) {
    const next = [...content]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange({ ...question, content: next })
  }

  function addBlock(type, afterIndex) {
    const newBlock = type === 'text'
      ? { type: 'text', value: '' }
      : { type: 'image', data: null, caption: '', has_image: false }
    const next = [...content]
    next.splice(afterIndex + 1, 0, newBlock)
    onChange({ ...question, content: next })
  }

  function updateAlternative(index, patch) {
    const alts = [...question.alternatives]
    alts[index] = { ...alts[index], ...patch }
    onChange({ ...question, alternatives: alts })
  }

  function addAlternative() {
    if (question.alternatives.length >= 5) return
    onChange({ ...question, alternatives: [...question.alternatives, { text: '', image: null }] })
  }

  function removeAlternative(index) {
    if (question.alternatives.length <= 2) return
    const alts = question.alternatives.filter((_, i) => i !== index)
    const correct = question.correct >= alts.length ? alts.length - 1 : question.correct
    onChange({ ...question, alternatives: alts, correct })
  }

  function uploadAltImage(index, file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => updateAlternative(index, { image: ev.target.result })
    reader.readAsDataURL(file)
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

      {/* Idioma estrangeiro */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          Idioma estrangeiro
        </label>
        <div className="flex gap-2">
          {[
            { value: '', label: 'Nenhum' },
            { value: 'ingles', label: 'Inglês' },
            { value: 'espanhol', label: 'Espanhol' },
          ].map(opt => {
            const active = (question.foreign_language || '') === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => onChange({ ...question, foreign_language: opt.value })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                  active
                    ? 'bg-violet-600 border-violet-600 text-white'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-violet-400 hover:text-violet-600'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Blocos de conteúdo */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
          Conteúdo da Questão
        </label>

        <div className="flex flex-col gap-2">
          {content.length === 0 && (
            <AddBlockButton
              onAddText={() => addBlock('text', -1)}
              onAddImage={() => addBlock('image', -1)}
            />
          )}

          {content.map((block, i) => (
            <div key={i} className="flex flex-col gap-2">
              {block.type === 'text' ? (
                <TextBlock
                  block={block}
                  onChange={updated => updateBlock(i, updated)}
                  onRemove={() => removeBlock(i)}
                  onMoveUp={() => moveBlock(i, -1)}
                  onMoveDown={() => moveBlock(i, 1)}
                  canMoveUp={i > 0}
                  canMoveDown={i < content.length - 1}
                />
              ) : (
                <ImageBlock
                  block={block}
                  onChange={updated => updateBlock(i, updated)}
                  onRemove={() => removeBlock(i)}
                  onMoveUp={() => moveBlock(i, -1)}
                  onMoveDown={() => moveBlock(i, 1)}
                  canMoveUp={i > 0}
                  canMoveDown={i < content.length - 1}
                />
              )}
              <AddBlockButton
                onAddText={() => addBlock('text', i)}
                onAddImage={() => addBlock('image', i)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Pergunta / Comando */}
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
          {question.alternatives.map((alt, i) => {
            const altObj = typeof alt === 'string' ? { text: alt, image: null } : alt
            return (
              <div key={i} className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onChange({ ...question, correct: i })}
                    title={question.correct === i ? 'Gabarito' : 'Marcar como gabarito'}
                    className={`flex-shrink-0 w-7 h-7 rounded-full text-xs font-bold transition border-2 ${
                      question.correct === i
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'bg-white border-slate-300 text-slate-500 hover:border-violet-400 hover:text-violet-500'
                    }`}
                  >
                    {LETTERS[i]}
                  </button>
                  <input
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition"
                    placeholder={`Texto da alternativa ${LETTERS[i]}`}
                    value={altObj.text}
                    onChange={e => updateAlternative(i, { text: e.target.value })}
                  />
                  {/* Botão de imagem */}
                  <label title="Imagem da alternativa" className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer transition border border-slate-200 hover:border-violet-400 hover:bg-violet-50 text-slate-400 hover:text-violet-500">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <input type="file" accept="image/*" className="hidden" onChange={e => uploadAltImage(i, e.target.files[0])} />
                  </label>
                  {question.alternatives.length > 2 && (
                    <button
                      onClick={() => removeAlternative(i)}
                      className="flex-shrink-0 text-slate-400 hover:text-red-500 transition"
                      title="Remover"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                {/* Preview da imagem da alternativa */}
                {altObj.image && (
                  <div className="ml-9 flex items-start gap-2">
                    <img src={altObj.image} alt={`Alt ${LETTERS[i]}`} className="max-h-24 max-w-full object-contain rounded border border-slate-200" />
                    <button
                      onClick={() => updateAlternative(i, { image: null })}
                      className="text-xs text-red-500 hover:text-red-700 font-medium transition mt-1"
                    >
                      Remover
                    </button>
                  </div>
                )}
              </div>
            )
          })}
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

      {/* Gabarito */}
      {question.correct != null ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {LETTERS[question.correct]}
          </div>
          <p className="text-xs text-emerald-700 font-medium">
            Gabarito selecionado: alternativa <strong>{LETTERS[question.correct]}</strong>
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-slate-400 text-xs font-bold flex-shrink-0">?</div>
          <p className="text-xs text-slate-400">Sem gabarito — clique na letra para marcar</p>
        </div>
      )}

    </div>
  )
}
