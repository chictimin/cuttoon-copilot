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
//
// COMFYUI_URL 에 닿지 않으면 OpenAI 로 조용히 넘어가지 않고 던진다(스텁 3규칙 ②).
// "로컬로 돌린 줄 알았는데 유료로 나가는" 실패가 가장 비싸다.
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
// 여기서는 멈춘 큐를 영원히 기다리지 않을 만큼만 넉넉히 둔다.
const TIMEOUT_MS = 5 * 60 * 1000

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

// OpenAI 와 같은 프롬프트를 받되, CLIP 계열 텍스트 인코더에 넘기기 전에 부정 지시 문장을
// 뺀다. "No speech bubbles", "never draw charts…" 의 speech bubble·chart 같은 단어를 CLIP 은
// 부정이 아니라 "그 단어가 있다"로 읽어 오히려 그린다(10-02 POC 실측: 7장 중 2장에 말풍선·
// 글자). 금지 요소는 NEGATIVE 가 맡는다. OpenAI 경로의 프롬프트는 건드리지 않는다.
//
// 같은 이유로 "Single webtoon/comic panel" 의 comic panel 은 여러 칸짜리 만화 페이지를
// 불러온다(실측: 컷 4가 6칸 페이지로 나옴) — 한 장면 그림이라는 표현으로 바꾼다.
//
// 한글은 뺀다. SDXL 의 CLIP 은 한국어를 거의 못 읽고, 한글 토큰이 들어가면 그림 안에 알아볼
// 수 없는 글자·말풍선이 생겼다(실측: 한국어 소재·인물 서술로 3장 모두 말풍선). 대신 한국어로만
// 적힌 소재·인물 정보는 사라진다 — 이 경로의 알려진 한계다(#190 기록).
export function toClipPrompt(prompt: string): string {
  return prompt
    .replace(/Single webtoon\/comic panel\./i, 'A single full-frame illustration of one scene, in a clean webtoon art style.')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/^(no|never|do not|don't)\b/i.test(s.trim()) && !/\bnever\b|\bnot\b|\bno text\b/i.test(s))
    .join(' ')
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
  const seed = Math.floor(Math.random() * 2 ** 32)

  const queued = await comfyFetch(base, '/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: buildWorkflow(toClipPrompt(prompt), seed, size.width, size.height) }),
  })
  const { prompt_id: promptId } = (await queued.json()) as { prompt_id?: string }
  if (!promptId) throw new Error('ComfyUI /prompt 응답에 prompt_id 가 없음')

  let image: HistoryImage | undefined
  while (!image) {
    if (Date.now() - started > TIMEOUT_MS) {
      throw new Error(`ComfyUI 생성이 ${TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다 (prompt_id ${promptId})`)
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
  console.info(`[image] comfyui ${elapsedMs}ms prompt_id=${promptId} seed=${seed}`)
  return { base64: png.toString('base64'), responseId: `comfyui:${promptId}`, elapsedMs }
}
