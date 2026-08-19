import { generateCharacterSheet, generateCut } from '@/lib/openai/generate'

// POST /api/generate
// body: { kind: 'character_sheet', preset } | { kind: 'cut', storyboard, preset, referenceAssets }
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
  const { kind, preset, storyboard, referenceAssets } = body as Record<string, unknown>

  if (!preset) {
    return Response.json({ error: 'preset이 필요합니다' }, { status: 400 })
  }

  switch (kind) {
    case 'character_sheet':
      return Response.json({ result: await generateCharacterSheet(preset) })
    case 'cut':
      // storyboard 검증은 spec/storyboard.schema.json이 채워진 뒤 A① 계약에 맞춰 추가한다
      return Response.json({
        result: await generateCut({
          storyboard,
          preset,
          referenceAssets: Array.isArray(referenceAssets) ? referenceAssets : [],
        }),
      })
    default:
      return Response.json(
        { error: "kind는 'character_sheet' 또는 'cut'이어야 합니다" },
        { status: 400 },
      )
  }
}
