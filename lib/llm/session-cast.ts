// 세션 시작 시 cast를 한 번 확정한다 (issue #150 C2 재설계).
//
// 입력은 브레인스토밍 답변(주인공·조연 선택)과 프로젝트 마스코트다. 캐릭터 풀
// (counterparts)·지도사 ID(instructorCharacterId) 필수 입력은 없앴다 — 풀은
// #202로 보류됐고, 조연은 "마스코트 기본 후보 + 자유 입력 유지"다.
// 마스코트 조연의 판별은 brainstorm-options.ts의 isMascotOption이 맡는다.
//
// storyboard.schema.json의 cast는 maxItems 2 + protagonist 정확히 1명이므로
// 구성은 [주인공(protagonist), 조연(supporting, 있을 때만)]뿐이다.
// PRD 2절의 "등장 캐릭터 1~2명"(협상 불가)을 여기서 지킨다.
//
// 선택은 반드시 세션당 1회다. 컷마다 다시 뽑으면 4컷 안에서 인물·옷색이 바뀌어,
// 유일한 일관성 방어 수단인 "캐릭터 시트 매 컷 reference 주입"과 정면
// 충돌한다(PRD 2절).
//
// 클라이언트에서도 import한다 — OPENAI_API_KEY를 쓰는 모듈을 import하지 않는다.

import { NO_SUPPORTING_OPTION, isMascotOption, type MascotRef } from "./brainstorm-options";

export type { MascotRef };

export interface BuildSessionCastInput {
  /** 브레인스토밍 주인공 답변. 비어 있으면 안 된다. */
  protagonist: string;
  /** 브레인스토밍 조연 답변. null·"혼자 진행"이면 조연 없음. */
  supporting: string | null;
  /** 프로젝트 마스코트. 없으면 마스코트 판별을 하지 않는다. */
  mascot?: MascotRef;
  /**
   * 주인공 상의 색 후보(예: preset.style.palette). 세션당 하나를 뽑아 4컷 내내
   * 고정한다. 비우면 색을 지정하지 않는다(캐릭터 시트 원본 색을 그대로 씀).
   * 조연에게는 적용하지 않는다 — 마스코트는 고정된 외형이라 의상을 건드리지
   * 않고, 자유 입력 조연은 세션 내내 같은 인물이라는 전제가 없다.
   */
  palette: string[];
  /** 테스트에서 결정적으로 만들기 위한 주입점. 기본값 Math.random */
  random?: () => number;
}

export interface CastMember {
  character_id: string;
  role: "protagonist" | "supporting";
  description: string;
}

export interface SessionCast {
  /** storyboard.cast에 그대로 넣을 수 있는 배열 */
  cast: CastMember[];
  /** 세션 내내 고정되는 주인공의 상의 색. palette를 안 넘겼으면 null */
  shirtColor: string | null;
}

export class SessionCastError extends Error {}

/**
 * 주인공 머리 기본값. 머리 언급이 전혀 없을 때(H4) 붙는다.
 */
export const DEFAULT_PROTAGONIST_HAIR = "짧은 검은 머리";

/**
 * 머리 스타일만 있고 색이 없을 때(H3) 붙는 색 보완 조각.
 */
export const DEFAULT_PROTAGONIST_HAIR_COLOR = "검은 머리";

// 판정 단어. 고정된 최소 목록이다.
// 와인은 `와인색`일 때만 색이다 — 단독 와인은 목록에 넣지 않고 ○색(generic)으로만 잡는다.
// `염색`·`탈색`은 색이 아니라 행위라서 generic에서 제외한다
// ("염색한 머리"는 H3, "탈색한 머리"는 알려진 한계로 H4).
const KOREAN_COLOR_BASE =
  "검은|검정|까만|흑|흰|하얀|백|빨간|빨강|붉은|적|주황|노란|노랑|초록|녹색|연두|파란|파랑|청|하늘색|남색|보라|분홍|핑크|회색|잿빛|은색|금색|갈색|밤색|베이지|아이보리|민트|네이비|카키|버건디";
