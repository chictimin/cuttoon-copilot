// spec/ 계약: ImageProvider 어댑터. 구현은 B①.
export interface ImageProvider {
  extractStyle(refs: Buffer[]): Promise<unknown>
  generateCharacterSheet(preset: unknown): Promise<unknown>
  generateCut(input: {
    storyboard: unknown
    preset: unknown
    referenceAssets: unknown[]
  }): Promise<unknown>
}
