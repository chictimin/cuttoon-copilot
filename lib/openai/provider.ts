// spec/ 계약: ImageProvider 어댑터. 구현은 B①.
export interface ImageProvider {
  extractStyle(refs: Buffer[]): Promise<unknown>
  generateCharacterSheet(preset: unknown): Promise<{
    asset: string
    responseId?: string
  }>

  // 표지 3안을 독립적인 호출로 생성합니다.
  // 3안은 각각 다른 특성을 유지하도록 병렬 호출되며, 체이닝이 없습니다.
  generateCoverVariants(promptBase: string): Promise<Array<{
    asset: string
    responseId?: string
  }>>

  // 컷 이미지를 생성합니다 (previous_response_id로 이전 턴 응답을 체이닝 지원).
  generateCut(input: {
    storyboard: unknown
    preset: unknown
    referenceAssets: unknown[]
    previousResponseId?: string
  }): Promise<{
    asset: string
    responseId?: string
  }>
}
