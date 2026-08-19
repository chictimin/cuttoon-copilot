// B①: 이미지 생성. provider.ts의 ImageProvider 계약을 구현합니다.
// - generateCharacterSheet: 캐릭터 시트 이미지 생성
// - generateCut: 컷 이미지 생성 (previous_response_id 체이닝 지원)

import type { ImageProvider } from './provider'

export interface GenerateResult {
  asset: string
  responseId?: string
}

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
 * 컷 이미지를 생성합니다.
 * previous_response_id를 지원하여 여러 컷을 일관성 있게 생성할 수 있습니다.
 */
export const generateCut: ImageProvider['generateCut'] = async (input) => {
  try {
    const { storyboard, preset, referenceAssets } = input as {
      storyboard?: unknown
      preset?: unknown
      referenceAssets?: unknown[]
    }

    const prompt = buildCutPrompt(storyboard, preset)

    // 실제 구현: DALL-E 또는 다른 이미지 생성 모델 호출
    // previous_response_id가 있으면 체이닝 API 호출
    // const result = await callImageModel(prompt, { previousResponseId, referenceAssets })
    // return { asset: result.url, responseId: result.id }

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

function buildCharacterSheetPrompt(preset: unknown): string {
  // preset에서 프롬프트 구성
  return 'Generate character sheet for webtoon'
}

function buildCutPrompt(storyboard: unknown, preset: unknown): string {
  // storyboard와 preset에서 프롬프트 구성
  return 'Generate webtoon cut image'
}