const COLOR_GENERIC_SRC = "(?!염색|탈색)[가-힣]{1,6}색";
const COLOR_DEPTH_PREFIX_SRC = "(?:짙은|진한|연한|옅은)\\s+";
const COLOR_TOKEN_SRC = `(?:${COLOR_DEPTH_PREFIX_SRC})?(?:${KOREAN_COLOR_BASE}|${COLOR_GENERIC_SRC})(?:\\s*색(?:\\s*의)?)?`;

const HAIR_NOUN_SRC = "머리카락|모발|머리|헤어";

// H2 머리색: 색 단어 (+색/색의/공백/붙여쓰기) + 머리 명사
// (색과 머리 사이 스타일 수식 1어절 허용 — "검정색의 긴 머리", "짙은 갈색 곱슬머리").
const HAIR_COLOR_FORWARD_RE = new RegExp(
  `${COLOR_TOKEN_SRC}\\s*(?:[가-힣A-Za-z0-9]+\\s*)?(?:${HAIR_NOUN_SRC})`,
);
// H2 역순: 머리 명사 + 조사 + 색 단어/서술어 ("머리는 갈색", "머리카락이 검다").
const HAIR_COLOR_REVERSE_RE = new RegExp(
  `(?:${HAIR_NOUN_SRC})\\s*(?:는|은|이|가)\\s*(?:${KOREAN_COLOR_BASE}|${COLOR_GENERIC_SRC}|검다|까맣다|하얗다|희다|빨갛다|붉다|노랗다|파랗다)`,
);
// H2 색-게 염색 ("검게 염색한 머리"). 색 없는 "염색한 머리"는 해당 없음(→H3).
const HAIR_DYED_RE = /(?:검|까맣|하얗|희|빨갛|붉|노랗|파랗)게\s*염색/;
// H2 단독 ("금발", "흰머리", "새치" 등).
const HAIR_COLOR_SINGLE_RE = /금발|은발|백발|흑발|적발|흰\s*머리|새치/;

// H2 영문 (단어 경계).
const EN_HAIR_COLOR_SRC =
  "black|brown|blond|blonde|red|white|gray|grey|silver|pink|blue|auburn|ginger";
const HAIR_COLOR_EN_RE = new RegExp(`\\b(?:${EN_HAIR_COLOR_SRC})\\s+hair\\b`, "i");
const HAIR_COLORED_EN_RE = /\b[a-z]+-haired\b/i;
const HAIR_IS_EN_RE = new RegExp(`\\bhair\\s+is\\s+(?:${EN_HAIR_COLOR_SRC})\\b`, "i");

// H1 무모.
const HAIRLESS_RE = /대머리|민머리|삭발|빡빡머리|까까머리/;
const HAIRLESS_EN_RE = /\b(?:bald|shaved head)\b/i;

// H3 스타일만 (색 없음).
const HAIR_STYLE_RE =
  /긴\s*머리|장발|단발|숏컷|커트\s*머리|짧은\s*머리|포니테일|묶은\s*머리|머리를\s*묶|올림머리|똥머리|땋은|곱슬|파마|펌\s*머리|웨이브|생머리|투블럭|앞머리|염색한\s*머리|머리가\s*(?:긴|짧은|길고|짧고)/;
const HAIR_STYLE_EN_RE = /\b(?:long hair|short hair|ponytail|braids?|braided|curly|bob cut|bun)\b/i;

type HairMention = "hairless" | "colored" | "style-only" | "none";

