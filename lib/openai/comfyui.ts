// #190: 로컬 ComfyUI 이미지 생성 — 개발 테스트 전용 POC. IMAGE_PROVIDER=comfyui 일 때만 쓴다.
//
// P0 판정·발표·10-14 이후 최종 회귀는 OpenAI 기본 설정이다. 이 경로의 그림으로 합격해도
// 발표 경로에서 합격한다는 보장이 없다(#190 QA 인정 범위).
//
// OpenAI 경로와 다른 점 — 검증 기록을 읽을 때 같이 봐야 한다:
//   - 체이닝이 없다. continueFrom 을 받아도 앞 컷을 이어받지 못하고, 인물 동일성은
//     매 컷 반복되는 cast[].description 문장에만 기댄다(PRD 2절의 방어선 중 하나만 남음).
//   - 캐릭터 시트를 reference 이미지로 넣지 않는다(IP-Adapter 같은 노드 없이 text→image).
//   - 글자·말풍선 억제는 negative prompt 로 한다.
//   - SDXL 의 CLIP 은 한국어를 거의 못 읽는다. 그래서 프롬프트에 한글이 있으면 그 프롬프트만
//     OpenAI 텍스트 모델(기본 gpt-4o-mini)로 영어로 옮긴 뒤 그린다(toEnglishPrompt). 그림은
//     로컬에서 그리고, OpenAI 로 가는 것은 이 번역 호출 하나뿐이다. 말풍선 대사는 원래
//     프롬프트에 없으므로(PRD 6절) 번역과 무관하게 한국어 그대로다.
//
// COMFYUI_URL 에 닿지 않으면 OpenAI 로 조용히 넘어가지 않고 던진다(스텁 3규칙 ②).
// "로컬로 돌린 줄 알았는데 유료로 나가는" 실패가 가장 비싸다.
import OpenAI from 'openai'

export const COMFYUI_URL_ENV = 'COMFYUI_URL'

// 모델 파일 이름은 ComfyUI 의 models/ 폴더 기준이다. 바꾸려면 env 로 덮는다 — POC 라
// 노드 구성까지 열지는 않는다.
const CHECKPOINT = process.env.COMFYUI_CHECKPOINT ?? 'sd_xl_base_1.0.safetensors'
const LORA = process.env.COMFYUI_LORA ?? 'sdxl_lightning_8step_lora.safetensors'

// SDXL-Lightning 8-step 권장값: 8 step · CFG 1 · euler · sgm_uniform.
const STEPS = 8
const CFG = 1
const SAMPLER = 'euler'
const SCHEDULER = 'sgm_uniform'

// 게이트 2(말풍선·글자 억제)를 negative 로 건다. 긍정 프롬프트의 "No speech bubbles…"
// 문장은 OpenAI 와 같은 프롬프트를 쓰려고 그대로 두지만, CLIP 계열은 부정문을 잘 못
// 읽어서 이쪽이 실제로 막는 역할을 한다.
const NEGATIVE =
  'text, letters, words, typography, caption, speech bubble, word balloon, watermark, signature, logo, ' +
  'multiple panels, comic page, panel border, split frame, collage, ' +
  'chart, graph, diagram, arrow, label, lowres, blurry, deformed hands, extra fingers'

const POLL_INTERVAL_MS = 1000
// 한 장 대기 상한. 1장 90초 기준은 통과 조건이 아니라 기록 항목이라(#190 10-01),
// 여기서는 멈춘 큐를 영원히 기다리지 않을 만큼만 넉넉히 둔다. 대기 시간은 요청을 넣은 때부터
// 세므로 표지 3안처럼 줄 서 있는 시간도 포함된다. Z-Image 처럼 느린 모델은 COMFYUI_TIMEOUT_MS 로
// 늘린다(#190 10-02 시민님 의견). 비우면 5분.
function comfyuiTimeoutMs(): number {
  const raw = process.env.COMFYUI_TIMEOUT_MS?.trim()
  if (!raw) return 5 * 60 * 1000
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`COMFYUI_TIMEOUT_MS=${raw} 는 0보다 큰 밀리초 숫자여야 합니다`)
  return n
}

export function comfyuiBaseUrl(): string {
  const raw = process.env[COMFYUI_URL_ENV]?.trim()
  if (!raw) {
    throw new Error(`IMAGE_PROVIDER=comfyui 인데 ${COMFYUI_URL_ENV} 가 비어 있습니다 — 예: http://127.0.0.1:8188`)
  }
  return raw.replace(/\/+$/, '')
}

