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

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

/**
 * 상의 색 후보(예: preset.style.palette) 중 하나를 세션당 1회 뽑는다.
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
  const { protagonist, supporting, mascot, palette, random = Math.random } = input;

  if (!protagonist || protagonist.trim().length === 0) {
    throw new SessionCastError("protagonist가 비어 있음");
  }

  const shirtColor = pickShirtColor(palette, random);

  // 색은 storyboard.schema.json에 전용 필드가 없어서 description에 실어 B팀 프롬프트 조립으로
  // 넘긴다 (PRD: 최종 프롬프트 문자열 조립은 B 소유, A는 값까지만 넘긴다).
  // 주인공에만 붙인다.
  const protagonistDescription = shirtColor
    ? [protagonist, `상의 ${shirtColor}`].filter(Boolean).join(", ")
    : protagonist;

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
