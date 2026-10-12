// 임시 타입. lib/llm/에 정식 Storyboard 타입이 나오면 교체 (PRD.md 5절 "화면마다 가안
// 타입을 따로 두지 않는다" — 그때까지 spec/storyboard.schema.json 구조를 그대로 옮겨 쓴다).

export type NarrativeBeat =
  | "hook"
  | "problem"
  | "solution"
  | "cta"
  | "question"
  | "fact"
  | "benefit"
  | "before"
  | "turning"
  | "after";

export type ShotType = "closeup" | "bust" | "waist" | "full" | "wide";
export type CameraAngle = "eye" | "high" | "low";
export type TimeOfDay = "morning" | "noon" | "evening" | "night";
export type Expression =
  | "neutral"
  | "smile"
  | "laugh"
  | "tired"
  | "worried"
  | "surprised"
  | "determined"
  | "relieved";
export type Pose =
  | "stand"
  | "sit"
  | "slump"
  | "point"
  | "arms_up"
  | "walk"
  | "stretch"
  | "lie_down";
export type BubbleType = "rounded" | "rect" | "cloud";
export type CaptionPosition = "top_left" | "top_right" | "bottom_left" | "bottom_right" | "center";
export type ReservedZone = "top" | "bottom" | "left" | "right";
export type CastRole = "protagonist" | "supporting";

export interface CastMember {
  character_id: string;
  role: CastRole;
  description: string;
}

export interface CutCharacter {
  character_id: string;
  expression: Expression;
  pose: Pose;
}

export interface Caption {
  text: string;
  bubble_type: BubbleType;
  position: CaptionPosition;
  speaker_index?: 0 | 1;
  anchor?: { x: number; y: number };
}

export interface Cut {
  cut_index: 1 | 2 | 3 | 4;
  narrative_beat: NarrativeBeat;
  shot_type: ShotType;
  camera_angle: CameraAngle;
  time_of_day?: TimeOfDay;
  characters_in_frame: CutCharacter[];
  caption: Caption;
  reserved_zone?: ReservedZone;
  cta_override?: string | null;
  generated_image: string | null;
  prompt_used: string | null;
  /**
   * POC 한정(#326 구조변경). 다시 그리기 자유 입력 등 컷별 추가 지시.
   * 요청 복사본에만 싣고 저장 스토리보드에는 남기지 않는다.
   */
  direction_note?: string;
}

export interface Storyboard {
  storyboard_version: "1.0";
  subject: string;
  cast: CastMember[];
  cuts: Cut[];
  /** 이 컷툰 한 편의 CTA 강도 (issue #205). 없으면 clear로 해석. */
  cta_strength?: "none" | "soft" | "clear";
  /**
   * POC 한정(#326, main 반영 아님). 확정 레퍼런스 컷 asset(asset://… 또는 /demo-cache/…).
   * 컷 생성 요청 본문의 reference_asset으로 실어 보낸다(서버 연결은 후속).
   */
  reference_image?: string | null;
}