// 머리 3단 규칙 (H1 무모 → H2 머리색 → H3 모양만 → H4 언급 없음). 판정 순서대로 첫 해당 단에서 끝난다.
function classifyHairMention(protagonist: string): HairMention {
  // 기본 문구가 이미 있으면 H2로 생략 → 중복 삽입 0.
  if (protagonist.includes(DEFAULT_PROTAGONIST_HAIR)) {
    return "colored";
  }
  if (HAIRLESS_RE.test(protagonist) || HAIRLESS_EN_RE.test(protagonist)) {
    return "hairless";
  }
  if (
    HAIR_COLOR_SINGLE_RE.test(protagonist) ||
    HAIR_COLOR_FORWARD_RE.test(protagonist) ||
    HAIR_COLOR_REVERSE_RE.test(protagonist) ||
    HAIR_DYED_RE.test(protagonist) ||
    HAIR_COLOR_EN_RE.test(protagonist) ||
    HAIR_COLORED_EN_RE.test(protagonist) ||
    HAIR_IS_EN_RE.test(protagonist)
  ) {
    return "colored";
  }
  if (HAIR_STYLE_RE.test(protagonist) || HAIR_STYLE_EN_RE.test(protagonist)) {
    return "style-only";
  }
  return "none";
}

const TOP_WORD_SRC =
  "와이셔츠|티셔츠|맨투맨|앞치마|블라우스|스웨터|유니폼|카디건|가디건|셔츠|남방|상의|재킷|자켓|코트|원피스|니트|후드|후디|조끼|정장|양복|점퍼|가운|옷|티";
// 상의 단어 뒤 경계: 끝·공백·문장부호·조사만 허용 → "하얀 티켓" 오탐 0.
const TOP_TAIL_SRC =
  "(?=$|[\\s.,!?…()\\[\\]{}\"'—–-]|으로|차림|[을를이가은는에의와과도만로])";
const CLOTHING_HEX_SRC = "#[0-9A-Fa-f]{6}";

// 옷 색: 색 단어/HEX + (색/색의) + 수식 1어절까지 + 상의 단어 ("빨간 체크 셔츠", "#ff0000재킷").
const CLOTHING_FORWARD_RE = new RegExp(
  `(?:${COLOR_DEPTH_PREFIX_SRC})?(?:${CLOTHING_HEX_SRC}|${KOREAN_COLOR_BASE}|${COLOR_GENERIC_SRC})(?:\\s*색(?:\\s*의)?)?\\s*(?:[가-힣A-Za-z0-9]+\\s*)?(?:${TOP_WORD_SRC})${TOP_TAIL_SRC}`,
);
// 옷 색 역순: 상의 단어 + 조사 + 색 단어 ("셔츠는 빨간색").
const CLOTHING_REVERSE_RE = new RegExp(
  `(?:${TOP_WORD_SRC})(?:는|은|이|가)\\s*(?:${CLOTHING_HEX_SRC}|${COLOR_TOKEN_SRC})`,
);
// 옷 색 영문 (단어 경계).
const EN_CLOTH_COLOR_SRC =
  "black|white|red|blue|navy|brown|gray|grey|green|yellow|orange|pink|purple|beige|ivory|mint|khaki|burgundy|wine|silver|gold";
const CLOTHING_EN_RE = new RegExp(
  `\\b(?:${EN_CLOTH_COLOR_SRC})\\s+(?:shirt|t-shirt|top|jacket|coat|dress|sweater|hoodie|uniform|suit|gown|blouse)\\b`,
  "i",
);

// 하의·잡화(바지·치마·신발·모자·가방 등)는 상의 단어 목록에 없어서 상의 언급이 아니다 —
// "검은 바지 학생"은 상의 기본값이 붙고, "검은 바지에 빨간 셔츠"는 "빨간 셔츠"로 생략된다.
function hasClothingColorMention(protagonist: string): boolean {
  return (
    CLOTHING_FORWARD_RE.test(protagonist) ||
    CLOTHING_REVERSE_RE.test(protagonist) ||
    CLOTHING_EN_RE.test(protagonist)
  );
}

