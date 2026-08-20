// spec/ 계약: ImageProvider 어댑터. 구현은 B①.
import type { StyleExtractionResult } from './extract'

export type ReservedZone = 'top' | 'bottom' | 'left' | 'right'

// PRD 5절 계약 ④: 생성 이미지 애셋 + 메타(width/height/reserved_zone).
// 스키마 → 타입 파생 도구가 레포에 없어 손으로 작성함 — spec/storyboard.schema.json의
// reserved_zone enum과 갈라지지 않도록 변경 시 같이 맞출 것 (#71).
export interface GeneratedImageResult {
  asset: string
  width: number
  height: number
  // 생성 시 실제로 비운 가장자리. compose.ts(B③)가 아직 이 값을 읽지 않으므로
  // (#70에서 소비 여부 결정) 강제하지 않고 optional로 둔다.
  reserved_zone?: ReservedZone
  // 다음 컷 체이닝 토큰. PR #63 제안 이름 — provider 고유 개념(예:
  // previous_response_id)을 그대로 노출하지 않는다는 PRD 6절 조건을 따름.
  // 최종 이름·형태는 #18에서 확정되며, 그때 이 필드도 함께 갱신한다.
  continuationToken?: string
  // #60 규칙: 스텁 응답임을 나타내는 플래그. 실제 구현은 이 필드를 넣지 않는다.
  stub?: true
  // 실제 생성에 쓰인 프롬프트. storyboard.schema.json의 cuts[].prompt_used(재생성·
  // 디버깅용, required 아님, null 허용)에 그대로 저장할 수 있도록 제공한다 (#102) —
  // 화면이 진짜 프롬프트를 받을 방법이 없어서 요약 문자열을 그 자리에 대신
  // 채워 넣던 문제를 없앤다.
  prompt?: string
}

export interface ImageProvider {
  extractStyle(refs: Buffer[]): Promise<StyleExtractionResult>
  // #19 결정: extractStyle과 결합도가 높아 B②(extract.ts)가 구현을 소유한다.
  generateCharacterSheet(preset: unknown): Promise<GeneratedImageResult>

  // 표지 3안: 독립 호출. 세션에 누적하면 2안이 1안에 끌려가 서로 비슷해진다
  // (PRD 6절). 체이닝 토큰을 받지 않는 것으로 독립성을 계약에 드러낸다.
  // count 를 리터럴 3 으로 고정해 호출부가 안 개수를 임의로 늘리지 못하게 한다.
  generateCoverVariants(input: {
    storyboard: unknown
    preset: unknown
    referenceAssets: unknown[]
    count: 3
  }): Promise<GeneratedImageResult[]>

  // 표지 이후 컷: 이전 컷을 이어받는 체이닝 경로.
  //
  // continueFrom 은 프로바이더 중립 세션 토큰이다. PRD 6절이 어댑터에
  // previous_response_id 를 그대로 노출하지 않기로 정했으므로, OpenAI 고유
  // 개념은 어댑터 내부에서 이 토큰으로 매핑한다. 반환값에 다음 컷으로
  // 넘길 continuationToken 을 실어 보낸다.
  //
  // referenceAssets 는 체이닝과 별개로 매 컷 필요하다 — P0 스파이크 결론이
  // "체이닝만으로는 부족, 캐릭터 시트를 매번 넣어야 동일성이 유지된다" 였다.
  generateCut(input: {
    storyboard: unknown
    preset: unknown
    referenceAssets: unknown[]
    continueFrom?: string
  }): Promise<GeneratedImageResult>
}
