// 가안(temporary) 타입. spec/preset.schema.json이 아직 비어 있어(A① 확정 전)
// 온보딩 화면 작업을 위해 로컬로 유지한다. 스키마 확정 시 교체.

export interface Preset {
  reference_images: string[];
  character_sheet: unknown;
  color_palette: unknown;
  background_tone: unknown;
}
