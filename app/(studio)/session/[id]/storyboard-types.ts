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
}

export interface Storyboard {
  storyboard_version: "1.0";
  subject: string;
  cast: CastMember[];
  cuts: Cut[];
}
