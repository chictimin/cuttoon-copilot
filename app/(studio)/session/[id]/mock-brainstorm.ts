// 세션(A②) 임시 브레인스토밍 mock. 3턴 슬롯채우기 LLM은 A①(lib/llm/) 소관이지만 아직
// 없어서 내 폴더 안에 mock을 둔다 (담당 아닌 폴더에 임시 파일을 만들지 않는다 — 팀 브랜치
// 규약). PRD.md 6절: "최대 3턴, 매 턴 선택지 3개 + 직접 쓸게 + 알아서 해줘. 종료 판정은
// 필수 슬롯이 전부 찼는가로 결정적이어야 한다."

import type { CastMember, Cut, NarrativeBeat, Storyboard } from "./storyboard-types";

export interface BrainstormTurn {
  key: "protagonist" | "supporting" | "flow";
  question: string;
  options: string[];
}

export const BRAINSTORM_TURNS: BrainstormTurn[] = [
  {
    key: "protagonist",
    question: "주인공은 누구인가요?",
    options: [
      "무릎이 아픈 60대 어머니",
      "다이어트 중인 20대 직장인",
      "허리가 안 좋은 40대 아버지",
    ],
  },
  {
    key: "supporting",
    question: "함께 등장할 인물이 있나요?",
    options: ["노인운동 지도사", "가족 한 명", "혼자 진행 (조연 없음)"],
  },
  {
    key: "flow",
    question: "어떤 흐름으로 풀어볼까요?",
    options: [
      "문제 제기 → 이전 상황 → 해결 → CTA",
      "질문 던지기 → 사실 전달 → 효과 강조 → CTA",
      "이전 상황 → 전환 계기 → 이후 → CTA",
    ],
  },
];

const NO_SUPPORTING_OPTION = "혼자 진행 (조연 없음)";

const FLOW_BEATS: Record<string, NarrativeBeat[]> = {
  "문제 제기 → 이전 상황 → 해결 → CTA": ["problem", "before", "solution", "cta"],
  "질문 던지기 → 사실 전달 → 효과 강조 → CTA": ["question", "fact", "benefit", "cta"],
  "이전 상황 → 전환 계기 → 이후 → CTA": ["before", "turning", "after", "cta"],
};

const BEAT_EXPRESSION_POSE: Record<NarrativeBeat, { expression: Cut["characters_in_frame"][number]["expression"]; pose: Cut["characters_in_frame"][number]["pose"] }> = {
  hook: { expression: "surprised", pose: "stand" },
  problem: { expression: "worried", pose: "sit" },
  solution: { expression: "determined", pose: "stand" },
  cta: { expression: "laugh", pose: "walk" },
  question: { expression: "worried", pose: "stand" },
  fact: { expression: "neutral", pose: "stand" },
  benefit: { expression: "smile", pose: "arms_up" },
  before: { expression: "tired", pose: "slump" },
  turning: { expression: "determined", pose: "point" },
  after: { expression: "relieved", pose: "stretch" },
};

const BEAT_CAPTION: Record<NarrativeBeat, (subject: string) => string> = {
  hook: (s) => `${s}, 이거 알고 계셨나요?`,
  problem: (s) => `${s} 때문에 정말 힘들었어요`,
  before: () => "이러다 안 되겠다 싶었죠",
  turning: () => "그러다 방법을 하나 찾았어요",
  solution: () => "이렇게 하니까 확실히 달라졌어요",
  after: () => "지금은 훨씬 편해졌어요",
  benefit: () => "이 방법의 진짜 효과는 따로 있어요",
  fact: () => "사실은 이런 이유가 있었어요",
  question: (s) => `${s}, 왜 그런 걸까요?`,
  cta: () => "지금 바로 확인해보세요",
};

const CUT_SHOT_PLAN: { shot_type: Cut["shot_type"]; camera_angle: Cut["camera_angle"] }[] = [
  { shot_type: "closeup", camera_angle: "eye" },
  { shot_type: "full", camera_angle: "eye" },
  { shot_type: "waist", camera_angle: "eye" },
  { shot_type: "wide", camera_angle: "low" },
];

const CAPTION_POSITIONS: Cut["caption"]["position"][] = [
  "top_left",
  "top_right",
  "top_left",
  "top_left",
];

export interface BrainstormAnswers {
  protagonist: string;
  supporting: string | null;
  flow: string;
}

// TODO(A①): 실제 3턴 슬롯채우기 LLM 호출로 교체. 지금은 즉석에서 조립만 한다.
export function assembleStoryboard(subject: string, answers: BrainstormAnswers): Storyboard {
  const beats = FLOW_BEATS[answers.flow] ?? FLOW_BEATS["문제 제기 → 이전 상황 → 해결 → CTA"];
  const hasSupporting = answers.supporting !== null && answers.supporting !== NO_SUPPORTING_OPTION;

  const cast: CastMember[] = [
    { character_id: "protagonist", role: "protagonist", description: answers.protagonist },
  ];
  if (hasSupporting && answers.supporting) {
    cast.push({ character_id: "supporting", role: "supporting", description: answers.supporting });
  }

  const cuts: Cut[] = beats.map((beat, i) => {
    const { expression, pose } = BEAT_EXPRESSION_POSE[beat];
    const charactersInFrame: Cut["characters_in_frame"] = [
      { character_id: "protagonist", expression, pose },
    ];
    // 조연은 CTA 직전 컷(3번째)에만 함께 등장시킨다 — 흐름 템플릿 3종 공통 규칙
    if (hasSupporting && i === 2) {
      charactersInFrame.push({ character_id: "supporting", expression: "smile", pose: "point" });
    }

    const cutIndex = (i + 1) as Cut["cut_index"];

    return {
      cut_index: cutIndex,
      narrative_beat: beat,
      shot_type: CUT_SHOT_PLAN[i].shot_type,
      camera_angle: CUT_SHOT_PLAN[i].camera_angle,
      ...(i === 0 ? { time_of_day: "morning" as const } : {}),
      characters_in_frame: charactersInFrame,
      caption: {
        text: BEAT_CAPTION[beat](subject),
        bubble_type: "rounded",
        position: CAPTION_POSITIONS[i],
      },
      reserved_zone: CAPTION_POSITIONS[i].startsWith("top") ? "top" : "bottom",
      ...(beat === "cta" ? { cta_override: null } : {}),
      generated_image: null,
      prompt_used: null,
    };
  });

  return {
    storyboard_version: "1.0",
    subject,
    cast,
    cuts,
  };
}
