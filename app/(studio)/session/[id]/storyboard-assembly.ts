// 세션(A②) 스토리보드 조립. 3턴 답변을 storyboard.schema.json 형태로 엮는다.
//
// 이 파일은 mock이 아니다 — 규칙 기반 조립이 실제 동작이다(issue #84로
// mock-brainstorm.ts에서 이름을 바꿨다). 브레인스토밍 선택지 생성은 실제 LLM
// (`POST /api/brainstorm`)으로 넘어갔고, 여기 남은 것은 그 답변을 4컷 구조로
// 변환하는 결정적 로직이다.
//
// PRD.md 6절: "최대 3턴, 매 턴 선택지 3개 + 직접 쓸게 + 알아서 해줘. 종료 판정은
// 필수 슬롯이 전부 찼는가로 결정적이어야 한다."

import { pickShirtColor } from "@/lib/llm/session-cast";
import { getBeatsForFlow, getFlowOptions } from "@/lib/llm/narrative-flow";
import { NO_SUPPORTING_OPTION } from "@/lib/llm/brainstorm-options";
import type { CastMember, Cut, NarrativeBeat, Storyboard } from "./storyboard-types";

// issue #119-2 (갈래 3): 흐름 템플릿 3종(키·beats 시퀀스)은 spec/data/narrative-flow.json
// 으로 옮겼다 — 값은 하나도 안 바뀌었다(lib/llm/narrative-flow.ts 참고). 흐름 선택은
// 자유 텍스트가 아니라 NarrativeBeat 템플릿을 고르는 것이라(storyboard.schema.json의
// narrative_beat enum), 이 턴만은 여전히 LLM 생성 선택지를 쓰지 않고 데이터 파일의
// 키를 그대로 화면에 낸다 — 키가 어긋나면 아래 조립이 조용히 첫 템플릿으로 폴백해
// 흐름 선택이 무의미해진다. LLM이 이 키를 직접 고르게 하는 것은 #113/#133 판정
// 케이스(흐름 3종 전제, 케이스 2·4 아직 미실행)와 얽혀 있어 이번 변경 범위 밖이다.
const DEFAULT_FLOW_KEY = "문제 제기 → 이전 상황 → 해결 → CTA";

/** 화면의 flow 턴 선택지. narrative-flow.json의 키와 항상 일치한다. */
export const FLOW_OPTIONS = getFlowOptions();

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
//
// issue #123 (축소판): 주인공 상의 색을 세션당 1회 뽑아 cast[].description에 실어
// 4컷·표지 3안이 같은 값을 참조하게 한다. 케이스 5 실측(#113)에서 이 배정이 없어
// 4컷 내내 색이 흔들리는 것을 확인했다 — 팔레트가 "색의 집합"만 정하고 "배정"을
// 정하지 않아서다. 조연(자유 입력 유지, #123 결정)에는 붙이지 않는다 — 원래
// session-cast.ts의 설계(고정 마스코트에는 의상을 안 건드린다)와 같은 이유로,
// 조연은 프로젝트 마스코트가 아니라 그때그때 자유 입력되는 인물이라 의상을
// 고정할 근거(세션 내내 같은 인물이라는 전제) 자체가 없다.
export function assembleStoryboard(
  subject: string,
  answers: BrainstormAnswers,
  palette: string[] = []
): Storyboard {
  const beats = (getBeatsForFlow(answers.flow) ?? getBeatsForFlow(DEFAULT_FLOW_KEY)!) as NarrativeBeat[];
  const hasSupporting = answers.supporting !== null && answers.supporting !== NO_SUPPORTING_OPTION;

  const shirtColor = pickShirtColor(palette);
  const protagonistDescription = shirtColor
    ? [answers.protagonist, `상의 ${shirtColor}`].filter(Boolean).join(", ")
    : answers.protagonist;

  const cast: CastMember[] = [
    { character_id: "protagonist", role: "protagonist", description: protagonistDescription },
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
