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
import sharp from 'sharp'
import vocabulary from '@/spec/vocabulary.json'
import type { ImageProvider, GeneratedImageResult, ReservedZone } from './provider'
import { readAsset, uploadAsset } from '../asset-store'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const RESPONSES_MODEL = 'gpt-5'

// 출력 해상도는 1024x1024 고정.
//
// 왜 정사각형인가 — 산출물이 인스타그램 게시물용 컷툰(인스타툰)이다. 정사각형은
// 인스타그램이 완전히 지원하는 비율 범위(1.91:1 ~ 4:5) 안에 있어 잘리지 않고,
// 4컷을 같은 틀로 이어 붙일 수 있다. PRD 2절이 4컷 고정을 협상 불가로 둔 것과
// 같은 이유로 비율도 흔들지 않는다.
//
// 왜 1024 인가 — 인스타그램 쪽만 보면 1080 이 더 커 보이지만, 1080 은 강제 규격이
// 아니라 "다운사이즈 없이 유지되는 최대 너비" 이고 320~1080px 는 원본이 그대로
// 보존된다. 따라서 1024 도 인스타그램 기준으로 무손실이다. 반대로 모델 쪽 제약은
// 1080 을 허용하지 않는다 — gpt-image-1 계열은 1024x1024 / 1024x1536 / 1536x1024
// 세 가지만 받고, gpt-image-2 계열은 양변이 16의 배수여야 한다(1080 / 16 = 67.5).
// 즉 1024 는 인스타툰 요구를 만족하면서 두 모델 후보 모두에서 유효한 유일한
// 정사각형 값이다. 처음 1080 으로 올렸다가 이 근거로 정정했다(PR #63).
//
// 왜 상수로 고정하는가 — 같은 프롬프트가 호출마다 다른 크기를 내는 것을 실측으로
// 확인했다(1536x1024 / 1199x1312). 크기를 모델 기본값에 맡기지 않는다.
// 계약 ④가 요구하는 width/height 메타의 값이기도 하다.
export const OUTPUT_SIZE = { width: 1024, height: 1024 } as const

// 요청에 실어보내는 size 문자열. OUTPUT_SIZE 에서 파생시켜 숫자를 두 곳에 적지
// 않는다 — extract.ts(B②)도 PR #95 에서 같은 방식으로 하드코딩을 없앴다.
const IMAGE_SIZE = `${OUTPUT_SIZE.width}x${OUTPUT_SIZE.height}` as const

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
  // 온보딩에서 사용자가 직접 고른 값이다(골든 패스 2·3단계). 장면 연출에 쓴다 —
  // 50대 부모가 등장하는 헬스케어 장면과 20대 취준생 IT 장면은 배경·소품이 다르다.
  //
  // main_subjects 와 interests 는 일부러 읽지 않는다.
  // - main_subjects: preset.schema.json 주석이 "컷툰 한 편의 실제 소재는 여기가
  //   아니라 세션에서 받는다" 고 못박았고, 이미 storyboard.subject 를 쓰고 있다.
  //   둘을 같이 넣으면 소재가 두 겹이 돼 장면이 흐려진다.
  // - interests: 마케팅 목적 축이라 컷 연출보다 CTA 쪽 값이다.
  context?: {
    industry?: string[]
    age_band?: string[]
    life_stage?: string[]
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

  // 사용자가 온보딩에서 고른 타깃·업종. 값이 없으면 문장을 아예 넣지 않는다 —
  // "general" 같은 채움말을 넣으면 모델이 그걸 지시로 읽는다.
  //
  // "who this is for" 로 못박는 이유: 타깃과 등장 인물이 다를 수 있다. KRIEE
  // 샘플이 그 경우다 — 타깃은 30~40대 지도사인데 컷에 나오는 인물은 60대
  // 어머니다. 그냥 "audience in their 30s" 로 쓰면 모델이 인물 나이 지시로
  // 읽어 cast 서술과 충돌한다.
  //
  // life_stage 값은 스네이크케이스 enum 이라 밑줄을 공백으로 바꿔 넣는다.
  // prompt_hints 에 life_stage 항목이 없어 서술문이 없다(spec/ 은 A① 소유).
  const ctx = preset.context
  const audience = [
    ctx?.industry?.length ? `${ctx.industry.join(' / ')} field` : undefined,
    ctx?.age_band?.length ? `readers in their ${ctx.age_band.join(', ')}` : undefined,
    ctx?.life_stage?.length ? ctx.life_stage.map((v) => v.replace(/_/g, ' ')).join(', ') : undefined,
  ].filter(Boolean)
  if (audience.length) {
    parts.push(
      `Who this comic is made for (not who appears in the panel): ${audience.join('; ')}. ` +
        `Choose setting, props and tone that resonate with those readers.`
    )
  }

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

// 모델이 요청한 size 와 다른 크기를 낼 때가 있다 — 같은 프롬프트가 1536x1024 /
// 1199x1312 를 낸 실측이 위 OUTPUT_SIZE 주석의 근거다. 리사이즈로 강제해 계약 ④의
// width/height 가 실제 픽셀과 어긋나지 않게 한다. fit: 'cover' 는 비율이 다르게
// 나왔을 때 늘리지 않고 잘라낸다 — 1:1 을 지키면서 왜곡을 피하는 쪽.
//
// extract.ts(B②)에 같은 헬퍼가 있지만 거기서 가져오면 순환 import 가 된다
// (extract.ts 가 이미 이 파일의 OUTPUT_SIZE 를 가져다 쓴다). 나중에 공용 위치로
// 옮길 수 있으면 한쪽으로 합치는 편이 낫다.
async function resizeToOutput(base64: string): Promise<Buffer> {
  return sharp(Buffer.from(base64, 'base64'))
    .resize(OUTPUT_SIZE.width, OUTPUT_SIZE.height, { fit: 'cover' })
    .png()
    .toBuffer()
}

export const generateCut: ImageProvider['generateCut'] = async (input) => {
  const storyboard = (input.storyboard ?? {}) as MinimalStoryboard
  const preset = (input.preset ?? {}) as MinimalPreset
  const cut = nextUngeneratedCut(storyboard.cuts)

  const prompt = buildCutPrompt(storyboard, preset, cut)
  const { base64, responseId } = await callImageGeneration(prompt, input.referenceAssets, input.continueFrom)

  const buffer = await resizeToOutput(base64)
  const { assetUri } = await uploadAsset(buffer, 'image/png', 'cut.png')

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
      const buffer = await resizeToOutput(base64)
      const { assetUri } = await uploadAsset(buffer, 'image/png', 'cover.png')
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
