// B①: 이미지 생성. provider.ts의 ImageProvider 계약 중 generateCut·generateCoverVariants를
// 담당한다 (generateCharacterSheet는 B②/extract.ts, #19 결정 — extractStyle과 결합도가 높음).
//
// #18: Responses API의 image_generation 내장 도구를 쓴다. previous_response_id로
// 체이닝하고(PRD 6절), 캐릭터 시트를 매 컷 reference 이미지로 함께 넣는다 — P0 스파이크
// 결론이 "체이닝만으로는 부족, 캐릭터 시트를 매번 넣어야 동일성이 유지된다"였다.
//
// 주의: image_generation 도구는 이미지 모델(gpt-image-*)을 top-level model로 직접
// 받지 않는다 — 텍스트 모델(예: gpt-5)을 지정하면 도구가 내부적으로 이미지 생성을
// 위임한다(OpenAI 공식 문서, 2026-08 확인). 정확한 모델 id는 실제 호출로 검증했다.
import OpenAI from 'openai'
import vocabulary from '@/spec/vocabulary.json'
import type { ImageProvider, GeneratedImageResult, ReservedZone } from './provider'
import { readAsset, uploadAsset } from '../asset-store'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const RESPONSES_MODEL = 'gpt-5'
const IMAGE_SIZE = '1024x1024'

// 출력 해상도는 1024x1024 고정. 컷툰은 1:1 비율이고, 같은 프롬프트가 호출마다
// 다른 크기를 내는 것을 실측으로 확인했으므로(1536x1024 / 1199x1312) 크기를
// 모델 기본값에 맡기지 않는다. 계약 ④가 요구하는 width/height 메타의 값이다.
//
// 1024 인 이유: gpt-image-1 계열은 1024x1024 / 1024x1536 / 1536x1024 세 가지만
// 받고, gpt-image-2 계열은 양변이 16의 배수여야 한다. 1024 는 양쪽 모두에서
// 유효한 유일한 정사각형 값이다(1080 은 16의 배수가 아니라 어느 쪽에서도 거부).
// 인스타그램은 320~1080px 를 원본 그대로 유지하므로 1024 도 손실이 없다.
export const OUTPUT_SIZE = { width: 1024, height: 1024 } as const

// storyboard/preset은 계약상 unknown이다(PRD 5절 — 정식 Storyboard/Preset 타입은
// 스키마 파생 전까지 화면마다 임시 타입을 따로 두지 않기로 함). 프롬프트 조립에
// 필요한 최소 필드만 여기서 안전하게 뽑아 쓴다.
interface MinimalCharacterInFrame {
  character_id?: string
  expression?: string
  pose?: string
}
interface MinimalCastMember {
  character_id?: string
  role?: string
  description?: string
}
interface MinimalCut {
  cut_index?: number
  narrative_beat?: string
  shot_type?: string
  camera_angle?: string
  time_of_day?: string
  reserved_zone?: ReservedZone
  characters_in_frame?: MinimalCharacterInFrame[]
  generated_image?: string | null
}
interface MinimalStoryboard {
  subject?: string
  cast?: MinimalCastMember[]
  cuts?: MinimalCut[]
}
interface MinimalPreset {
  style?: {
    line_weight?: string
    saturation?: string
    character_ratio?: string
    background_density?: string
  }
}

// "Leave the top edge empty" 로 쓰면 모델이 그림 위에 별도의 흰 띠를 붙인다 —
// codex 4회 검증에서 4장 중 3장이 하드 경계선이 있는 빈 블록을 만들었다. 의도는
// 프레임 안에서 그 구역을 비우는 것이므로, 배경이 그 구역을 그대로 통과해
// 이어져야 한다는 점을 명시한다.
function reservedZoneHint(zone: ReservedZone): string {
  const where = { top: 'upper', bottom: 'lower', left: 'left', right: 'right' }[zone]
  return (
    `Keep the ${where} part of the frame clear of the character and of any object, ` +
    `but the background must continue through it as a smooth gradient of the same scene — ` +
    `it is empty space inside the illustration, not a separate blank strip, not a white box, ` +
    `and there must be no panel border or dividing line. ` +
    `A speech bubble is composited there later.`
  )
}

