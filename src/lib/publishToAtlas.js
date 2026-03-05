import { supabase } from './supabase'

const ADMIN_USER_ID = 'ac04c1d0-7534-4ce5-8399-722a655e4e93'
const BUCKET = 'question-images'

const AREA_MAP = {
  natureza:   'Ciências da Natureza e suas Tecnologias',
  humanas:    'Ciências Humanas e suas Tecnologias',
  linguagens: 'Linguagens, Códigos e suas Tecnologias',
  matematica: 'Matemática e suas Tecnologias',
  ingles:     'Linguagens, Códigos e suas Tecnologias',
  espanhol:   'Linguagens, Códigos e suas Tecnologias',
}

const IDIOMAS = ['ingles', 'espanhol']
const LETTERS  = ['A', 'B', 'C', 'D', 'E']

function extractYear(exam) {
  const match = exam?.match(/\d{4}/)
  return match ? parseInt(match[0]) : null
}

function base64ToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)[1]
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function uploadImagem(dataUrl, questionNumber, idx) {
  const blob = base64ToBlob(dataUrl)
  const ext  = blob.type.split('/')[1] || 'png'
  const path = `questao_${questionNumber}_img_${idx}.${ext}`

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: blob.type })

  if (error) throw new Error(`Upload falhou (${path}): ${error.message}`)

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path)
  return urlData.publicUrl
}

/**
 * Publica uma única questão no Supabase Atlas.
 * Retorna o registro inserido ou lança um erro.
 */
export async function publicarQuestao(question) {
  const year      = extractYear(question.exam)
  const areaCode  = question.area?.toLowerCase() || ''
  const area      = AREA_MAP[areaCode] || areaCode || null
  const idioma    = question.foreign_language || (IDIOMAS.includes(areaCode) ? areaCode : '') || ''

  // Monta statement com placeholders {{IMG_N}} e faz upload das imagens de conteúdo
  let statement = ''
  const imageUrls = []
  let imgIdx = 1

  for (const block of (question.content || [])) {
    if (block.type === 'text' && block.value?.trim()) {
      statement += block.value.trim() + '\n\n'
    } else if (block.type === 'image' && block.data) {
      const url = await uploadImagem(block.data, question.number, imgIdx)
      imageUrls.push(url)
      statement += `{{IMG_${imgIdx}}}\n\n`
      imgIdx++
    }
  }

  if (question.command?.trim()) {
    statement += question.command.trim()
  }

  statement = statement.trim()

  // Alternativas — converte para [{letter, text, image_url?}]
  const alternatives = []
  for (let i = 0; i < question.alternatives.length; i++) {
    const alt = question.alternatives[i]
    const altObj = {
      letter: LETTERS[i],
      text: typeof alt === 'string' ? alt : (alt?.text || ''),
    }
    if (typeof alt === 'object' && alt?.image) {
      altObj.image_url = await uploadImagem(alt.image, question.number, imgIdx)
      imgIdx++
    }
    alternatives.push(altObj)
  }

  const correctIndex  = typeof question.correct === 'number' ? question.correct : 0
  const correctAnswer = LETTERS[correctIndex] || 'A'

  const record = {
    user_id:        ADMIN_USER_ID,
    year,
    area,
    statement,
    images:         imageUrls,
    alternatives,
    correct_answer: correctAnswer,
    number:         parseInt(question.number) || null,
    foreign_language: idioma,
  }

  const { data, error } = await supabase
    .from('questions')
    .upsert(record, { onConflict: 'user_id,number,year,foreign_language' })
    .select()
    .single()

  if (error) throw new Error(`Erro ao salvar: ${error.message}`)
  return data
}
