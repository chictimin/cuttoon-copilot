import { generateCut } from '@/lib/openai/generate'
// #19 결정: generateCharacterSheet는 B②(extract.ts) 소유 — extractStyle과 결합도가 높음.
import { generateCharacterSheet } from '@/lib/openai/extract'
import type { PresetInput } from '@/lib/openai/extract'

// POST /api/generate
// body: { kind: 'character_sheet', preset }
//     | { kind: 'cut', storyboard, preset, referenceAssets, continueFrom? }
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'JSON 본문을 파싱할 수 없습니다' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: '본문은 객체여야 합니다' }, { status: 400 })
  }
  const { kind, preset, storyboard, referenceAssets, continueFrom } = body as Record<string, unknown>

  if (!preset) {
    return Response.json({ error: 'preset이 필요합니다' }, { status: 400 })
  }

  // 생성 호출은 try로 감싼다. 실제 모델 호출로 교체되면 네트워크 실패·rate
  // limit·타임아웃이 이 자리에서 나는데, 감싸지 않으면 위쪽 400들과 달리
  // { error } JSON을 주지 못해 호출부의 res.json().error 가 깨진다.
  try {
    switch (kind) {
      case 'character_sheet':
        // preset 구조 검증은 아직 없음 — storyboard와 같은 기존 관례를 따라 여기서는
        // 캐스팅만 한다. 확정 검증은 lib/llm/preset-guard.ts 쪽 후속 작업으로 남긴다.
        return Response.json({ result: await generateCharacterSheet(preset as PresetInput) })
      case 'cut':
        // storyboard 검증은 lib/llm/storyboard-guard.ts(A① 소유)가 담당한다.
        // route에서 중복 구현하지 않고, 실제 생성을 붙이는 시점에 연결한다.
        return Response.json({
          result: await generateCut({
            storyboard,
            preset,
            referenceAssets: Array.isArray(referenceAssets) ? referenceAssets : [],
            // 체이닝 토큰. 문자열이 아니면 넘기지 않는다 — 첫 컷은 이어받을
            // 대상이 없어 생략되는 것이 정상이다.
            continueFrom: typeof continueFrom === 'string' ? continueFrom : undefined,
          }),
        })
      default:
        return Response.json(
          { error: "kind는 'character_sheet' 또는 'cut'이어야 합니다" },
          { status: 400 },
        )
    }
  } catch (e) {
    // 에러 원문은 응답에 넣지 않는다 — 프로바이더 에러 메시지에 요청
    // 파라미터나 조직 정보가 섞여 나올 수 있다.
    console.error('[POST /api/generate] 생성 실패:', e)
    return Response.json({ error: '이미지 생성에 실패했습니다' }, { status: 500 })
  }
}
