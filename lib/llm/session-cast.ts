// 세션 시작 시 cast를 한 번 확정한다.
//
// 배경: preset.assets.character_sheet는 "프로젝트의 캐릭터 풀"이고 "각 컷툰에 이 중 누가
// 등장하는지는 세션에서 고른다"(preset.schema.json 원문). 그 '고르는' 자리가 여기다.
//
// storyboard.schema.json의 cast는 maxItems 2 + protagonist 정확히 1명이므로 구성은 하나뿐이다:
//   [상대역(protagonist), 지도사(supporting)]
// 지도사가 마주해 대화하는 상대가 곧 그 컷툰의 주인공이라, 상대역을 별도 제3슬롯으로 두지
// 않는다 — 그렇게 두면 등장인물이 3명이 되어 PRD 2절의 "등장 캐릭터 1~2명"(협상 불가)에 걸린다.
//
// 선택은 반드시 세션당 1회다. 컷마다 다시 뽑으면 4컷 안에서 인물·옷색이 바뀌어, 유일한 일관성
// 방어 수단인 "캐릭터 시트 매 컷 reference 주입"과 정면 충돌한다(PRD 2절).

export interface CastMember {
  character_id: string;
  role: "protagonist" | "supporting";
  description?: string;
}

export interface CounterpartOption {
  /** 프로젝트 캐릭터 시트 안에서 이 인물을 가리키는 라벨 */
  character_id: string;
  /** 배역 설명 (예: "무릎이 아파하는 어머니") */
  description?: string;
}

export interface BuildSessionCastInput {
  /** 캐릭터 시트 안의 지도사 라벨 */
  instructorCharacterId: string;
  /** 상대역 후보 풀. 이 중 하나가 이번 세션의 주인공이 된다. */
  counterparts: CounterpartOption[];
  /**
   * 상대역의 상의 색 후보. 세션당 하나를 뽑아 4컷 내내 고정한다.
   * 비우면 색을 지정하지 않는다(캐릭터 시트 원본 색을 그대로 씀).
   * 지도사에게는 적용하지 않는다 — 고정 마스코트라 의상이 바뀌면 정체성이 깨진다.
   */
  shirtColors?: string[];
  /** 테스트에서 결정적으로 만들기 위한 주입점. 기본값 Math.random */
  random?: () => number;
}

export interface SessionCast {
  /** storyboard.cast에 그대로 넣을 수 있는 배열 */
  cast: CastMember[];
  /** 이번 세션에 선택된 상대역(=주인공) */
  counterpart: CounterpartOption;
  /** 세션 내내 고정되는 상대역의 상의 색. shirtColors를 안 넘겼으면 null */
  shirtColor: string | null;
}

export class SessionCastError extends Error {}

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

/**
 * 세션 cast를 확정한다. 세션 생성 시점에 한 번만 호출할 것 — 반환값을 저장해두고
 * 4컷 전부가 같은 값을 참조해야 한다.
 */
export function buildSessionCast(input: BuildSessionCastInput): SessionCast {
  const { instructorCharacterId, counterparts, shirtColors, random = Math.random } = input;

  if (!instructorCharacterId) {
    throw new SessionCastError("instructorCharacterId가 비어 있음");
  }
  if (!counterparts.length) {
    throw new SessionCastError("counterparts 풀이 비어 있음 — 프로젝트 캐릭터 시트에 상대역이 없음");
  }
  if (counterparts.some((c) => c.character_id === instructorCharacterId)) {
    throw new SessionCastError(
      `상대역 후보에 지도사(${instructorCharacterId})가 섞여 있음 — 같은 인물이 cast에 두 번 들어간다`
    );
  }

  const counterpart = pick(counterparts, random);
  const shirtColor = shirtColors?.length ? pick(shirtColors, random) : null;

  // 색은 storyboard.schema.json에 전용 필드가 없어서 description에 실어 B팀 프롬프트 조립으로
  // 넘긴다 (PRD: 최종 프롬프트 문자열 조립은 B 소유, A는 값까지만 넘긴다).
  // 상대역에만 붙인다 — 지도사는 고정 마스코트라 의상을 건드리지 않는다.
  const counterpartDescription = shirtColor
    ? [counterpart.description, `상의 ${shirtColor}`].filter(Boolean).join(", ")
    : counterpart.description;

  return {
    cast: [
      {
        character_id: counterpart.character_id,
        role: "protagonist",
        description: counterpartDescription,
      },
      {
        character_id: instructorCharacterId,
        role: "supporting",
        description: "노인운동 지도사",
      },
    ],
    counterpart,
    shirtColor,
  };
}
