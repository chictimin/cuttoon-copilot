// spec/ 계약: ImageProvider 어댑터. 구현은 B①.
export interface StyleExtractionResult {
  line_weight: "thin" | "medium" | "thick";
  saturation: "pastel" | "vivid" | "muted";
  character_ratio: "2head" | "2.5head" | "3head" | "realistic";
  background_density: "none" | "low" | "medium" | "high";
  bubble_style: "rounded" | "rect" | "cloud";
  palette: string[];
}

export interface CharacterSheetResult {
  imageBase64: string;
  revisedPrompt: string;
  responseId?: string; // Responses API 체이닝용
}

export interface CutGenerationInput {
  cutIndex: number;
  prompt: string;
  referenceImageBase64?: string; // 캐릭터 시트 참조
  previousResponseId?: string; // 멀티턴 체이닝
}

export interface CutGenerationResult {
  imageBase64: string;
  revisedPrompt: string;
  responseId: string; // 다음 컷 체이닝용
}

export interface ImageProvider {
  extractStyle(refs: Buffer[]): Promise<StyleExtractionResult>;
  generateCharacterSheet(preset: unknown): Promise<CharacterSheetResult>;
  generateCut(input: CutGenerationInput): Promise<CutGenerationResult>;
}
