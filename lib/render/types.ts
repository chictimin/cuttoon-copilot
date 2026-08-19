// spec/storyboard.schema.json (A①, 2026-08-19 확정)의 caption/cut 모양을 그대로 따른다 —
// 필드 이름을 캐멀케이스로 바꾸지 않고 스키마와 1:1로 맞춰서, 나중에 실제 storyboard
// 객체를 넘길 때 변환 코드가 따로 필요 없게 한다.

export type BubbleType = "rounded" | "rect" | "cloud";
export type Position = "top_left" | "top_right" | "bottom_left" | "bottom_right" | "center";

export interface Caption {
  text: string;
  bubble_type: BubbleType;
  position: Position;
}

export interface Cut {
  cut_index: number;
  caption: Caption;
  // 렌더링에 필요한 것만 가져온다 — narrative_beat/shot_type 등 나머지 필드는
  // lib/render/가 안 쓰므로 여기 타입엔 안 실었다.
  generated_image: string | null; // asset:// 참조, lib/asset-store.ts가 해석
}