// enum 토큰을 그대로 넣으면 모델이 못 알아듣는다 — codex 4회 검증에서
// "Shot type: closeup." 이 4/4 전신으로 나왔다. spec/vocabulary.json 의
// prompt_hints 가 각 enum 값의 영어 서술문을 갖고 있으므로 그것을 쓴다.
// 힌트가 없는 값은 토큰을 그대로 둬 정보가 사라지지 않게 한다.
const HINTS = vocabulary.prompt_hints as Record<string, Record<string, string> | undefined>

function hint(category: string, value?: string): string | undefined {
  if (!value) return undefined
  return HINTS[category]?.[value] ?? value
}

// 대사는 텍스트 레이어로 나중에 얹는다(PRD 6절) — 프롬프트에 caption 텍스트를
// 절대 포함하지 않는다. reserved_zone만 전달해 자리를 비워두게 한다.
function buildCutPrompt(storyboard: MinimalStoryboard, preset: MinimalPreset, cut?: MinimalCut): string {
  const s = preset.style
  // character_ratio 는 prompt_hints 에 아직 항목이 없다(spec/ 은 A① 소유).
  // 추가되면 hint() 가 자동으로 집어가므로 이 코드는 그대로 두면 된다.
  const styleStr = s
    ? `${s.line_weight ?? 'medium'} line weight, ${s.saturation ?? 'vivid'} colors, ${hint('character_ratio', s.character_ratio) ?? '2.5head'} body proportions, ${s.background_density ?? 'low'} background detail`
    : 'default webtoon/comic style'

  const parts = [
    `Single webtoon/comic panel, consistent with the attached character reference sheet.`,
    `Style: ${styleStr}.`,
    `Subject: ${storyboard.subject ?? 'a person dealing with an everyday situation'}.`,
  ]

  if (cut) {
    const shot = hint('shot_type', cut.shot_type)
    if (shot) parts.push(`Framing: ${shot}.`)
    const angle = hint('camera_angle', cut.camera_angle)
    if (angle) parts.push(`Camera: ${angle}.`)
    const time = hint('time_of_day', cut.time_of_day)
    if (time) parts.push(`Lighting: ${time}.`)

    // cast[].description 을 반드시 넣는다. 이것이 없으면 외형을 붙잡는 것이
    // reference 시트뿐이고, 시트가 없거나 약하면 나이·헤어·복장이 컷마다 바뀐다.
    // 실측: 서술 없이 4회 생성했을 때 "60대 어머니"가 4/4 어린아이로 나왔고
    // 헤어스타일·복장·복장색·화면 내 크기가 전부 달라졌다. 서술을 넣은 뒤
    // 4/4 로 정확히 나왔다.
    const castById = new Map(
      (storyboard.cast ?? []).filter((m) => m.character_id).map((m) => [m.character_id!, m])
    )
    for (const c of cut.characters_in_frame ?? []) {
      const desc = c.character_id ? castById.get(c.character_id)?.description : undefined
      const traits = [hint('expression', c.expression), hint('pose', c.pose)].filter(Boolean).join(', ')
      // 서술을 앞세운다 — 나이·성별 같은 정체성이 표정·포즈보다 먼저 고정돼야 한다.
      parts.push(desc ? `Character: ${desc}. ${traits}.` : `Character: ${traits || 'neutral expression, standing'}.`)
    }

    if (cut.reserved_zone) parts.push(reservedZoneHint(cut.reserved_zone))
  }

  parts.push('No speech bubbles. No text or lettering anywhere in the image — captions are composited separately afterward.')

  return parts.join(' ')
}

