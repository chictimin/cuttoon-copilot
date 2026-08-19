// B①: 이미지 생성. provider.ts의 ImageProvider 계약 중 생성 3종만 담당한다
// (extractStyle은 B② / extract.ts).
import type { ImageProvider } from './provider'

// 출력 해상도는 1024x1024 고정. 컷툰은 1:1 비율이고, 같은 프롬프트가 호출마다
// 다른 크기를 내는 것을 실측으로 확인했으므로(1536x1024 / 1199x1312) 크기를
// 모델 기본값에 맡기지 않는다. 계약 ④가 요구하는 width/height 메타의 값이다.
//
// 1024 인 이유: gpt-image-1 계열은 1024x1024 / 1024x1536 / 1536x1024 세 가지만
// 받고, gpt-image-2 계열은 양변이 16의 배수여야 한다. 1024 는 양쪽 모두에서
// 유효한 유일한 정사각형 값이다(1080 은 16의 배수가 아니라 어느 쪽에서도 거부).
// 인스타그램은 320~1080px 를 원본 그대로 유지하므로 1024 도 손실이 없다.
export const OUTPUT_SIZE = { width: 1024, height: 1024 } as const

/** 아직 실제 모델 호출은 없다. 호출부가 붙일 수 있도록 계약 모양만 지킨 스텁. */
export const generateCharacterSheet: ImageProvider['generateCharacterSheet'] = async (preset) => {
  void preset
  return { asset: 'asset://stub/character-sheet', ...OUTPUT_SIZE, stub: true }
}

export const generateCut: ImageProvider['generateCut'] = async (input) => {
  void input
  return {
    asset: 'asset://stub/cut',
    ...OUTPUT_SIZE,
    // 다음 컷이 continueFrom 으로 넘길 토큰. 스텁이므로 고정값이다 (#60).
    continuationToken: 'stub-continuation',
    stub: true,
  }
}

// 표지 3안. 독립 호출이므로 체이닝 토큰을 받지 않는다 (PRD 6절).
// #60 규칙: 스텁임이 응답에 남아야 한다 — asset:// 식별자에 stub 을 넣고
// stub: true 플래그를 유지한다. 랜덤 UUID 처럼 실제 결과와 구분되지 않는
// 값을 돌려주지 않는다.
export const generateCoverVariants: ImageProvider['generateCoverVariants'] = async (input) => {
  void input
  return [1, 2, 3].map((i) => ({ asset: `asset://stub/cover-${i}`, ...OUTPUT_SIZE, stub: true }))
}
