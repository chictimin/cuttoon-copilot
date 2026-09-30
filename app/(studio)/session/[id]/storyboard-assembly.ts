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
import storyboardSchema from "@/spec/storyboard.schema.json";
import type { CastMember, Cut, CutCharacter, NarrativeBeat, Storyboard } from "./storyboard-types";

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

// F4(spec-llm-line.md F4절, OC-A F2+F4 단일 API): 서버 연출안을 검증된 것만
// 조립된 컷에 적용한다. BEAT_EXPRESSION_POSE·CUT_SHOT_PLAN·CAPTION_POSITIONS·
// 1컷 morning 기본값은 유지하고, fallback 목록에 든 컷·무효 항목은 건드리지
// 않는다. 등장인물 수·역할·narrative_beat·컷 순서·CTA 위치는 바꾸지 않는다 —
// characters는 해당 컷에 이미 있는 character_id의 표정·포즈만 바꾼다.
// caption_position은 caption.position에 대응하고 bubble_type은 다루지 않는다.
// 허용값은 storyboard.schema.json의 enum에서 읽는다(하드코딩 아님).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readEnum(node: unknown): string[] {
  if (isRecord(node) && Array.isArray(node.enum)) {
    return node.enum.filter((v): v is string => typeof v === "string");
  }
  return [];
}

function cutFieldEnum(field: string): string[] {
  const root = storyboardSchema as unknown;
  const defs = isRecord(root) ? root.$defs : undefined;
  const cut = isRecord(defs) ? defs.cut : undefined;
  const props = isRecord(cut) ? cut.properties : undefined;
  return isRecord(props) ? readEnum(props[field]) : [];
}

function captionPositionEnum(): string[] {
  const root = storyboardSchema as unknown;
  const defs = isRecord(root) ? root.$defs : undefined;
  const cut = isRecord(defs) ? defs.cut : undefined;
  const props = isRecord(cut) ? cut.properties : undefined;
  const caption = isRecord(props) ? props.caption : undefined;
  const captionProps = isRecord(caption) ? caption.properties : undefined;
  return isRecord(captionProps) ? readEnum(captionProps.position) : [];
}

function characterFieldEnum(field: string): string[] {
  const root = storyboardSchema as unknown;
  const defs = isRecord(root) ? root.$defs : undefined;
  const cut = isRecord(defs) ? defs.cut : undefined;
  const props = isRecord(cut) ? cut.properties : undefined;
  const chars = isRecord(props) ? props.characters_in_frame : undefined;
  const items = isRecord(chars) ? chars.items : undefined;
  const itemProps = isRecord(items) ? items.properties : undefined;
  return isRecord(itemProps) ? readEnum(itemProps[field]) : [];
}

const VALID_DIRECTION = {
  shot_type: cutFieldEnum("shot_type"),
  camera_angle: cutFieldEnum("camera_angle"),
  time_of_day: cutFieldEnum("time_of_day"),
  reserved_zone: cutFieldEnum("reserved_zone"),
  caption_position: captionPositionEnum(),
  expression: characterFieldEnum("expression"),
  pose: characterFieldEnum("pose"),
};

for (const [key, values] of Object.entries(VALID_DIRECTION)) {
  if (values.length === 0) {
    throw new Error(
      `storyboard.schema.json에서 연출 허용값 enum을 못 읽음(${key}) — 스키마 경로 확인 필요`
    );
  }
}

function isCutIndex(value: unknown): value is Cut["cut_index"] {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4;
}

export function applyCutDirections(
  cuts: Cut[],
  directions: unknown,
  fallbackCuts: unknown
): Cut[] {
  const fallback = new Set(
    Array.isArray(fallbackCuts)
      ? fallbackCuts.filter((n): n is number => typeof n === "number")
      : []
  );
  const byIndex = new Map<number, Record<string, unknown>>();
  if (Array.isArray(directions)) {
    for (const entry of directions) {
      if (!isRecord(entry)) continue;
      if (isCutIndex(entry.cut_index)) byIndex.set(entry.cut_index, entry);
    }
  }
  if (byIndex.size === 0) return cuts;

  return cuts.map((cut) => {
    if (fallback.has(cut.cut_index)) return cut;
    const dir = byIndex.get(cut.cut_index);
    if (!dir) return cut;

    let next = cut;
    if (typeof dir.shot_type === "string" && VALID_DIRECTION.shot_type.includes(dir.shot_type)) {
      next = { ...next, shot_type: dir.shot_type as Cut["shot_type"] };
    }
    if (
      typeof dir.camera_angle === "string" &&
      VALID_DIRECTION.camera_angle.includes(dir.camera_angle)
    ) {
      next = { ...next, camera_angle: dir.camera_angle as Cut["camera_angle"] };
    }
    if (
      typeof dir.time_of_day === "string" &&
      VALID_DIRECTION.time_of_day.includes(dir.time_of_day)
    ) {
      next = { ...next, time_of_day: dir.time_of_day as Cut["time_of_day"] };
    }
    if (
      typeof dir.reserved_zone === "string" &&
      VALID_DIRECTION.reserved_zone.includes(dir.reserved_zone)
    ) {
      next = { ...next, reserved_zone: dir.reserved_zone as Cut["reserved_zone"] };
    }
    if (
      typeof dir.caption_position === "string" &&
      VALID_DIRECTION.caption_position.includes(dir.caption_position)
    ) {
      next = {
        ...next,
        caption: { ...next.caption, position: dir.caption_position as Cut["caption"]["position"] },
      };
    }
    if (Array.isArray(dir.characters)) {
      const overrides = new Map<string, { expression: CutCharacter["expression"]; pose: CutCharacter["pose"] }>();
      for (const item of dir.characters) {
        if (!isRecord(item)) continue;
        const { character_id, expression, pose } = item;
        if (
          typeof character_id === "string" &&
          typeof expression === "string" &&
          VALID_DIRECTION.expression.includes(expression) &&
          typeof pose === "string" &&
          VALID_DIRECTION.pose.includes(pose)
        ) {
          overrides.set(character_id, {
            expression: expression as CutCharacter["expression"],
            pose: pose as CutCharacter["pose"],
          });
        }
      }
      if (overrides.size > 0) {
        next = {
          ...next,
          characters_in_frame: next.characters_in_frame.map((character) => {
            const override = overrides.get(character.character_id);
            return override ? { ...character, ...override } : character;
          }),
        };
      }
    }
    return next;
  });
}
