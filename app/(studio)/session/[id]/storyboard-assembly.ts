// 세션(A②) 스토리보드 조립. 3턴 답변을 storyboard.schema.json 형태로 엮는다.
//
// 이 파일은 mock이 아니다 — 규칙 기반 조립이 실제 동작이다(issue #84로
// mock-brainstorm.ts에서 이름을 바꿨다). 브레인스토밍 선택지 생성은 실제 LLM
// (`POST /api/brainstorm`)으로 넘어갔고, 여기 남은 것은 그 답변을 4컷 구조로
// 변환하는 결정적 로직이다.
//
// PRD.md 6절: "최대 3턴, 매 턴 선택지 3개 + 직접 쓸게 + 알아서 해줘. 종료 판정은
// 필수 슬롯이 전부 찼는가로 결정적이어야 한다."

import type { CastMember, Cut, NarrativeBeat, Storyboard } from "./storyboard-types";

const NO_SUPPORTING_OPTION = "혼자 진행 (조연 없음)";

// 흐름 선택은 자유 텍스트가 아니라 NarrativeBeat 템플릿을 고르는 것이다. beat 값은
// storyboard.schema.json의 narrative_beat enum에 묶여 있어서 임의 문자열로 대체할 수
// 없다. 그래서 이 턴만은 LLM 생성 선택지를 쓰지 않고 여기 키를 그대로 화면에 낸다 —
// 키가 어긋나면 아래 조립이 조용히 첫 템플릿으로 폴백해 흐름 선택이 무의미해진다.
const FLOW_BEATS: Record<string, NarrativeBeat[]> = {
  "문제 제기 → 이전 상황 → 해결 → CTA": ["problem", "before", "solution", "cta"],
  "질문 던지기 → 사실 전달 → 효과 강조 → CTA": ["question", "fact", "benefit", "cta"],
  "이전 상황 → 전환 계기 → 이후 → CTA": ["before", "turning", "after", "cta"],
};

/** 화면의 flow 턴 선택지. FLOW_BEATS 키와 항상 일치해야 한다. */
export const FLOW_OPTIONS = Object.keys(FLOW_BEATS);

export const FLOW_QUESTION = "어떤 흐름으로 풀어볼까요?";

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