// 다음에 생성해야 할 컷 = generated_image가 아직 없는 것 중 cut_index가 가장 앞선 컷.
// 인터페이스가 "지금 몇 번째 컷인지"를 별도 파라미터로 받지 않으므로(계약을 provider
// 중립으로 유지하기 위해 storyboard 하나로 판단), 이 규약을 여기서 정한다 — 호출부는
// storyboard.cuts[].generated_image를 채운 뒤 다시 넘기는 방식으로 다음 컷을 요청한다.
function nextUngeneratedCut(cuts?: MinimalCut[]): MinimalCut | undefined {
  return cuts?.find((c) => !c.generated_image)
}

async function toInputImages(referenceAssets: unknown[]): Promise<Array<{ type: 'input_image'; image_url: string }>> {
  const uris = referenceAssets.filter((a): a is string => typeof a === 'string')
  const images: Array<{ type: 'input_image'; image_url: string }> = []
  for (const uri of uris) {
    const buf = await readAsset(uri)
    if (!buf) continue
    images.push({ type: 'input_image', image_url: `data:image/png;base64,${buf.toString('base64')}` })
  }
  return images
}

async function callImageGeneration(
  prompt: string,
  referenceAssets: unknown[],
  previousResponseId?: string
): Promise<{ base64: string; responseId: string }> {
  const inputImages = await toInputImages(referenceAssets)

  // openai SDK(^7.5.0)의 Responses 타입이 image_generation 도구 옵션을 아직 못
  // 따라와 as any로 우회한다 — 실제 호출로 요청/응답 모양을 검증했다 (#18).
  const response = await client.responses.create({
    model: RESPONSES_MODEL,
    previous_response_id: previousResponseId,
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: prompt }, ...inputImages],
      },
    ],
    tools: [{ type: 'image_generation', size: IMAGE_SIZE }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  const output = (response as { output?: unknown[] }).output ?? []
  const imageCall = output.find(
    (o): o is { type: string; result?: string } =>
      typeof o === 'object' && o !== null && (o as { type?: unknown }).type === 'image_generation_call'
  )

  if (!imageCall?.result) {
    throw new Error('이미지 생성 응답에 image_generation_call 결과가 없음')
  }

  return { base64: imageCall.result, responseId: (response as { id: string }).id }
}

export const generateCut: ImageProvider['generateCut'] = async (input) => {
  const storyboard = (input.storyboard ?? {}) as MinimalStoryboard
  const preset = (input.preset ?? {}) as MinimalPreset
  const cut = nextUngeneratedCut(storyboard.cuts)

  const prompt = buildCutPrompt(storyboard, preset, cut)
  const { base64, responseId } = await callImageGeneration(prompt, input.referenceAssets, input.continueFrom)

  const buffer = Buffer.from(base64, 'base64')
  const { assetUri } = await uploadAsset(buffer, 'cut.png')

  return {
    asset: assetUri,
    ...OUTPUT_SIZE,
    reserved_zone: cut?.reserved_zone,
    continuationToken: responseId,
  }
}

// 표지 3안. 독립 호출이므로 체이닝 토큰을 받지 않는다(PRD 6절) — 세션에 누적하면
// 2안이 1안에 끌려가 서로 비슷해지기 때문. 3개를 병렬로 호출한다.
export const generateCoverVariants: ImageProvider['generateCoverVariants'] = async (input) => {
  const storyboard = (input.storyboard ?? {}) as MinimalStoryboard
  const preset = (input.preset ?? {}) as MinimalPreset
  const cut = storyboard.cuts?.[0]
  const prompt = buildCutPrompt(storyboard, preset, cut)

  const variants = await Promise.all(
    Array.from({ length: input.count }, async (): Promise<GeneratedImageResult> => {
      const { base64, responseId } = await callImageGeneration(prompt, input.referenceAssets)
      const buffer = Buffer.from(base64, 'base64')
      const { assetUri } = await uploadAsset(buffer, 'cover.png')
      return {
        asset: assetUri,
        ...OUTPUT_SIZE,
        reserved_zone: cut?.reserved_zone,
        continuationToken: responseId,
      }
    })
  )

  return variants
}