async function comfyFetch(base: string, path: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${base}${path}`, init)
  } catch (e) {
    throw new Error(`ComfyUI(${base})에 연결하지 못했습니다 — 서버가 켜져 있는지 확인하세요. OpenAI 로 넘어가지 않습니다: ${String(e)}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ComfyUI ${path} 응답 ${res.status}: ${body.slice(0, 300)}`)
  }
  return res
}

// #190(10-02): 어떤 모델로 그릴지. sdxl 은 CLIP 이라 한국어를 못 읽어 번역·정리를 거치고,
// zimage(Z-Image-Turbo)는 텍스트 인코더가 Qwen3-4B 라 한국어 프롬프트를 그대로 넣는다(시민님
// #222 의견). 모르는 값은 던진다 — 오타가 조용히 sdxl 로 떨어지면 번역 비용이 몰래 붙는다.
export const COMFYUI_MODEL_ENV = 'COMFYUI_MODEL'
const COMFYUI_MODELS = ['sdxl', 'zimage'] as const
export type ComfyuiModel = (typeof COMFYUI_MODELS)[number]

export function comfyuiModel(): ComfyuiModel {
  const raw = process.env[COMFYUI_MODEL_ENV]?.trim().toLowerCase()
  if (!raw) return 'sdxl'
  if ((COMFYUI_MODELS as readonly string[]).includes(raw)) return raw as ComfyuiModel
  throw new Error(`${COMFYUI_MODEL_ENV}=${raw} 는 모르는 값입니다 — ${COMFYUI_MODELS.join(' | ')} 중 하나로 두거나 비워 두세요`)
}

// Z-Image-Turbo 공식 템플릿(comfyui_workflow_templates image_z_image_turbo.json) 값 그대로다:
// Qwen3-4B(lumina2 타입) · ModelSamplingAuraFlow shift 3 · 8 step · CFG 1 · res_multistep/simple.
// CFG 1 이라 negative 가 효과가 없어 템플릿처럼 ConditioningZeroOut 을 넣는다. 글자·말풍선 억제는
// 프롬프트 문장("No speech bubbles…")이 맡는다 — Qwen 은 부정문을 읽으므로 지우지 않는다.
const ZIMAGE = {
  unet: process.env.COMFYUI_ZIMAGE_UNET ?? 'z_image_turbo_bf16.safetensors',
  clip: process.env.COMFYUI_ZIMAGE_CLIP ?? 'qwen_3_4b.safetensors',
  vae: process.env.COMFYUI_ZIMAGE_VAE ?? 'ae.safetensors',
}

// 10-02 실측: 공식 설정 그대로면 4컷 모두 말풍선 안에 한국어 소재 문장을 써 넣었다(Z-Image 는
// 글자를 잘 그리는 모델이다). 억제 방법 두 가지를 env 로 켜고 끈다 — POC 라 고정하지 않는다.
//   COMFYUI_ZIMAGE_PROMPT=strip : 부정 지시 문장·"comic panel" 을 뺀다(stripNegations). 한글은 둔다
//   COMFYUI_ZIMAGE_CFG=<1보다 큰 수> : negative(ZIMAGE_NEGATIVE)를 켠다. 1장 시간이 약 2배가 된다
function zimageCfg(): number {
  const raw = process.env.COMFYUI_ZIMAGE_CFG?.trim()
  if (!raw) return 1
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) throw new Error(`COMFYUI_ZIMAGE_CFG=${raw} 는 1 이상의 숫자여야 합니다`)
  return n
}
function zimageTranslate(): boolean {
  const raw = process.env.COMFYUI_ZIMAGE_TRANSLATE?.trim().toLowerCase()
  if (!raw || raw === 'off') return false
  if (raw === 'on') return true
  throw new Error(`COMFYUI_ZIMAGE_TRANSLATE=${raw} 는 모르는 값입니다 — on | off 중 하나로 두거나 비워 두세요`)
}

async function toZimagePrompt(prompt: string): Promise<string> {
  const translated = zimageTranslate() ? await toEnglishPrompt(prompt) : prompt
  return zimageStripPrompt() ? stripNegations(translated) : translated
}

function zimageStripPrompt(): boolean {
  const raw = process.env.COMFYUI_ZIMAGE_PROMPT?.trim().toLowerCase()
  if (!raw || raw === 'full') return false
  if (raw === 'strip') return true
  throw new Error(`COMFYUI_ZIMAGE_PROMPT=${raw} 는 모르는 값입니다 — full | strip 중 하나로 두거나 비워 두세요`)
}
const ZIMAGE_NEGATIVE =
  '말풍선, 글자, 텍스트, 자막, 캡션, 문장, 한글 글씨, speech bubble, word balloon, text, letters, words, caption, ' +
  'typography, watermark, signature, logo, multiple panels, comic page, panel border, split frame'

function buildZimageWorkflow(prompt: string, seed: number, width: number, height: number) {
  const cfg = zimageCfg()
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: ZIMAGE.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: ZIMAGE.clip, type: 'lumina2', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: ZIMAGE.vae } },
    '4': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3 } },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
    '6':
      cfg > 1
        ? { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: ZIMAGE_NEGATIVE } }
        : { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['5', 0] } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        model: ['4', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['7', 0],
        seed,
        steps: 8,
        cfg,
        sampler_name: 'res_multistep',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'cuttoon' } },
  }
}

function buildWorkflow(prompt: string, seed: number, width: number, height: number) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CHECKPOINT } },
    '2': {
      class_type: 'LoraLoader',
      inputs: { model: ['1', 0], clip: ['1', 1], lora_name: LORA, strength_model: 1, strength_clip: 1 },
    },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 1], text: prompt } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 1], text: NEGATIVE } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed,
        steps: STEPS,
        cfg: CFG,
        sampler_name: SAMPLER,
        scheduler: SCHEDULER,
        denoise: 1,
      },
    },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'cuttoon' } },
  }
}

type HistoryImage = { filename: string; subfolder: string; type: string }

const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/
const TRANSLATE_MODEL = process.env.COMFYUI_TRANSLATE_MODEL ?? 'gpt-4o-mini'

// 표지 3안은 같은 프롬프트로 동시에 세 번 불린다 — 번역 결과(Promise)를 프롬프트 문자열로
// 기억해 한 번만 번역한다. 실패한 번역은 지워서 다음 호출이 다시 시도하게 한다.
const translations = new Map<string, Promise<string>>()
const TRANSLATION_CACHE_MAX = 50

// 프롬프트의 한국어 부분(소재·cast 서술 등 사용자·LLM 입력)을 영어로 옮긴다. 한글이 없으면
// 호출하지 않는다. 실패하면 한글을 지운 채 그리지 않고 던진다 — 인물 정보가 빠진 그림을
// "성공"으로 돌려주면 동일성 문제가 조용히 숨는다(스텁 3규칙 ②).
export async function toEnglishPrompt(prompt: string): Promise<string> {
  if (!HANGUL.test(prompt)) return prompt
  const cached = translations.get(prompt)
  if (cached) return cached

  const job = (async () => {
    // 번역 한 번이 그림 대기 전체를 붙잡지 않게 짧게 끊는다(10-02 실측: 네트워크가 흔들릴 때
    // 기본값으로는 한참 매달렸다). 재시도는 SDK 기본(2회)을 따른다.
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000 })
    let out: string | undefined
    try {
      const res = await client.chat.completions.create({
        model: TRANSLATE_MODEL,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You translate prompts for an image generation model. Translate every non-English part into ' +
              'natural English and keep the parts that are already English exactly as they are. Keep hex color ' +
              'codes and numbers unchanged. Output only the translated prompt, with no notes or quotes.',
          },
          { role: 'user', content: prompt },
        ],
      })
      out = res.choices[0]?.message?.content?.trim()
    } catch (e) {
      throw new Error(`ComfyUI 프롬프트 번역(${TRANSLATE_MODEL}) 실패 — 한국어 서술 없이 그리지 않습니다: ${String(e)}`)
    }
    if (!out) throw new Error(`ComfyUI 프롬프트 번역(${TRANSLATE_MODEL}) 응답이 비어 있음`)
    console.info(`[image] comfyui translate model=${TRANSLATE_MODEL} chars=${prompt.length}→${out.length}`)
    return out
  })()

  if (translations.size >= TRANSLATION_CACHE_MAX) translations.clear()
  translations.set(prompt, job)
  job.catch(() => translations.delete(prompt))
  return job
}

// OpenAI 와 같은 프롬프트를 받되, CLIP 계열 텍스트 인코더에 넘기기 전에 부정 지시 문장을
// 뺀다. "No speech bubbles", "never draw charts…" 의 speech bubble·chart 같은 단어를 CLIP 은
// 부정이 아니라 "그 단어가 있다"로 읽어 오히려 그린다(10-02 POC 실측: 7장 중 2장에 말풍선·
// 글자). 금지 요소는 NEGATIVE 가 맡는다. OpenAI 경로의 프롬프트는 건드리지 않는다.
//
// 같은 이유로 "Single webtoon/comic panel" 의 comic panel 은 여러 칸짜리 만화 페이지를
// 불러온다(실측: 컷 4가 6칸 페이지로 나옴) — 한 장면 그림이라는 표현으로 바꾼다.
//
// 한글은 뺀다. SDXL 의 CLIP 은 한국어를 거의 못 읽고, 한글 토큰이 들어가면 그림 안에 알아볼
// 수 없는 글자·말풍선이 생겼다(실측: 한국어 소재·인물 서술로 3장 모두 말풍선). 정상 경로에서는
// toEnglishPrompt 가 먼저 영어로 옮기므로, 여기서는 번역에 남은 한글만 지우는 안전장치다.
export function stripNegations(prompt: string): string {
  return prompt
    .replace(/Single webtoon\/comic panel\./i, 'A single full-frame illustration of one scene, in a clean webtoon art style.')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/^(no|never|do not|don't)\b/i.test(s.trim()) && !/\bnever\b|\bnot\b|\bno text\b/i.test(s))
    .join(' ')
}

export function toClipPrompt(prompt: string): string {
  return stripNegations(prompt)
    .replace(/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// 프롬프트 하나로 이미지 1장을 만들어 base64 PNG 로 돌려준다. responseId 는 OpenAI 의
// previous_response_id 와 모양을 맞춘 식별자일 뿐 체이닝에는 쓰이지 않는다.
export async function generateWithComfyui(
  prompt: string,
  size: { width: number; height: number }
): Promise<{ base64: string; responseId: string; elapsedMs: number }> {
  const base = comfyuiBaseUrl()
  const started = Date.now()
  const model = comfyuiModel()
  const seed = Math.floor(Math.random() * 2 ** 32)
  const timeoutMs = comfyuiTimeoutMs()
  // zimage 는 한국어를 읽으므로 기본은 원문 그대로 보낸다. COMFYUI_ZIMAGE_TRANSLATE=on 이면 SDXL 과
  // 같은 번역을 거친다 — 원문을 그대로 넣으면 한국어 소재 문장을 말풍선 글자로 그렸다(10-02 실측).
  const workflow =
    model === 'zimage'
      ? buildZimageWorkflow(await toZimagePrompt(prompt), seed, size.width, size.height)
      : buildWorkflow(toClipPrompt(await toEnglishPrompt(prompt)), seed, size.width, size.height)

  const queued = await comfyFetch(base, '/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  })
  const { prompt_id: promptId } = (await queued.json()) as { prompt_id?: string }
  if (!promptId) throw new Error('ComfyUI /prompt 응답에 prompt_id 가 없음')

  let image: HistoryImage | undefined
  while (!image) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`ComfyUI 생성이 ${timeoutMs / 1000}초 안에 끝나지 않았습니다 (prompt_id ${promptId}) — 느린 모델이면 COMFYUI_TIMEOUT_MS 를 늘리세요`)
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const history = (await (await comfyFetch(base, `/history/${promptId}`)).json()) as Record<
      string,
      { status?: { status_str?: string; messages?: unknown[] }; outputs?: Record<string, { images?: HistoryImage[] }> }
    >
    const entry = history[promptId]
    if (!entry) continue
    if (entry.status?.status_str === 'error') {
      throw new Error(`ComfyUI 실행 실패 (prompt_id ${promptId}): ${JSON.stringify(entry.status.messages ?? []).slice(0, 300)}`)
    }
    image = Object.values(entry.outputs ?? {}).flatMap((o) => o.images ?? [])[0]
  }

  const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type })
  const png = Buffer.from(await (await comfyFetch(base, `/view?${query}`)).arrayBuffer())
  const elapsedMs = Date.now() - started
  // 1장 걸린 시간은 #190 기록 항목이다. 프로바이더 구분과 같이 로그에만 남긴다.
  console.info(`[image] comfyui model=${model} ${elapsedMs}ms prompt_id=${promptId} seed=${seed}`)
  return { base64: png.toString('base64'), responseId: `comfyui:${promptId}`, elapsedMs }
}
