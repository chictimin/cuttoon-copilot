// spec/storyboard.schema.json (A①, 2026-08-19 확정)의 caption/cut 모양을 그대로 따른다 —
// 필드 이름을 캐멀케이스로 바꾸지 않고 스키마와 1:1로 맞춰서, 나중에 실제 storyboard
// 객체를 넘길 때 변환 코드가 따로 필요 없게 한다.

export type BubbleType = "rounded" | "rect" | "cloud";
export type Position = "top_left" | "top_right" | "bottom_left" | "bottom_right" | "center";

export interface Caption {
  text: string;
  bubble_type: BubbleType;
  position: Position;
  // #242: 2인 컷에서 대사를 말하는 인물의 characters_in_frame 순번(0|1). 저장 검사(#295)를 거친
  // 값이지만 과거 저장본·범위 밖 값도 들어올 수 있어 headTargetForCut()이 0/1만 쓴다.
  speaker_index?: number;
  // #242: 사용자가 드래그한 말풍선 몸통 중심(원본 이미지 비율 0~1). 스키마에는 들어왔지만
  // Export는 아직 읽지 않는다 — 에디터 드래그(#242 JEON) 이후 반영.
  anchor?: { x: number; y: number };
}

export interface Cut {
  cut_index: number;
  caption: Caption;
  // 렌더링에 필요한 것만 가져온다 — narrative_beat/shot_type 등 나머지 필드는
  // lib/render/가 안 쓰므로 여기 타입엔 안 실었다.
  // 꼬리 목표점 보정용(#242 나). storyboard.schema.json의 shot_type enum 그대로 받는다.
  shot_type?: string | null;
  // 화자 목표점용(#242 가) — 인물 수만 본다(2인 컷인지). 각 인물의 내용은 읽지 않는다.
  characters_in_frame?: readonly unknown[] | null;
  // asset:// 참조는 lib/asset-store.ts가, 데모 캐시 public 경로("/demo-cache/…")는
  // lib/render/demo-cache.ts가 해석한다(#240).
  generated_image: string | null;
}
