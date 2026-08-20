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
    // palette·keywords 는 enum 이 아니라 사용자·추출 결과의 자유 값이다.
    // extract.ts(B②)가 캐릭터 시트를 만들 때 이 둘을 쓰는데 컷 프롬프트가 안
    // 쓰고 있었다 — 시트와 컷이 서로 다른 스타일 지시를 받는 상태였다.
    palette?: string[]
    keywords?: string[]
    // bubble_style 은 읽지 않는다. 말풍선은 생성 이미지에 넣지 않고 나중에
    // 합성하므로(PRD 6절) B③ 쪽 값이다.
  }
  // 사용자가 온보딩에서 적은 금지 요소. 지금까지 아무 데서도 쓰이지 않아 통째로
  // 버려지고 있었다. 프롬프트 조립은 B① 몫이라(PRD 5절) 여기서 넣는다.
  rules?: {
    forbidden?: string[]
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
  // 호출부가 referenceAssets 를 빼먹었을 때의 폴백 출처. style_refs 는 일부러
  // 읽지 않는다 — P0 게이트는 캐릭터 동일성이고, reference 이미지를 늘리면
  // 시트의 비중이 그만큼 묽어진다. 스타일은 프롬프트의 Style 문장이 담당한다.
  assets?: {
    character_sheet?: string
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

  const castById = new Map(
    (storyboard.cast ?? []).filter((m) => m.character_id).map((m) => [m.character_id!, m])
  )

  // 첨부하는 시트는 고정 마스코트(지도사) 한 명만 담는다 — 주인공·어르신 등은
  // 시트가 없는 가변 인물이고, storyboard.schema.json 의 character_id 서술이
  // "role=supporting 이 지도사를 가리킬 때만 character_sheet 와 연결된다" 고 정한다.
  //
  // 그래서 "시트 인물과 일치시켜라" 를 무조건 붙이면 안 된다. 샘플 4컷 중 지도사가
  // 나오는 것은 한 컷뿐인데, 나머지 컷에서 그 문장이 붙으면 60대 어머니를 그려야
  // 하는 자리에서 지도사 시트를 따라가라고 지시하는 셈이 된다.
  //
  // ponytail: role === 'supporting' 로 판정한다. 스키마에 "이 인물이 시트를 갖는다"
  // 를 표현하는 필드가 없어서 서술 규약에 코드를 묶는 것이고, 조연이 둘이 되면
  // 조용히 틀린다. A① 이 character_pool 에 그 자리를 만들면 그것으로 바꾼다 (#113).
  //
  // 판정이 안 되는 경우(cut 이 없어 프레임 인물을 모를 때)는 기존 문장을 쓴다 —
  // 그때는 프롬프트에 인물 서술 자체가 없어서 끌려갈 대상이 없고, 반대로 지도사
  // 컷에서 동일성 문장을 잃는 것이 P0 게이트에 더 해롭다.
  const framed = cut?.characters_in_frame
  const sheetPersonInFrame =
    !framed || framed.some((c) => c.character_id && castById.get(c.character_id)?.role === 'supporting')

  const parts = [
    sheetPersonInFrame
      ? `Single webtoon/comic panel, consistent with the attached character reference sheet.`
      : `Single webtoon/comic panel. Match the art style, line weight and coloring of the attached ` +
        `reference sheet, but the person in this panel is a different character from the one drawn ` +
        `on that sheet — follow the character description below for who they are.`,
    `Style: ${styleStr}.`,
  ]

  // extract.ts(B②)의 캐릭터 시트 프롬프트와 같은 문구를 쓴다. 시트와 컷이 문자
  // 그대로 같은 지시를 받아야 스타일이 어긋나지 않는다.
  //
  // 값이 없으면 문장을 넣지 않는다. 시트 쪽은 비었을 때 "designer's choice" 를
  // 넣는데, 컷에서는 그 채움말이 오히려 지시로 읽혀 시트에서 정해진 색을 흔든다.
  if (preset.style?.palette?.length) parts.push(`Color palette: ${preset.style.palette.join(', ')}.`)
  if (preset.style?.keywords?.length) parts.push(`Style keywords: ${preset.style.keywords.join(', ')}.`)

  parts.push(
    // "Subject: 무릎 연골 나감." 처럼 명사구만 넣으면 모델이 소재를 표정으로만
    // 처리한다 — codex 검증에서 4/4 가 "걱정하는 얼굴" 이고 무릎은 어디에도 없었다.
    // 소재를 몸·행동·주변으로 보이게 하라고 지시한다. 다만 프레이밍과 싸우면
    // 안 된다(closeup 은 어깨 위라 무릎이 물리적으로 프레임 밖이다).
    `The story is about ${storyboard.subject ?? 'a person dealing with an everyday situation'}. ` +
      `Make that situation visible in the character's body, gesture and surroundings ` +
      `as far as the framing allows — not just as a mood on the face.`
  )

  // 사용자가 온보딩에서 고른 타깃·업종. 값이 없으면 문장을 아예 넣지 않는다 —
  // "general" 같은 채움말을 넣으면 모델이 그걸 지시로 읽는다.
  //
  // "who this is for" 로 못박는 이유: 타깃과 등장 인물이 다를 수 있다. KRIEE
  // 샘플이 그 경우다 — 타깃은 30~40대 지도사인데 컷에 나오는 인물은 60대
  // 어머니다. 그냥 "audience in their 30s" 로 쓰면 모델이 인물 나이 지시로
  // 읽어 cast 서술과 충돌한다.
  //
  // life_stage 는 힌트가 있으면 그것을 쓰고, 없으면 밑줄만 공백으로 바꿔 넣는다.
  // hint() 를 그냥 쓰면 힌트가 없을 때 스네이크케이스 토큰(job_seeker)이 그대로
  // 나가므로, 폴백을 직접 지정한다 — 힌트가 추가되면 자동으로 집어간다 (#121).
  const ctx = preset.context
  const audience = [
    ctx?.industry?.length ? `${ctx.industry.join(' / ')} field` : undefined,
    ctx?.age_band?.length ? `readers in their ${ctx.age_band.join(', ')}` : undefined,
    ctx?.life_stage?.length
      ? ctx.life_stage.map((v) => HINTS.life_stage?.[v] ?? v.replace(/_/g, ' ')).join(', ')
      : undefined,
  ].filter(Boolean)
  if (audience.length) {
    parts.push(
      `Who this comic is made for (not who appears in the panel): ${audience.join('; ')}. ` +
        `Choose setting, props and tone that resonate with those readers.`
    )
  }

  if (cut) {
    // 컷이 이야기에서 하는 역할. 이게 없으면 4컷이 전부 같은 온도로 나온다 —
    // problem 컷과 after 컷이 구분되지 않는다. prompt_hints 에 narrative_beat
    // 항목이 아직 없어(spec/ 은 A① 소유) 토큰이 그대로 들어가지만, enum 값이
    // 이미 영어 단어라(problem/before/turning/after…) 모델이 읽는다.
    const beat = hint('narrative_beat', cut.narrative_beat)
    // 라벨 형태로 둔다. 예전엔 `This panel is the "${beat}" beat of the story.` 였는데,
    // 그러면 힌트가 그 영어 문장 안에 들어맞는 짧은 구여야 해서 spec/ 쪽 서술문 작성이
    // 제 파일의 문장 모양에 묶인다. 다른 힌트(Framing/Camera/Lighting)는 전부 라벨 뒤에
    // 서술문을 붙이는 형태이므로 여기도 맞춘다 (#121).
    //
    // 힌트가 없으면 hint() 가 토큰을 그대로 주고, `… : problem.` 으로도 읽힌다.
    if (beat) parts.push(`This panel's role in the story: ${beat}.`)

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
    for (const c of cut.characters_in_frame ?? []) {
      const desc = c.character_id ? castById.get(c.character_id)?.description : undefined
      const traits = [hint('expression', c.expression), hint('pose', c.pose)].filter(Boolean).join(', ')
      // 서술을 앞세운다 — 나이·성별 같은 정체성이 표정·포즈보다 먼저 고정돼야 한다.
      parts.push(desc ? `Character: ${desc}. ${traits}.` : `Character: ${traits || 'neutral expression, standing'}.`)
    }

    if (cut.reserved_zone) parts.push(reservedZoneHint(cut.reserved_zone))
  }

  // 금지 요소는 마지막 제약 구간에 넣는다. 사용자가 적은 자유 단어라(enum 아님)
  // 장면 서술 사이에 끼우면 소재나 cast 서술과 다투기 쉽다.
  const forbidden = preset.rules?.forbidden?.filter((w) => w.trim())
  if (forbidden?.length) parts.push(`Do not include: ${forbidden.join(', ')}.`)

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

// 캐릭터 시트는 4컷 동일성(P0 게이트)의 유일한 방어선이다 — 스파이크 결론이
// "체이닝만으로는 부족, 시트를 매 컷 넣어야 한다" 였다. 그래서 호출부가
// referenceAssets 를 빼먹어도 preset.assets.character_sheet 로 채운다. 방어선이
// 켜져 있는지가 호출부의 실수 하나에 달려 있으면 안 된다.
function referenceUris(referenceAssets: unknown[], preset: MinimalPreset): string[] {
  const uris = referenceAssets.filter((a): a is string => typeof a === 'string')
  const sheet = preset.assets?.character_sheet
  if (sheet && !uris.includes(sheet)) uris.push(sheet)
  return uris
}

async function toInputImages(uris: string[]): Promise<Array<{ type: 'input_image'; image_url: string }>> {
  const images: Array<{ type: 'input_image'; image_url: string }> = []
  for (const uri of uris) {
    const buf = await readAsset(uri)
    // 조용히 넘기지 않는다. 못 읽은 것을 묻어두면 방어선이 소리 없이 꺼진 채로
    // 유료 생성이 돌아가고, 나중에 "왜 캐릭터가 컷마다 다르지" 만 남는다.
    // #67 이 실제로 그 상태였다 — 버킷이 없어 애셋 읽기가 전부 실패하고 있었다.
    if (!buf) {
      console.error(`[generate] reference 애셋을 읽지 못했습니다: ${uri}`)
      continue
    }
    images.push({ type: 'input_image', image_url: `data:image/png;base64,${buf.toString('base64')}` })
  }

  // 유료 호출 전에 막는다. reference 가 하나도 없으면 P0 게이트를 통과할 수 없는
  // 이미지에 생성비를 쓰는 것이고, 4컷이 다 나온 뒤에야 드러난다.
  if (images.length === 0) {
    throw new Error(
      '캐릭터 시트를 읽을 수 없어 생성을 중단했습니다 — referenceAssets 와 preset.assets.character_sheet 를 확인하세요'
    )
  }
  return images
}

async function callImageGeneration(
  prompt: string,
  referenceAssets: unknown[],
  preset: MinimalPreset,
  previousResponseId?: string
): Promise<{ base64: string; responseId: string }> {
  const inputImages = await toInputImages(referenceUris(referenceAssets, preset))

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
//
// ponytail: crop position 은 기본값(centre)이다. 비정사각형 출력에서 중앙 크롭이
// reserved_zone 과 같은 축에 걸리면 말풍선 여백이 깎인다 — compose.ts(B③)가
// reserved_zone 을 아직 읽지 않아 지금은 비활성이고, 읽기 시작할 때 position 을
// zone 반대쪽으로 지정해야 한다. #105 에서 추적한다.
//
// #104: 여기 도달했다는 건 유료 호출이 이미 성공했다는 뜻이다 — 리사이즈(후처리)
// 실패로 그 결과를 통째로 버리지 않는다. 실패하면 원본 버퍼를 그대로 쓰고,
// width/height도 OUTPUT_SIZE로 고정하지 않고 실제 메타데이터를 다시 읽어 반환한다
// (메타 읽기까지 실패하면 그때만 OUTPUT_SIZE로 최후 폴백).
async function resizeToOutput(
  base64: string
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const original = Buffer.from(base64, 'base64')
  try {
    const buffer = await sharp(original)
      .resize(OUTPUT_SIZE.width, OUTPUT_SIZE.height, { fit: 'cover' })
      .png()
      .toBuffer()
    return { buffer, width: OUTPUT_SIZE.width, height: OUTPUT_SIZE.height }
  } catch (err) {
    console.error('[generate] resizeToOutput 실패 — 원본 버퍼로 폴백 (#104)', err)
    const meta = await sharp(original)
      .metadata()
      .catch(() => undefined)
    return {
      buffer: original,
      width: meta?.width ?? OUTPUT_SIZE.width,
      height: meta?.height ?? OUTPUT_SIZE.height,
    }
  }
}

export const generateCut: ImageProvider['generateCut'] = async (input) => {
  const storyboard = (input.storyboard ?? {}) as MinimalStoryboard
  const preset = (input.preset ?? {}) as MinimalPreset
  const cut = nextUngeneratedCut(storyboard.cuts)

  const prompt = buildCutPrompt(storyboard, preset, cut)
  const { base64, responseId } = await callImageGeneration(prompt, input.referenceAssets, preset, input.continueFrom)

  const { buffer, width, height } = await resizeToOutput(base64)
  const { assetUri } = await uploadAsset(buffer, 'image/png', 'cut.png')

  return {
    asset: assetUri,
    width,
    height,
    reserved_zone: cut?.reserved_zone,
    continuationToken: responseId,
    prompt,
  }
}

// #118: 부족분 재시도 on/off. 기본은 on 이다 — 정상 경로에서는 재시도가 아예
// 일어나지 않아 평시 비용이 같고, PRD 6절의 표지 3안 고정값을 지키는 쪽이 안전하다.
// 리허설을 반복할 때처럼 시간·비용을 아끼고 3안이 2안으로 줄어도 무방한 상황에서만 끈다.
//
// 호출 시점에 읽는다. 모듈 로드 시점에 캐시하면 값을 바꿔도 프로세스를 다시 띄울
// 때까지 안 먹는데, 이 값은 상황에 따라 켜고 끄는 용도라 그게 함정이 된다.
const RETRY_ENV = 'COVER_VARIANT_RETRY'

function retryEnabled(): boolean {
  const v = process.env[RETRY_ENV]?.trim().toLowerCase()
  // 안 정했으면 on. 끄는 것만 명시적으로 받는다 — 오타('yes', 'ture')가 조용히
  // off 로 떨어지면 시연에서 3안이 2안으로 줄어드는 쪽으로 실패한다.
  return !(v === '0' || v === 'false' || v === 'off')
}

// #108: allSettled(#104)만으로는 부족하다 — 3개 중 하나가 실패하면 조용히 2개만
// 돌아온다. provider.ts의 count: 3 리터럴과 PRD 6절("표지컷만 3안")은 고정값이라
// 사용자에게 "왜 2안만 떴는지" 설명 없이 개수가 줄어드는 걸 허용하지 않는다.
// 부족분만 다시 시도해서 채운다 — 유료 호출은 실패한 만큼만 추가된다.
async function generateOneVariant(
  prompt: string,
  referenceAssets: unknown[],
  preset: MinimalPreset,
  reservedZone?: ReservedZone
): Promise<GeneratedImageResult> {
  const { base64, responseId } = await callImageGeneration(prompt, referenceAssets, preset)
  const { buffer, width, height } = await resizeToOutput(base64)
  const { assetUri } = await uploadAsset(buffer, 'image/png', 'cover.png')
  return {
    asset: assetUri,
    width,
    height,
    reserved_zone: reservedZone,
    continuationToken: responseId,
    prompt,
  }
}

// 표지 3안. 독립 호출이므로 체이닝 토큰을 받지 않는다(PRD 6절) — 세션에 누적하면
// 2안이 1안에 끌려가 서로 비슷해지기 때문. 3개를 병렬로 호출한다.
export const generateCoverVariants: ImageProvider['generateCoverVariants'] = async (input) => {
  const storyboard = (input.storyboard ?? {}) as MinimalStoryboard
  const preset = (input.preset ?? {}) as MinimalPreset
  const cut = storyboard.cuts?.[0]
  const prompt = buildCutPrompt(storyboard, preset, cut)

  const variants: GeneratedImageResult[] = []
  // 재시도를 켜면 count(3)만큼 더 실패해도 채울 수 있게 여유를 둔다 — 무한 재시도로
  // 인한 과금 폭주는 막으면서, 가끔 한두 개 실패하는 정도는 채운다.
  //
  // 끄면 예산이 정확히 count 라서 배치가 한 번만 돌고 부족분은 그대로 반환된다
  // (PR #97 시점 동작). 분기를 따로 두지 않고 예산 하나로 표현한다 — 두 경로를
  // 만들면 한쪽만 고쳐지는 일이 생긴다.
  const retry = retryEnabled()
  let attemptsLeft = retry ? input.count * 2 : input.count
  // 조기 종료 원인을 남긴다. 루프를 빠져나오는 길이 둘이라(예산 소진 / 배치 전멸)
  // retry 불리언만으로는 아래 미달 로그의 원인 라벨이 갈리지 않는다.
  let abortedOnDeadBatch = false

  while (variants.length < input.count && attemptsLeft > 0) {
    const needed = input.count - variants.length
    const batch = Math.min(needed, attemptsLeft)
    attemptsLeft -= batch

    // allSettled 인 이유: 각 안이 별도 유료 호출이다. Promise.all 이면 한 안이
    // 후처리(sharp·업로드)에서 실패할 때 이미 성공한 나머지 안까지 같이 버려져
    // 성공분 생성비가 그대로 날아간다 (#104). 성공한 것만 살려서 이어붙인다.
    const settled = await Promise.allSettled(
      Array.from({ length: batch }, () => generateOneVariant(prompt, input.referenceAssets, preset, cut?.reserved_zone))
    )

    let gained = 0
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        variants.push(r.value)
        gained++
      } else {
        console.error('[generate] 표지 안 하나 실패', r.reason)
      }
    }

    // 한 배치가 통째로 실패하면 재시도를 멈춘다. 남은 실패 원인은 업로드 계열인데
    // (모델 호출이 실패하면 생성비가 안 나가고, sharp 는 PR #110 이후 원본으로
    // 폴백해 던지지 않는다) 그건 이미지별이 아니라 환경 문제라 다시 시도해도 같이
    // 실패한다. 그때 재시도는 생성비만 두 배로 쓰고 결과는 그대로다 — #67 이
    // 정확히 그 상황이었다(버킷이 없어 업로드가 전부 실패). 하나라도 성공했다면
    // 환경은 살아 있는 것이므로 부족분을 계속 채운다.
    if (gained === 0) {
      console.error('[generate] 배치가 통째로 실패해 재시도를 중단합니다 — 환경 문제로 보입니다')
      abortedOnDeadBatch = true
      break
    }
  }

  // 전부 실패면 던진다 — 빈 배열을 돌려주면 호출부가 "생성됐는데 0안"으로 읽어
  // 조용히 빈 선택 화면을 띄운다. route.ts 가 500 으로 바꾼다.
  if (variants.length === 0) throw new Error('표지 3안 생성이 모두 실패했습니다')

  // count에 못 미치면(재시도 한도 소진) 있는 만큼이라도 반환한다 — 0개가 아닌 한
  // 사용자가 아무것도 못 고르는 것보다는 낫다. 다만 PRD 고정값(3안)과 어긋나는
  // 상태이니 반드시 로그로 남겨 모니터링에서 보이게 한다.
  if (variants.length < input.count) {
    // 원인을 로그에 박는다 (#118). 셋이 서로 다른 대응을 요구한다 — 꺼짐은 설정을
    // 켜면 되고, 한도 소진은 실패율을 봐야 하고, 배치 전멸은 환경(업로드·스토리지)을
    // 봐야 한다.
    //
    // 세 갈래로 나눈 이유: retry 불리언만 보고 찍었더니 배치 전멸로 조기 break 한
    // 경우도 '한도 소진' 으로 나왔다. 예산이 남아 있는데도 그렇게 찍힌다 — 요약 줄만
    // 세어 통계를 내면 원인이 왜곡된다. #113 이 이 스위치를 측정용으로 쓴다.
    const why = !retry
      ? `재시도 꺼짐(${RETRY_ENV}=off)`
      : abortedOnDeadBatch
        ? '배치 전멸로 중단'
        : '재시도 한도 소진'
    console.error(
      `[generate] 표지 ${input.count}안 중 ${variants.length}안만 확보(${why}) — PRD 고정값(#108) 미달`
    )
  }

  return variants
}
