import { useState, useRef } from 'react'

const CADERNOS = ['Azul', 'Amarelo', 'Rosa', 'Branco']
const NIVEL_ICON = {
  ok:     { icon: '✓', color: 'text-emerald-500' },
  warn:   { icon: '⚠', color: 'text-amber-500'  },
  erro:   { icon: '✗', color: 'text-red-500'    },
  titulo: { icon: '▶', color: 'text-violet-500' },
  info:   { icon: '→', color: 'text-slate-400'  },
}

function fmt(n) { return n?.toLocaleString('pt-BR') ?? '—' }

// fase: 'config' | 'rodando' | 'concluido' | 'erro'
export default function PDFImporter({ onImport, onPartialUpdate, onClose }) {
  const [pdf, setPdf]             = useState(null)
  const [gabarito, setGabarito]   = useState(null)
  const [ano, setAno]             = useState(new Date().getFullYear())
  const [dia, setDia]             = useState(1)
  const [caderno, setCaderno]     = useState('Azul')
  const [fase, setFase]                       = useState('config')
  const [concluido, setConcluido]             = useState(null)
  const [relatorio, setRelatorio]             = useState(null)
  const [logs, setLogs]                       = useState([])
  const [progresso, setProgresso]             = useState(0)
  const [arrastando, setArrastando]           = useState(false)
  const [minimizado, setMinimizado]           = useState(false)
  const [questoesEncontradas, setQuestoesEncontradas] = useState(0)

  const pdfInput      = useRef(null)
  const gabaritoInput = useRef(null)
  const logsRef       = useRef(null)
  // ref para evitar que onerror dispare depois do done (stale closure bug)
  const doneRef       = useRef(false)

  function adicionarLog(msg, nivel = 'info') {
    setLogs(prev => [...prev, { msg, nivel, id: Date.now() + Math.random() }])
    setTimeout(() => {
      if (logsRef.current)
        logsRef.current.scrollTop = logsRef.current.scrollHeight
    }, 50)
  }

  function handleDrop(e) {
    e.preventDefault()
    setArrastando(false)
    const file = e.dataTransfer.files[0]
    if (file?.type === 'application/pdf') setPdf(file)
  }

  function resetar() {
    setFase('config')
    setLogs([])
    setProgresso(0)
    setConcluido(null)
    setRelatorio(null)
    setMinimizado(false)
    setQuestoesEncontradas(0)
    doneRef.current = false
  }

  async function iniciarExtracao() {
    if (!pdf) return
    doneRef.current = false
    setFase('rodando')
    setLogs([])
    setProgresso(0)
    setConcluido(null)
    setRelatorio(null)

    const form = new FormData()
    form.append('pdf', pdf)
    form.append('ano', ano)
    form.append('dia', dia)
    form.append('caderno', caderno)
    if (gabarito) form.append('gabarito', gabarito)

    let jobId
    try {
      const res = await fetch('http://localhost:8000/extrair', {
        method: 'POST',
        body: form,
      })
      if (!res.ok) throw new Error(`Erro ao enviar PDF: ${res.status}`)
      const data = await res.json()
      jobId = data.job_id
    } catch {
      adicionarLog('Não foi possível conectar ao servidor. Certifique-se de que o servidor está rodando (python extrator/server.py)', 'erro')
      setFase('erro')
      return
    }

    adicionarLog(`Job iniciado. Processando ENEM ${ano} – Dia ${dia} – Caderno ${caderno}`, 'titulo')

    const es = new EventSource(`http://localhost:8000/progresso/${jobId}`)

    es.onmessage = (e) => {
      const evento = JSON.parse(e.data)

      if (evento.tipo === 'log') {
        adicionarLog(evento.msg, evento.nivel)
        const match = evento.msg.match(/Página (\d+)\/(\d+)/)
        if (match) {
          const atual = parseInt(match[1])
          const total = parseInt(match[2])
          setProgresso(Math.round((atual / total) * 90))
        }
      } else if (evento.tipo === 'partial') {
        setQuestoesEncontradas(evento.questoes.length)
        if (onPartialUpdate) onPartialUpdate(evento.questoes)
      } else if (evento.tipo === 'done') {
        doneRef.current = true
        es.close()
        setProgresso(100)
        adicionarLog(`${evento.questoes.length} questões extraídas com sucesso!`, 'ok')
        setConcluido(evento.questoes)
        if (evento.relatorio) setRelatorio(evento.relatorio)
        setFase('concluido')
      } else if (evento.tipo === 'erro') {
        doneRef.current = true
        es.close()
        adicionarLog(evento.msg, 'erro')
        setFase('erro')
      }
    }

    es.onerror = () => {
      // Ignorar se já recebemos done/erro normalmente
      if (doneRef.current) return
      es.close()
      adicionarLog('Conexão com o servidor perdida.', 'erro')
      setFase('erro')
    }
  }

  const mostraLogs = fase !== 'config'

  // Banner minimizado — flutuante no canto inferior direito
  if (minimizado && fase === 'rodando') {
    return (
      <div
        onClick={() => setMinimizado(false)}
        className="fixed bottom-5 right-5 z-50 bg-white rounded-2xl shadow-xl border border-slate-200 px-4 py-3 flex items-center gap-3 cursor-pointer hover:shadow-2xl transition-shadow max-w-xs"
      >
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center flex-shrink-0 animate-pulse">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-slate-700">Importando PDF…</p>
          <p className="text-xs text-slate-400 truncate">
            {questoesEncontradas > 0 ? `${questoesEncontradas} questões encontradas` : 'Processando…'}
          </p>
          <div className="h-1 bg-slate-100 rounded-full overflow-hidden mt-1.5">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-500"
              style={{ width: `${progresso}%` }}
            />
          </div>
        </div>
        <span className="text-xs font-semibold text-violet-600 flex-shrink-0">Expandir ↑</span>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 leading-none">Importar PDF da Prova</h2>
              <p className="text-xs text-slate-400 mt-0.5">Extração automática com GPT-4o</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {fase === 'rodando' && (
              <button
                onClick={() => setMinimizado(true)}
                title="Minimizar"
                className="text-slate-400 hover:text-slate-600 transition p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </button>
            )}
            {fase !== 'rodando' && (
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto">

          {/* Formulário de configuração */}
          {fase === 'config' && (
            <>
              <div
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setArrastando(true) }}
                onDragLeave={() => setArrastando(false)}
                onClick={() => pdfInput.current.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed transition flex flex-col items-center justify-center gap-2 py-6 ${
                  arrastando ? 'border-violet-400 bg-violet-50' :
                  pdf ? 'border-emerald-400 bg-emerald-50' :
                  'border-slate-200 bg-slate-50 hover:border-violet-300 hover:bg-violet-50'
                }`}
              >
                {pdf ? (
                  <>
                    <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm font-semibold text-emerald-700">{pdf.name}</p>
                    <p className="text-xs text-emerald-500">{(pdf.size / 1024 / 1024).toFixed(1)} MB — clique para trocar</p>
                  </>
                ) : (
                  <>
                    <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm font-medium text-slate-500">Arraste o PDF aqui ou clique para selecionar</p>
                    <p className="text-xs text-slate-400">PDF da prova do ENEM</p>
                  </>
                )}
              </div>
              <input ref={pdfInput} type="file" accept=".pdf" className="hidden"
                onChange={e => setPdf(e.target.files[0] || null)} />

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Ano</label>
                  <input type="number" min={2009} max={2030}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent"
                    value={ano} onChange={e => setAno(Number(e.target.value))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Dia</label>
                  <select
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent bg-white"
                    value={dia} onChange={e => setDia(Number(e.target.value))}>
                    <option value={1}>1º Dia</option>
                    <option value={2}>2º Dia</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Caderno</label>
                  <select
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent bg-white"
                    value={caderno} onChange={e => setCaderno(e.target.value)}>
                    {CADERNOS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Gabarito <span className="normal-case font-normal text-slate-400">(opcional)</span>
                </label>
                <div
                  onClick={() => gabaritoInput.current.click()}
                  className={`cursor-pointer rounded-xl border border-dashed px-3 py-2.5 flex items-center gap-2 transition ${
                    gabarito
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-slate-200 bg-slate-50 hover:border-violet-300 hover:bg-violet-50'
                  }`}
                >
                  <svg className={`w-4 h-4 flex-shrink-0 ${gabarito ? 'text-emerald-500' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {gabarito ? (
                    <div className="flex items-center justify-between flex-1 min-w-0">
                      <span className="text-xs font-medium text-emerald-700 truncate">{gabarito.name}</span>
                      <button
                        onClick={e => { e.stopPropagation(); setGabarito(null) }}
                        className="text-xs text-slate-400 hover:text-red-500 ml-2 flex-shrink-0 transition"
                      >remover</button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Clique para selecionar o PDF ou .txt do gabarito</span>
                  )}
                </div>
                <input ref={gabaritoInput} type="file" accept=".pdf,.txt" className="hidden"
                  onChange={e => setGabarito(e.target.files[0] || null)} />
              </div>
            </>
          )}

          {/* Progresso + Logs (visível durante extração, concluído e erro) */}
          {mostraLogs && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-500">Progresso</span>
                <span className="text-xs font-bold text-violet-600">{progresso}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-4">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    fase === 'erro'
                      ? 'bg-red-400'
                      : 'bg-gradient-to-r from-violet-500 to-purple-500'
                  }`}
                  style={{ width: `${progresso}%` }}
                />
              </div>

              <div
                ref={logsRef}
                className="h-56 overflow-y-auto rounded-xl bg-slate-950 p-3 font-mono text-xs flex flex-col gap-1"
              >
                {logs.map(log => {
                  const { icon, color } = NIVEL_ICON[log.nivel] || NIVEL_ICON.info
                  return (
                    <div key={log.id} className="flex items-start gap-1.5">
                      <span className={`${color} flex-shrink-0 mt-px`}>{icon}</span>
                      <span className="text-slate-300 leading-relaxed">{log.msg}</span>
                    </div>
                  )
                })}
                {logs.length === 0 && (
                  <span className="text-slate-600">Iniciando extração...</span>
                )}
              </div>

              {/* Relatório de custo — aparece quando concluído */}
              {fase === 'concluido' && relatorio && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider mb-3">Relatório de uso</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-white rounded-lg px-3 py-2 border border-emerald-100">
                      <span className="text-slate-400 block mb-0.5">Questões</span>
                      <span className="font-bold text-slate-800 text-sm">{relatorio.n_questoes}</span>
                    </div>
                    <div className="bg-white rounded-lg px-3 py-2 border border-emerald-100">
                      <span className="text-slate-400 block mb-0.5">Custo estimado</span>
                      <span className="font-bold text-emerald-700 text-sm">${relatorio.custo_total.toFixed(4)} USD</span>
                    </div>
                    <div className="bg-white rounded-lg px-3 py-2 border border-emerald-100">
                      <span className="text-slate-400 block mb-0.5">Tokens entrada</span>
                      <span className="font-semibold text-slate-700">{fmt(relatorio.total_input)}</span>
                    </div>
                    <div className="bg-white rounded-lg px-3 py-2 border border-emerald-100">
                      <span className="text-slate-400 block mb-0.5">Tokens saída</span>
                      <span className="font-semibold text-slate-700">{fmt(relatorio.total_output)}</span>
                    </div>
                  </div>
                  <div className="mt-2 bg-white rounded-lg px-3 py-2 border border-emerald-100 flex items-center justify-between">
                    <span className="text-xs text-slate-400">Total de tokens</span>
                    <span className="text-xs font-bold text-slate-700">{fmt((relatorio.total_input || 0) + (relatorio.total_output || 0))}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — config */}
        {fase === 'config' && (
          <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              Certifique-se de que o servidor está rodando:<br/>
              <code className="text-slate-600 font-mono">python extrator/server.py</code>
            </p>
            <button
              onClick={iniciarExtracao}
              disabled={!pdf}
              className="flex-shrink-0 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-bold shadow hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Extrair questões
            </button>
          </div>
        )}

        {/* Footer — erro */}
        {fase === 'erro' && (
          <div className="px-5 py-4 border-t border-red-100 bg-red-50 flex items-center justify-between gap-3">
            <p className="text-xs text-red-600 font-medium">Extração falhou. Veja os logs acima.</p>
            <button
              onClick={resetar}
              className="flex-shrink-0 px-5 py-2.5 rounded-xl bg-red-500 text-white text-sm font-bold shadow hover:shadow-md transition"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Footer — concluído */}
        {fase === 'concluido' && concluido && (
          <div className="px-5 py-4 border-t border-emerald-100 bg-emerald-50 flex items-center justify-between gap-3">
            <p className="text-xs text-emerald-700 font-medium">
              {concluido.length} questões prontas para edição.
            </p>
            <button
              onClick={() => { onImport(concluido); onClose() }}
              className="flex-shrink-0 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-bold shadow hover:shadow-md transition"
            >
              Abrir questões →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
