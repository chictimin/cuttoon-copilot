// spec/vocabulary.json에 이미 확정된 값들만 사용한다 — storyboard.schema.json이
// 아직 안 나와도 이 부분은 팀이 이미 합의한 값이라 안전하게 앞서 구현할 수 있다.

export type BubbleType = "rounded" | "rect" | "cloud";
export type Position = "top_left" | "top_right" | "bottom_left" | "bottom_right" | "center";

export interface CaptionInput {
  text: string;
  bubbleType: BubbleType;
  position: Position;
}
