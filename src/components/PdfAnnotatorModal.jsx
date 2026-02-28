import { useState, useRef, useCallback, useEffect } from 'react'
import * as pdfjs from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

const ROLE_COLORS = {
  stem: '#6366F1',
  A: '#10B981',
  B: '#F59E0B',
  C: '#EF4444',
  D: '#8B5CF6',
  E: '#06B6D4',
}

function normalizeRect(xRel, yRel, wRel, hRel) {
  return {
    xRel: wRel < 0 ? xRel + wRel : xRel,
    yRel: hRel < 0 ? yRel + hRel : yRel,
    wRel: Math.abs(wRel),
    hRel: Math.abs(hRel),
  }
}

export default function PdfAnnotatorModal({ file, onSave, onClose }) {
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [pageDataUrl, setPageDataUrl] = useState(null)
  const [selections, setSelections] = useState([])
  const [zoom, setZoom] = useState(85)

  const [dragging, setDragging] = useState(false)
  const [startPos, setStartPos] = useState(null)
  const [liveRect, setLiveRect] = useState(null)

  const [pendingRect, setPendingRect] = useState(null)
  const [pendingQn, setPendingQn] = useState('1')
  const [pendingRole, setPendingRole] = useState('stem')

  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const containerRef = useRef(null)
  const pdfAreaRef = useRef(null)
  const pdfDocRef = useRef(null)
  const pageCanvasCache = useRef(new Map())

  // Carrega o PDF
  useEffect(() => {
    let cancelled = false
    async function loadPdf() {
      setLoading(true)
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
      if (cancelled) return
      pdfDocRef.current = pdf
      setTotalPages(pdf.numPages)
      setLoading(false)
    }
    loadPdf()
    return () => { cancelled = true }
  }, [file])

  // Renderiza a página atual
  useEffect(() => {
    if (!pdfDocRef.current || totalPages === 0) return
    let cancelled = false
    async function renderPage() {
      setPageDataUrl(null)
      const page = await pdfDocRef.current.getPage(currentPage)
      const scale = 2
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise
      if (cancelled) return
      pageCanvasCache.current.set(currentPage, canvas)
      setPageDataUrl(canvas.toDataURL('image/png'))
    }
    renderPage()
    return () => { cancelled = true }
  }, [currentPage, totalPages])

  // Zoom com Ctrl+Scroll
  useEffect(() => {
    const handler = (e) => {
      if (!e.ctrlKey) return
      const el = pdfAreaRef.current
      if (!el || !el.contains(e.target)) return
      e.preventDefault()
      const direction = e.deltaY > 0 ? -1 : 1
      setZoom(prev => Math.max(50, Math.min(250, prev + direction * 15)))
    }
    document.addEventListener('wheel', handler, { passive: false })
    return () => document.removeEventListener('wheel', handler)
  }, [])

  const getRelPos = useCallback((e) => {
    const el = containerRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }, [])

  function goToPage(page) {
    setPendingRect(null)
    setLiveRect(null)
    setDragging(false)
    setStartPos(null)
    setCurrentPage(page)
  }

  function handleMouseDown(e) {
    if (pendingRect) return
    e.preventDefault()
    const pos = getRelPos(e)
    setStartPos(pos)
    setDragging(true)
    setLiveRect({ xRel: pos.x, yRel: pos.y, wRel: 0, hRel: 0 })
  }

  function handleMouseMove(e) {
    if (!dragging || !startPos) return
    const pos = getRelPos(e)
    setLiveRect({
      xRel: startPos.x,
      yRel: startPos.y,
      wRel: pos.x - startPos.x,
      hRel: pos.y - startPos.y,
    })
  }

  function handleMouseUp() {
    if (!dragging || !startPos || !liveRect) return
    setDragging(false)
    const norm = normalizeRect(liveRect.xRel, liveRect.yRel, liveRect.wRel, liveRect.hRel)
    setLiveRect(null)
    setStartPos(null)
    if (norm.wRel < 0.02 || norm.hRel < 0.02) return
    setPendingRect(norm)
  }

  function handleConfirm() {
    if (!pendingRect) return
    const qn = parseInt(pendingQn, 10)
    if (isNaN(qn) || qn <= 0) return
    const id = Date.now().toString()
    setSelections(prev => [
      ...prev,
      { id, page: currentPage, ...pendingRect, questionNumber: qn, role: pendingRole },
    ])
    setPendingRect(null)
  }

  function removeSelection(id) {
    setSelections(prev => prev.filter(s => s.id !== id))
  }

  async function handleSave() {
    if (selections.length === 0) return
    setSaving(true)

    const byPage = {}
    for (const sel of selections) {
      byPage[sel.page] ??= []
      byPage[sel.page].push(sel)
    }

    const results = []

    for (const [pageStr, pageSels] of Object.entries(byPage)) {
      const pageNum = parseInt(pageStr, 10)
      let canvas = pageCanvasCache.current.get(pageNum)

      if (!canvas) {
        const page = await pdfDocRef.current.getPage(pageNum)
        const scale = 2
        const viewport = page.getViewport({ scale })
        canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        await page.render({ canvasContext: ctx, viewport }).promise
        pageCanvasCache.current.set(pageNum, canvas)
      }

      for (const sel of pageSels) {
        const pw = Math.round(sel.wRel * canvas.width)
        const ph = Math.round(sel.hRel * canvas.height)
        if (pw <= 0 || ph <= 0) continue

        const cropCanvas = document.createElement('canvas')
        cropCanvas.width = pw
        cropCanvas.height = ph
        const ctx = cropCanvas.getContext('2d')
        ctx.drawImage(
          canvas,
          Math.round(sel.xRel * canvas.width),
          Math.round(sel.yRel * canvas.height),
          pw, ph,
          0, 0, pw, ph
        )

        results.push({
          questionNumber: sel.questionNumber,
          role: sel.role,
          dataUrl: cropCanvas.toDataURL('image/png'),
        })
      }
    }

    setSaving(false)
    onSave(results)
  }

  const pageSelections = selections.filter(s => s.page === currentPage)

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#0F172A' }}>

      {/* Barra superior */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b shrink-0 gap-4"
        style={{ borderColor: '#1E293B' }}
      >
        <div className="flex items-center gap-2">
          {/* Logo/título */}
          <div className="flex items-center gap-2 mr-3">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: '#6366F1' }}>
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-white">Anotar PDF</span>
          </div>

          {/* Navegação */}
          <button
            onClick={() => goToPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1 || loading}
            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >←</button>
          <span className="text-sm text-slate-400 whitespace-nowrap">
            Página <span className="text-white font-medium">{currentPage}</span> / {totalPages || '…'}
          </span>
          <button
            onClick={() => goToPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages || loading}
            className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >→</button>
          <span className="text-[10px] text-slate-600 ml-2">Ctrl+Scroll para zoom · {zoom}vh</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={selections.length === 0 || saving || loading}
            className="px-3 py-1.5 rounded text-xs font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
            style={{ background: '#6366F1' }}
          >
            {saving ? 'Salvando...' : `Salvar ${selections.length} seleção(ões)`}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs font-semibold text-slate-400 hover:text-white border transition"
            style={{ borderColor: '#334155', background: 'transparent' }}
          >
            Cancelar
          </button>
        </div>
      </div>

      {/* Corpo */}
      <div className="flex flex-1 overflow-hidden">

        {/* Área do PDF */}
        <div
          ref={pdfAreaRef}
          className="flex-1 overflow-auto flex items-start justify-center p-4"
          style={{ background: '#020617' }}
        >
          {loading ? (
            <div className="text-slate-400 text-sm mt-20">Carregando PDF...</div>
          ) : (
            <div
              ref={containerRef}
              className="relative select-none"
              style={{ cursor: 'crosshair' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                if (dragging) {
                  setDragging(false)
                  setLiveRect(null)
                  setStartPos(null)
                }
              }}
            >
              {pageDataUrl ? (
                <img
                  key={currentPage}
                  src={pageDataUrl}
                  alt={`Página ${currentPage}`}
                  draggable={false}
                  style={{ height: `${zoom}vh`, width: 'auto' }}
                  className="pointer-events-none block"
                />
              ) : (
                <div
                  className="flex items-center justify-center text-slate-500 text-sm"
                  style={{ height: `${zoom}vh`, width: '60vw' }}
                >
                  Renderizando página...
                </div>
              )}

              {/* Retângulo durante drag */}
              {dragging && liveRect && Math.abs(liveRect.wRel) > 0.005 && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    border: '2px solid #6366F1',
                    background: 'rgba(99,102,241,0.1)',
                    left: `${Math.min(liveRect.xRel, liveRect.xRel + liveRect.wRel) * 100}%`,
                    top: `${Math.min(liveRect.yRel, liveRect.yRel + liveRect.hRel) * 100}%`,
                    width: `${Math.abs(liveRect.wRel) * 100}%`,
                    height: `${Math.abs(liveRect.hRel) * 100}%`,
                  }}
                />
              )}

              {/* Retângulo pendente (amarelo) */}
              {pendingRect && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    border: '2px solid #FACC15',
                    background: 'rgba(250,204,21,0.1)',
                    left: `${pendingRect.xRel * 100}%`,
                    top: `${pendingRect.yRel * 100}%`,
                    width: `${pendingRect.wRel * 100}%`,
                    height: `${pendingRect.hRel * 100}%`,
                  }}
                />
              )}

              {/* Seleções confirmadas desta página */}
              {pageSelections.map(sel => (
                <div
                  key={sel.id}
                  className="absolute"
                  style={{
                    border: `2px solid ${ROLE_COLORS[sel.role]}`,
                    left: `${sel.xRel * 100}%`,
                    top: `${sel.yRel * 100}%`,
                    width: `${sel.wRel * 100}%`,
                    height: `${sel.hRel * 100}%`,
                  }}
                >
                  <button
                    onClick={() => removeSelection(sel.id)}
                    className="absolute -top-5 left-0 text-[10px] px-1.5 py-0.5 text-white rounded whitespace-nowrap leading-none"
                    style={{ background: ROLE_COLORS[sel.role] }}
                  >
                    Q{sel.questionNumber} {sel.role === 'stem' ? 'Enunciado' : sel.role} ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Painel direito */}
        <div
          className="w-60 shrink-0 border-l flex flex-col"
          style={{ borderColor: '#1E293B', background: '#0F172A' }}
        >
          {/* Form de confirmação */}
          {pendingRect && (
            <div className="p-4 border-b" style={{ borderColor: '#1E293B' }}>
              <p className="text-xs font-medium text-slate-100 mb-3">Identificar seleção</p>
              <div className="mb-3">
                <label className="text-[11px] text-slate-500 block mb-1">Questão</label>
                <input
                  type="number"
                  value={pendingQn}
                  onChange={e => setPendingQn(e.target.value)}
                  min={1}
                  autoFocus
                  className="w-full rounded px-2 py-1.5 text-sm text-white focus:outline-none"
                  style={{ background: '#1E293B', border: '1px solid #334155' }}
                />
              </div>
              <div className="mb-4">
                <label className="text-[11px] text-slate-500 block mb-1">Papel</label>
                <select
                  value={pendingRole}
                  onChange={e => setPendingRole(e.target.value)}
                  className="w-full rounded px-2 py-1.5 text-sm text-white focus:outline-none"
                  style={{ background: '#1E293B', border: '1px solid #334155' }}
                >
                  <option value="stem">Enunciado</option>
                  <option value="A">Alternativa A</option>
                  <option value="B">Alternativa B</option>
                  <option value="C">Alternativa C</option>
                  <option value="D">Alternativa D</option>
                  <option value="E">Alternativa E</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleConfirm}
                  className="flex-1 rounded text-xs font-semibold text-white py-1.5 transition"
                  style={{ background: '#6366F1' }}
                >
                  Confirmar
                </button>
                <button
                  onClick={() => setPendingRect(null)}
                  className="rounded text-xs font-semibold text-slate-400 hover:text-white py-1.5 px-3 border transition"
                  style={{ borderColor: '#334155', background: 'transparent' }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Lista de seleções */}
          <div className="flex-1 overflow-y-auto p-3">
            {selections.length === 0 ? (
              <p className="text-[11px] text-slate-600 text-center mt-10 leading-relaxed">
                Arraste sobre a imagem<br />para selecionar uma região
              </p>
            ) : (
              <>
                <p className="text-[11px] text-slate-500 mb-2">
                  {selections.length} seleção(ões) no total
                </p>
                <div className="space-y-1">
                  {[...selections]
                    .sort((a, b) => a.questionNumber - b.questionNumber || a.page - b.page)
                    .map(sel => (
                      <div
                        key={sel.id}
                        className="flex items-center justify-between rounded px-2 py-1.5 text-[11px]"
                        style={{
                          background: ROLE_COLORS[sel.role] + '20',
                          borderLeft: `3px solid ${ROLE_COLORS[sel.role]}`,
                        }}
                      >
                        <span className="text-slate-100">
                          Q{sel.questionNumber}{' '}
                          <span className="text-slate-400">
                            {sel.role === 'stem' ? 'Enunciado' : `Alt. ${sel.role}`}
                          </span>
                          <span className="text-slate-600 ml-1">p.{sel.page}</span>
                        </span>
                        <button
                          onClick={() => removeSelection(sel.id)}
                          className="text-slate-600 hover:text-red-400 ml-2 leading-none"
                        >×</button>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>

          {!pendingRect && (
            <div className="p-3 border-t" style={{ borderColor: '#1E293B' }}>
              <p className="text-[10px] text-slate-700">
                Clique e arraste para criar uma seleção. Confirme com questão e papel.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