/**
 * 주인공 description 뒤에 붙일 외형 조각 목록.
 * 순서 고정: 머리 → 상의. 머리(H1~H4)와 상의는 각자 독립 판정한다
 * (사용자 서술 우선 + 기본값) — 옷색만 있는 서술에도 H4 머리가 붙는다.
 * 결정적: 같은 protagonist + 순서까지 같은 palette면 같은 출력.
 * 난수·시각 의존 없음. 입력 문자열·배열을 변경하지 않는다.
 */
export function protagonistAppearance(protagonist: string, palette: string[]): string[] {
  const pieces: string[] = [];
  const hair = classifyHairMention(protagonist);
  if (hair === "style-only") {
    pieces.push(DEFAULT_PROTAGONIST_HAIR_COLOR);
  } else if (hair === "none") {
    pieces.push(DEFAULT_PROTAGONIST_HAIR);
  }
  if (!hasClothingColorMention(protagonist) && palette.length > 0) {
    pieces.push(`상의 ${palette[0]}`);
  }
  return pieces;
}

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

/**
 * 상의 색 후보(예: preset.style.palette) 중 하나를 세션당 1회 뽑는다.
 *
 * 호환용으로 export를 유지한다. buildSessionCast는 palette[0] 고정을 쓰고
 * 이 함수를 호출하지 않는다.
 */
export function pickShirtColor(colors: string[], random: () => number = Math.random): string | null {
  return colors.length ? pick(colors, random) : null;
}

/**
 * 세션 cast를 확정한다. 세션 생성 시점에 한 번만 호출할 것 — 반환값을 저장해두고
 * 4컷 전부가 같은 값을 참조해야 한다.
 *
 * - 조연 답변이 마스코트 후보 문자열이면 조연 = 마스코트(character_id는
 *   mascot.label, description은 mascot.description).
 * - 자유 입력이면 character_id "supporting"에 입력값을 그대로 싣는다(현행).
 * - null·"혼자 진행 (조연 없음)"·빈 문자열이면 주인공만.
 */
export function buildSessionCast(input: BuildSessionCastInput): SessionCast {
  // random은 받되 쓰지 않는다 — 상의 색은 palette[0] 고정이라 호출처를 바꾸지 않아도 된다.
  // (결정성: 호출 시 throw하는 random을 주입해도 성공한다.)
  const { protagonist, supporting, mascot, palette } = input;

  if (!protagonist || protagonist.trim().length === 0) {
    throw new SessionCastError("protagonist가 비어 있음");
  }

  const pieces = protagonistAppearance(protagonist, palette);

  // 색은 storyboard.schema.json에 전용 필드가 없어서 description에 실어 B팀 프롬프트 조립으로
  // 넘긴다 (PRD: 최종 프롬프트 문자열 조립은 B 소유, A는 값까지만 넘긴다).
  // 주인공에만 붙인다. 원문은 앞에 그대로, 손대지 않는다.
  const protagonistDescription = [protagonist, ...pieces].join(", ");

  // 상의 조각을 붙였으면 palette[0](대소문자·표기 그대로),
  // 사용자 옷 색 우선으로 생략했거나 palette가 비었으면 null.
  const lastPiece: string | undefined = pieces[pieces.length - 1];
  const shirtColor: string | null =
    lastPiece !== undefined && lastPiece.startsWith("상의 ") && palette.length > 0
      ? palette[0]
      : null;

  const cast: CastMember[] = [
    {
      character_id: "protagonist",
      role: "protagonist",
      description: protagonistDescription,
    },
  ];

  if (!supporting || supporting.trim().length === 0 || supporting === NO_SUPPORTING_OPTION) {
    return { cast, shirtColor };
  }
  if (mascot && isMascotOption(supporting, mascot)) {
    cast.push({
      character_id: mascot.label,
      role: "supporting",
      description: mascot.description,
    });
    return { cast, shirtColor };
  }
  cast.push({ character_id: "supporting", role: "supporting", description: supporting });
  return { cast, shirtColor };
}
