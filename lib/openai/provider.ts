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
  }): Promise<unknown>
}
