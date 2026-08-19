// spec/ 계약: ImageProvider 어댑터. 구현은 B①.
export interface ImageProvider {
  extractStyle(refs: Buffer[]): Promise<unknown>
  generateCharacterSheet(preset: unknown): Promise<unknown>

  // 표지 3안: 독립 호출. 세션에 누적하면 2안이 1안에 끌려가 서로 비슷해진다
  // (PRD 6절). 체이닝 토큰을 받지 않는 것으로 독립성을 계약에 드러낸다.
  // count 를 리터럴 3 으로 고정해 호출부가 안 개수를 임의로 늘리지 못하게 한다.
  generateCoverVariants(input: {
    storyboard: unknown
    preset: unknown
    referenceAssets: unknown[]
    count: 3
  }): Promise<unknown[]>

  // 표지 이후 컷: 이전 컷을 이어받는 체이닝 경로. 체이닝 토큰의 이름·형태는
  // #18(API 경로 확정)에서 정한다 — previous_response_id 같은 프로바이더 고유
  // 개념을 그대로 노출하지 않는다는 PRD 6절 조건이 붙는다.
  generateCut(input: {
    storyboard: unknown
    preset: unknown
    referenceAssets: unknown[]
  }): Promise<unknown>
}
