// B①: 이미지 생성. provider.ts의 ImageProvider 계약 중 생성 2종만 담당한다
// (extractStyle은 B② / extract.ts).
import type { ImageProvider } from './provider'

/** 아직 실제 모델 호출은 없다. 호출부가 붙일 수 있도록 계약 모양만 지킨 스텁. */
export const generateCharacterSheet: ImageProvider['generateCharacterSheet'] = async (preset) => {
  void preset
  return { asset: 'asset://stub/character-sheet', stub: true }
}

export const generateCut: ImageProvider['generateCut'] = async (input) => {
  void input
  return { asset: 'asset://stub/cut', stub: true }
}
