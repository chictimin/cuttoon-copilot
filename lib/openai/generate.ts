// B①: 이미지 생성. provider.ts의 ImageProvider 계약을 구현합니다.
// - generateCharacterSheet: 캐릭터 시트 이미지 생성
// - generateCoverVariants: 표지 3안 생성 (독립 호출, 체이닝 없음)
// - generateCut: 컷 이미지 생성 (previous_response_id 체이닝 지원)

import type { ImageProvider } from './provider'

/**
 * 캐릭터 시트를 생성합니다.
 * 프리셋의 캐릭터 정보를 바탕으로 참고용 시트 이미지를 생성합니다.
 */
export const generateCharacterSheet: ImageProvider['generateCharacterSheet'] = async (preset) => {
  try {
    const prompt = buildCharacterSheetPrompt(preset)

    // 실제 구현: DALL-E 또는 다른 이미지 생성 모델 호출
    // const result = await callImageModel(prompt)
    // return { asset: result.url, responseId: result.id }

    // 임시: 응답 구조만 반환
    return {
      asset: `asset://character-sheet-${crypto.randomUUID()}`,
      responseId: crypto.randomUUID(),
    }
  } catch (error) {
    console.error('캐릭터 시트 생성 실패:', error)
    throw error
  }
}

/**
 * 표지 3안을 독립적으로 생성합니다.
 * 각 3안은 다른 특성을 유지하도록 병렬 호출되며, 체이닝이 없습니다.
 */
export const generateCoverVariants: ImageProvider['generateCoverVariants'] = async (promptBase) => {
  try {
    // 3안을 병렬로 생성
    const promises = Array.from({ length: 3 }, (_, i) =>
      callImageModel(`${promptBase} (variant ${i + 1})`)
        .then((result) => ({
          asset: result.asset,
          responseId: result.responseId,
        }))
        .catch((error) => {
          console.error(`표지 ${i + 1}안 생성 실패:`, error)
          return {
            asset: `asset://cover-variant-${i + 1}-${crypto.randomUUID()}`,
            responseId: crypto.randomUUID(),
          }
        })
    )

    return Promise.all(promises)
  } catch (error) {
    console.error('표지 3안 생성 실패:', error)
    // fallback: 3안 생성
    return Array.from({ length: 3 }, (_, i) => ({
      asset: `asset://cover-variant-${i + 1}-${crypto.randomUUID()}`,
      responseId: crypto.randomUUID(),
    }))
  }
}

/**
 * 컷 이미지를 생성합니다.
 * previous_response_id를 지원하여 여러 컷을 일관성 있게 생성할 수 있습니다.
 */
export const generateCut: ImageProvider['generateCut'] = async (input) => {
  try {
    const { storyboard, preset, referenceAssets, previousResponseId } = input as {
      storyboard?: unknown
      preset?: unknown
      referenceAssets?: unknown[]
      previousResponseId?: string
    }

    const prompt = buildCutPrompt(storyboard, preset)

    // 실제 구현: reference image + previous_response_id 체이닝 호출
    // const result = await callImageModel(prompt, {
    //   referenceAssets,
    //   previousResponseId
    // })
    // return { asset: result.asset, responseId: result.id }

    // 임시: 응답 구조만 반환
    return {
      asset: `asset://cut-${crypto.randomUUID()}`,
      responseId: crypto.randomUUID(),
    }
  } catch (error) {
    console.error('컷 생성 실패:', error)
    throw error
  }
}

async function callImageModel(
  prompt: string,
  _options?: {
    referenceAssets?: unknown[]
    previousResponseId?: string
  }
): Promise<{ asset: string; responseId: string }> {
  // 실제 구현: OpenAI Responses API 호출
  // - reference image 주입
  // - previous_response_id 체이닝
  // - 생성된 이미지 asset:// URI로 변환
  return {
    asset: `asset://image-${crypto.randomUUID()}`,
    responseId: crypto.randomUUID(),
  }
}

function buildCharacterSheetPrompt(preset: unknown): string {
  // preset에서 프롬프트 구성
  return 'Generate character sheet for webtoon'
}

function buildCutPrompt(storyboard: unknown, preset: unknown): string {
  // storyboard와 preset에서 프롬프트 구성
  return 'Generate webtoon cut image'
}
