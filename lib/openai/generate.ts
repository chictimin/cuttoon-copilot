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
  expression?: string
  pose?: string
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

const RESERVED_ZONE_HINT: Record<ReservedZone, string> = {
  top: 'Leave the top edge of the frame empty and uncluttered — no character, object, or text there. A speech bubble will be placed there afterward.',
  bottom: 'Leave the bottom edge of the frame empty and uncluttered — no character, object, or text there. A speech bubble will be placed there afterward.',
  left: 'Leave the left edge of the frame empty and uncluttered — no character, object, or text there. A speech bubble will be placed there afterward.',
  right: 'Leave the right edge of the frame empty and uncluttered — no character, object, or text there. A speech bubble will be placed there afterward.',
}

// 대사는 텍스트 레이어로 나중에 얹는다(PRD 6절) — 프롬프트에 caption 텍스트를
// 절대 포함하지 않는다. reserved_zone만 전달해 자리를 비워두게 한다.
function buildCutPrompt(storyboard: MinimalStoryboard, preset: MinimalPreset, cut?: MinimalCut): string {
  const s = preset.style
  const styleStr = s
    ? `${s.line_weight ?? 'medium'} line weight, ${s.saturation ?? 'vivid'} colors, ${s.character_ratio ?? '2.5head'} body proportions, ${s.background_density ?? 'low'} background detail`
    : 'default webtoon/comic style'

  const parts = [
    `Single webtoon/comic panel, consistent with the attached character reference sheet.`,
    `Style: ${styleStr}.`,
    `Subject: ${storyboard.subject ?? 'a person dealing with an everyday situation'}.`,
  ]

  if (cut) {
    if (cut.shot_type) parts.push(`Shot type: ${cut.shot_type}.`)
    if (cut.camera_angle) parts.push(`Camera angle: ${cut.camera_angle}.`)
    if (cut.time_of_day) parts.push(`Time of day: ${cut.time_of_day}.`)
    for (const c of cut.characters_in_frame ?? []) {
      if (c.expression || c.pose) {
        parts.push(`A character with ${c.expression ?? 'neutral'} expression, ${c.pose ?? 'standing'} pose.`)
      }
    }
    if (cut.reserved_zone) parts.push(RESERVED_ZONE_HINT[cut.reserved_zone])
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
