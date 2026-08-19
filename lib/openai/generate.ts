// B①: 이미지 생성. provider.ts의 ImageProvider 계약 중 생성 3종만 담당한다
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

// 표지 3안. 독립 호출이므로 체이닝 토큰을 받지 않는다 (PRD 6절).
// #60 규칙: 스텁임이 응답에 남아야 한다 — asset:// 식별자에 stub 을 넣고
// stub: true 플래그를 유지한다. 랜덤 UUID 처럼 실제 결과와 구분되지 않는
// 값을 돌려주지 않는다.
export const generateCoverVariants: ImageProvider['generateCoverVariants'] = async (input) => {
  void input
  return [1, 2, 3].map((i) => ({ asset: `asset://stub/cover-${i}`, stub: true }))
}
