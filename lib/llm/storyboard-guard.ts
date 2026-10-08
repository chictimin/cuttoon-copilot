// 스토리보드 저장 계약 검사(spec-263 3-1, P1-a). 순수 함수 — DB·asset·외부 호출
// 모듈을 import하지 않으므로 브라우저·서버 어디서든 쓸 수 있다. 어떤 입력에도
// throw하지 않고 problem 목록으로 돌려준다(컨테이너 형태 오류도 problem 한 건).
//
// 검사하는 규칙:
// - A1 generated_image 형식(null 또는 ^asset://.+, 허용 집합에 정확히 있을 때만
//   /demo-cache/… 통과 — 형식 검사이며 실존·UUID 검사가 아님)
// - A2 storyboard_version enum(스키마에서 읽음)
// - A3 cast 1~2명·주인공(protagonist) 정확히 1명
// - A4 cuts 정확히 4개
// - A5 컷 필수 키(cut_index·narrative_beat·shot_type·camera_angle·
//   characters_in_frame·caption) + 하위 구조·타입·개수
// - A6 narrative_beat·shot_type·camera_angle·expression·pose·reserved_zone 외
//   bubble_type·position·time_of_day 포함 9종 enum(스키마에서 읽음)
// - A7 cut_index 정수 1~4·유일(1~4 각 1회)
// - A9 characters_in_frame[].character_id ↔ cast[].character_id 일치
// - A10 cta_strength enum(없으면 clear 취급)
// - A11 subject_tags(subjectTagsProblem 그대로)
// - XK 추가 키 6곳(spec-263-r1 R1-b 8-1): 최상위·subject_tags 원소·castMember·
//   cut·characters_in_frame 원소·caption. caption.anchor는 ANC가 이미 검사하므로
//   XK 대상 제외. 허용 키는 스키마 properties에서 읽는다(목록 복제 금지).
//   위반 단위 = 추가 키 1개당 problem 1개(kind format, cause 키 이름,
//   locator <대상 locator>.<키 이름>). 전체 출력은 결정적 순서(대상 순회 →
//   키 이름 정렬). subject_tags 원소는 subject_tags[<순번>](안정 표시).
// - A12 castMember 필수(character_id·role)·role enum·description 타입
// - A14 time_of_day·reserved_zone(있을 때만 enum)
// - CTA 비트 개수·위치(cta_strength none이면 0개·override 전부 null, 그 외면
//   정확히 1개·cut_index 4) + cta 컷 override id 유효성
// - subject 비어 있지 않음(기존 assertStoryboardShape와 동일)
// - enum 값 목록은 스토리보드 스키마에서 읽는다(값 목록 복제 없음 —
//   preset-guard.ts의 VALID 패턴 이식)
// 하지 않는 규칙:
// - caption.anchor 추가 키의 XK 중복 집계(ANC 1건만 — R1-b 8-1)
// - 중복 금지(B4·B5·B10·B16 — R 범위, preset 쪽)
// - preset PATCH 보호 비교·B6 character_pool(읽는 코드 없음 — R 범위)
// - cta_override 키 자체의 유무(cta 컷 키 없음은 기존 동작대로 null 취급 — R에서 다룸)
// - generated_image 실존 확인(A1은 형식 검사만)
// - 접두사 통과만으로 허용하지 않음(허용 집합 정확 일치가 있어야 통과)
// - 기존 검사(assertStoryboardShape의 4키·subjectTagsProblem·CTA 인바리언트)는
//   그대로 먼저 수행하고 느슨하게 하지 않는다. 새 판정은 그 뒤에 problem 목록으로.
//
// locator: cut_index가 정상(1~4 정수)·유일하면 `cut#<cut_index>`, 아니면
// `cuts[<배열순번>]!`(불안정 표시). cast는 character_id가 정상(비어 있지 않은
// 문자열)·유일하면 `cast#<id>`, 아니면 `cast[<순번>]!`. frame 원소는 그 컷 안에서
// character_id가 정상·유일하면 `<컷 locator>.frame#<id>`, 아니면
// `<컷 locator>.frame[<순번>]!` — 하위 필드(expression·pose 등)와 A9도 이 체계로.
// 필드는 `.shot_type` 등을 붙임.
// cause: 단일 필드는 그 값 자체(deepEqual 대상). 개수·관계 규칙은 검사에 쓴 투영
// (A4 = cuts의 cut_index 목록과 길이, A3 = cast의 [id, role] 목록,
// A9 = 그 컷의 character_id 목록 + cast id 목록).
//
// 아래 기존 런타임 인바리언트 세 체크(assertUniqueCutIndices·
// assertValidCtaOverrides·assertCtaCutRule)는 저장 경로·화면에서 그대로 쓰므로 둔다.

import { isValidCtaId } from "./cta-presets";
import type { CtaStrength } from "./narrative-flow";
import { subjectTagsProblem, type StoredSubjectTag } from "./subject-tags";
import storyboardSchema from "@/spec/storyboard.schema.json";

export interface CastMember {
  character_id: string;
  role: "protagonist" | "supporting";
  description?: string;
}

export interface StoryboardCut {
  cut_index: number;
  narrative_beat: string;
  shot_type?: string;
  camera_angle?: string;
  characters_in_frame?: Array<{
    character_id: string;
    expression?: string;
    pose?: string;
  }>;
  caption?: unknown;
  time_of_day?: string;
  cta_override?: string | null;
}

export interface Storyboard {
  storyboard_version: "1.0";
  subject: string;
  cast: CastMember[];
  cuts: StoryboardCut[];
  /** 이 컷툰 한 편의 CTA 강도 (issue #205). 없으면 clear로 해석. */
  cta_strength?: CtaStrength;
  /** 소재 [태그] 저장 매핑 (issue #206 S1). 없으면 기존 세션 그대로 유효. */
  subject_tags?: StoredSubjectTag[];
}

export class StoryboardValidationError extends Error {}

/** 계약 위반 한 건. throw 대신 이 목록으로 돌려준다. */
export type ContractProblemKind =
  | "missing"
  | "type"
  | "enum"
  | "cardinality"
  | "relation"
  | "format";

export interface ContractProblem {
  rule: string;
  locator: string;
  kind: ContractProblemKind;
  cause: unknown;
}

/** 판정 컨텍스트. demoCacheValues가 주어지면 그 집합의 정확 일치도 A1 통과. */
export interface StoryboardContractContext {
  demoCacheValues?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// enum 읽기 (preset-guard.ts VALID 패턴 이식 — 값 목록 복제 없음)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getEnumAt(schema: unknown, pathParts: string[]): string[] {
  let node: unknown = schema;
  for (const part of pathParts) {
    if (!isRecord(node)) return [];
    node = node[part];
  }
  if (isRecord(node) && Array.isArray(node.enum)) {
    return node.enum.filter((v): v is string => typeof v === "string");
  }
  return [];
}

// 런타임 검증에 실제로 쓰는 값 목록은 스키마에서 읽는다(하드코딩 아님)
const VALID = {
  storyboard_version: getEnumAt(storyboardSchema, ["properties", "storyboard_version"]),
  narrative_beat: getEnumAt(storyboardSchema, ["$defs", "cut", "properties", "narrative_beat"]),
  shot_type: getEnumAt(storyboardSchema, ["$defs", "cut", "properties", "shot_type"]),
  camera_angle: getEnumAt(storyboardSchema, ["$defs", "cut", "properties", "camera_angle"]),
  time_of_day: getEnumAt(storyboardSchema, ["$defs", "cut", "properties", "time_of_day"]),
  reserved_zone: getEnumAt(storyboardSchema, ["$defs", "cut", "properties", "reserved_zone"]),
  expression: getEnumAt(storyboardSchema, [
    "$defs",
    "cut",
    "properties",
    "characters_in_frame",
    "items",
    "properties",
    "expression",
  ]),
  pose: getEnumAt(storyboardSchema, [
    "$defs",
    "cut",
    "properties",
    "characters_in_frame",
    "items",
    "properties",
    "pose",
  ]),
  bubble_type: getEnumAt(storyboardSchema, [
    "$defs",
    "cut",
    "properties",
    "caption",
    "properties",
    "bubble_type",
  ]),
  position: getEnumAt(storyboardSchema, [
    "$defs",
    "cut",
    "properties",
    "caption",
    "properties",
    "position",
  ]),
  role: getEnumAt(storyboardSchema, ["$defs", "castMember", "properties", "role"]),
  cta_strength: getEnumAt(storyboardSchema, ["properties", "cta_strength"]),
};

// getEnumAt이 경로를 못 찾으면 []를 반환하는데, 그대로 두면 나중에 "값이 유효하지
// 않음" 에러가 나면서 마치 데이터가 잘못된 것처럼 보인다 — 실제 원인은 스키마 경로
// 오류일 수 있다. 모듈 로드 시점에 fail-fast로 잡아 진단이 어긋나지 않게 한다.
for (const [key, values] of Object.entries(VALID)) {
  if (values.length === 0) {
    throw new Error(`storyboard.schema.json에서 ${key} enum을 못 읽음 — 스키마 경로 확인 필요`);
  }
}

// 스키마 properties 키 목록 읽기(XK 허용 키용 — 값 목록 복제 금지와 같은 취지).
// 경로를 못 찾으면 []를 반환하고, 호출 쪽(B15와 같은 관례)은 그 대상을 건너뛴다.
function getSchemaPropsAt(pathParts: string[]): string[] {
  let node: unknown = storyboardSchema;
  for (const part of pathParts) {
    if (!isRecord(node)) return [];
    node = (node as Record<string, unknown>)[part];
  }
  if (!isRecord(node)) return [];
  const props = (node as Record<string, unknown>).properties;
  if (!isRecord(props)) return [];
  return Object.keys(props);
}

const ASSET_PATTERN = /^asset:\/\/.+/;

/** cuts[].cut_index가 1~4를 한 번씩만 쓰는지 확인. */
export function assertUniqueCutIndices(cuts: StoryboardCut[]): void {
  const indices = cuts.map((c) => c.cut_index);
  const unique = new Set(indices);
  if (unique.size !== cuts.length) {
    throw new StoryboardValidationError(
      `cut_index 중복 발견: [${indices.join(", ")}]`
    );
  }
  const expected = Array.from({ length: cuts.length }, (_, i) => i + 1);
  const missing = expected.filter((n) => !unique.has(n));
  if (missing.length) {
    throw new StoryboardValidationError(
      `cut_index 누락: [${missing.join(", ")}] (있는 값: [${indices.join(", ")}])`
    );
  }
}

/** narrative_beat=cta인 컷의 cta_override가 null이 아니면 cta_presets.json에 실제로 있는 id인지 확인. */
export function assertValidCtaOverrides(cuts: StoryboardCut[]): void {
  for (const cut of cuts) {
    if (cut.narrative_beat !== "cta") continue;
    if (cut.cta_override == null) continue; // null이면 preset 기본값 사용, 검증 불필요
    if (!isValidCtaId(cut.cta_override)) {
      throw new StoryboardValidationError(
        `cuts[cut_index=${cut.cut_index}].cta_override "${cut.cta_override}"가 ` +
          `cta_presets.json의 preset id가 아님`
      );
    }
  }
}

/**
 * cta 비트 개수·위치 (issue #205). strength가 없으면 clear로 해석해 기존
 * 스토리보드가 그대로 유효하다.
 * - none: cta 비트 0개, 모든 컷 cta_override null.
 * - 그 외: cta 비트 정확히 1개, 그 컷의 cut_index가 4.
 */
export function assertCtaCutRule(cuts: StoryboardCut[], strength?: CtaStrength): void {
  const effective = strength ?? "clear";
  const ctaCuts = cuts.filter((c) => c.narrative_beat === "cta");
  if (effective === "none") {
    if (ctaCuts.length !== 0) {
      throw new StoryboardValidationError(
        `cta_strength가 none인데 cta 비트가 있음 (발견: ${ctaCuts.length}개)`
      );
    }
    for (const cut of cuts) {
      if (cut.cta_override != null) {
        throw new StoryboardValidationError(
          `cta_strength가 none인데 cuts[cut_index=${cut.cut_index}].cta_override가 null이 아님`
        );
      }
    }
    return;
  }
  if (ctaCuts.length !== 1) {
    throw new StoryboardValidationError(
      `cta 비트는 정확히 1개여야 함 (발견: ${ctaCuts.length}개)`
    );
  }
  if (ctaCuts[0].cut_index !== 4) {
    throw new StoryboardValidationError(
      `cta 비트는 cut_index 4에 있어야 함 (발견: ${ctaCuts[0].cut_index})`
    );
  }
}

/** cta 비트가 정확히 1개이고, 그 컷의 cut_index가 4인지 확인. */
export function assertExactlyOneCta(cuts: StoryboardCut[]): void {
  assertCtaCutRule(cuts);
}

/** 위 세 체크를 함께 실행. storyboard.schema.json 검증(별도, ajv 미사용) 이후에 호출하는 걸 전제로 함. */
export function assertStoryboardRuntimeInvariants(
  cuts: StoryboardCut[],
  strength?: CtaStrength
): void {
  assertUniqueCutIndices(cuts);
  assertValidCtaOverrides(cuts);
  assertCtaCutRule(cuts, strength);
}

// ---------------------------------------------------------------------------
// storyboardContractProblems (spec-263 3-1)
// ---------------------------------------------------------------------------

function cutLocator(cuts: unknown[], index: number): string {
  const rec = isRecord(cuts[index]) ? (cuts[index] as Record<string, unknown>) : null;
  const ci = rec?.cut_index;
  if (typeof ci === "number" && Number.isInteger(ci) && ci >= 1 && ci <= 4) {
    let count = 0;
    for (const c of cuts) {
      if (isRecord(c) && (c as Record<string, unknown>).cut_index === ci) count++;
    }
    if (count === 1) return `cut#${ci}`;
  }
  return `cuts[${index}]!`;
}

function castLocator(cast: unknown[], index: number): string {
  const rec = isRecord(cast[index]) ? (cast[index] as Record<string, unknown>) : null;
  const id = rec?.character_id;
  if (typeof id === "string" && id.length > 0) {
    let count = 0;
    for (const m of cast) {
      if (isRecord(m) && (m as Record<string, unknown>).character_id === id) count++;
    }
    if (count === 1) return `cast#${id}`;
  }
  return `cast[${index}]!`;
}

/**
 * frame 원소 locator(spec-263 rev5 3-1 "frame" 줄). 그 컷 안에서
 * character_id가 비어 있지 않은 문자열·유일하면 `<컷 locator>.frame#<id>`,
 * 아니면 `<컷 locator>.frame[<순번>]!`(불안정 → 3-2 frame 컬렉션 투영이 받음).
 * 배열 순번만 쓰면 다른 인물로 위반이 옮겨가도 같은 locator가 되어 보호가
 * 통과해 버리므로, 인물을 식별자에 묶는다.
 */
function frameLocator(frames: unknown[], index: number, cutLoc: string): string {
  const rec = isRecord(frames[index]) ? (frames[index] as Record<string, unknown>) : null;
  const id = rec?.character_id;
  if (typeof id === "string" && id.length > 0) {
    let count = 0;
    for (const e of frames) {
      if (isRecord(e) && (e as Record<string, unknown>).character_id === id) count++;
    }
    if (count === 1) return `${cutLoc}.frame#${id}`;
  }
  return `${cutLoc}.frame[${index}]!`;
}

function rawCutIndices(cuts: unknown[]): unknown[] {
  return cuts.map((c) => (isRecord(c) ? (c as Record<string, unknown>).cut_index : c));
}

function castIdRoles(cast: unknown[]): Array<[unknown, unknown]> {
  return cast.map((m) => {
    if (!isRecord(m)) return [m, undefined] as [unknown, unknown];
    const r = m as Record<string, unknown>;
    return [r.character_id, r.role] as [unknown, unknown];
  });
}

function castIds(cast: unknown): string[] {
  if (!Array.isArray(cast)) return [];
  const ids: string[] = [];
  for (const m of cast) {
    if (isRecord(m)) {
      const id = (m as Record<string, unknown>).character_id;
      if (typeof id === "string") ids.push(id);
    }
  }
  return ids;
}

function checkRequiredEnumField(
  rec: Record<string, unknown>,
  key: string,
  valid: string[],
  missingRule: string,
  badRule: string,
  loc: string,
  problems: ContractProblem[]
): void {
  const v = rec[key];
  const fieldLoc = `${loc}.${key}`;
  if (v === undefined) {
    problems.push({ rule: missingRule, locator: fieldLoc, kind: "missing", cause: undefined });
  } else if (typeof v !== "string") {
    problems.push({ rule: badRule, locator: fieldLoc, kind: "type", cause: v });
  } else if (!valid.includes(v)) {
    problems.push({ rule: badRule, locator: fieldLoc, kind: "enum", cause: v });
  }
}

function checkOptionalEnumField(
  rec: Record<string, unknown>,
  key: string,
  valid: string[],
  badRule: string,
  loc: string,
  problems: ContractProblem[]
): void {
  const v = rec[key];
  if (v === undefined) return;
  const fieldLoc = `${loc}.${key}`;
  if (typeof v !== "string") {
    problems.push({ rule: badRule, locator: fieldLoc, kind: "type", cause: v });
  } else if (!valid.includes(v)) {
    problems.push({ rule: badRule, locator: fieldLoc, kind: "enum", cause: v });
  }
}

function subjectTagsKind(message: string): ContractProblemKind {
  if (message.includes("최대")) return "cardinality";
  return "type";
}

// XK 추가 키 수집(spec-263-r1 R1-b 8-1). 6곳(최상위·subject_tags 원소·
// castMember·cut·characters_in_frame 원소·caption) — caption.anchor는 ANC가
// 이미 검사하므로 XK에서 제외한다(anchor 키 자체는 caption 허용 키).
// 추가 키 1개당 problem 1개(kind format, cause 키 이름). 대상 순회 순서 →
// 키 이름 정렬로 결정적 순서를 만든다. subject_tags 원소 locator는 순번
// `subject_tags[<i>]`(안정 표시 — 앞 원소 삭제 시 순번이 밀려 기존 추가 키도
// 새 위반이 되는 엄격 동작을 기대값으로 고정, validate.ts 변경 없음).
function collectExtraKeyProblems(
  rec: Record<string, unknown>,
  problems: ContractProblem[]
): void {
  const extraOf = (node: Record<string, unknown>, allowed: string[]): string[] => {
    if (allowed.length === 0) return [];
    return Object.keys(node)
      .filter((k) => !allowed.includes(k))
      .sort();
  };
  const push = (locator: string, key: string): void => {
    problems.push({ rule: "XK", locator, kind: "format", cause: key });
  };

  const topAllowed = getSchemaPropsAt([]);
  for (const key of extraOf(rec, topAllowed)) {
    push(`storyboard.${key}`, key);
  }

  const castAllowed = getSchemaPropsAt(["$defs", "castMember"]);
  const cast = rec.cast;
  if (Array.isArray(cast)) {
    cast.forEach((m, i) => {
      if (!isRecord(m)) return;
      for (const key of extraOf(m as Record<string, unknown>, castAllowed)) {
        push(`${castLocator(cast, i)}.${key}`, key);
      }
    });
  }

  const cutAllowed = getSchemaPropsAt(["$defs", "cut"]);
  const frameAllowed = getSchemaPropsAt(["$defs", "cut", "properties", "characters_in_frame", "items"]);
  const captionAllowed = getSchemaPropsAt(["$defs", "cut", "properties", "caption"]);
  const cuts = rec.cuts;
  if (Array.isArray(cuts)) {
    cuts.forEach((c, i) => {
      if (!isRecord(c)) return;
      const r = c as Record<string, unknown>;
      const loc = cutLocator(cuts, i);
      for (const key of extraOf(r, cutAllowed)) {
        push(`${loc}.${key}`, key);
      }
      const fr = r.characters_in_frame;
      if (Array.isArray(fr)) {
        fr.forEach((e, j) => {
          if (!isRecord(e)) return;
          for (const key of extraOf(e as Record<string, unknown>, frameAllowed)) {
            push(`${frameLocator(fr, j, loc)}.${key}`, key);
          }
        });
      }
      const cap = r.caption;
      if (isRecord(cap)) {
        for (const key of extraOf(cap as Record<string, unknown>, captionAllowed)) {
          push(`${loc}.caption.${key}`, key);
        }
      }
    });
  }

  const tagAllowed = getSchemaPropsAt(["properties", "subject_tags", "items"]);
  const tags = rec.subject_tags;
  if (Array.isArray(tags)) {
    tags.forEach((t, i) => {
      if (!isRecord(t)) return;
      for (const key of extraOf(t as Record<string, unknown>, tagAllowed)) {
        push(`subject_tags[${i}].${key}`, key);
      }
    });
  }
}

function collectProblems(sb: unknown, demoCacheValues?: ReadonlySet<string>): ContractProblem[] {
  const problems: ContractProblem[] = [];
  if (!isRecord(sb)) {
    return [{ rule: "shape", locator: "storyboard", kind: "type", cause: sb }];
  }
  const rec = sb as Record<string, unknown>;

  // A2 storyboard_version — 기존 검사는 비어 있지 않은 문자열만 요구했으나
  // 계약은 스키마 enum 그대로("1.0"만 허용, 느슨하게 하지 않음).
  const version = rec.storyboard_version;
  if (version === undefined) {
    problems.push({ rule: "A2", locator: "storyboard_version", kind: "missing", cause: undefined });
  } else if (typeof version !== "string") {
    problems.push({ rule: "A2", locator: "storyboard_version", kind: "type", cause: version });
  } else if (!VALID.storyboard_version.includes(version)) {
    problems.push({ rule: "A2", locator: "storyboard_version", kind: "enum", cause: version });
  }

  // subject — 기존 검사와 동일(비어 있지 않은 문자열).
  const subject = rec.subject;
  if (subject === undefined) {
    problems.push({ rule: "subject", locator: "subject", kind: "missing", cause: undefined });
  } else if (typeof subject !== "string") {
    problems.push({ rule: "subject", locator: "subject", kind: "type", cause: subject });
  } else if (subject.trim().length === 0) {
    problems.push({ rule: "subject", locator: "subject", kind: "format", cause: subject });
  }

  // A3·A12 cast
  const cast = rec.cast;
  if (!Array.isArray(cast)) {
    problems.push({ rule: "A3", locator: "cast", kind: "type", cause: cast });
  } else {
    if (cast.length < 1 || cast.length > 2) {
      problems.push({
        rule: "A3",
        locator: "cast",
        kind: "cardinality",
        cause: { length: cast.length, members: castIdRoles(cast) },
      });
    }
    const protagonists = cast.filter(
      (m) => isRecord(m) && (m as Record<string, unknown>).role === "protagonist"
    ).length;
    if (protagonists !== 1) {
      problems.push({
        rule: "A3",
        locator: "cast",
        kind: "cardinality",
        cause: { length: cast.length, members: castIdRoles(cast) },
      });
    }
    const idCounts = new Map<string, number>();
    for (const m of cast) {
      if (isRecord(m)) {
        const id = (m as Record<string, unknown>).character_id;
        if (typeof id === "string" && id.length > 0) {
          idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
        }
      }
    }
    cast.forEach((m, i) => {
      const loc = castLocator(cast, i);
      if (!isRecord(m)) {
        problems.push({ rule: "A12", locator: loc, kind: "type", cause: m });
        return;
      }
      const r = m as Record<string, unknown>;
      const id = r.character_id;
      if (id === undefined) {
        problems.push({ rule: "A12", locator: `${loc}.character_id`, kind: "missing", cause: undefined });
      } else if (typeof id !== "string") {
        problems.push({ rule: "A12", locator: `${loc}.character_id`, kind: "type", cause: id });
      } else if (id.length === 0) {
        problems.push({ rule: "A12", locator: `${loc}.character_id`, kind: "format", cause: id });
      } else if ((idCounts.get(id) ?? 0) > 1) {
        problems.push({
          rule: "A12",
          locator: `${loc}.character_id`,
          kind: "relation",
          cause: { character_id: id, cast_ids: castIds(cast) },
        });
      }
      checkRequiredEnumField(r, "role", VALID.role, "A12", "A12", loc, problems);
      if (r.description !== undefined && typeof r.description !== "string") {
        problems.push({ rule: "A12", locator: `${loc}.description`, kind: "type", cause: r.description });
      }
    });
  }

  // A4·A5·A7·A6·A14·A9·A1·CTA cuts
  const cuts = rec.cuts;
  if (!Array.isArray(cuts)) {
    problems.push({ rule: "A4", locator: "cuts", kind: "type", cause: cuts });
  } else {
    if (cuts.length !== 4) {
      problems.push({
        rule: "A4",
        locator: "cuts",
        kind: "cardinality",
        cause: { length: cuts.length, cut_indices: rawCutIndices(cuts) },
      });
    }
    const indexCounts = new Map<number, number>();
    for (const c of cuts) {
      if (isRecord(c)) {
        const ci = (c as Record<string, unknown>).cut_index;
        if (typeof ci === "number" && Number.isInteger(ci)) {
          indexCounts.set(ci, (indexCounts.get(ci) ?? 0) + 1);
        }
      }
    }
    cuts.forEach((c, i) => {
      const loc = cutLocator(cuts, i);
      if (!isRecord(c)) {
        problems.push({ rule: "A5", locator: loc, kind: "type", cause: c });
        return;
      }
      const r = c as Record<string, unknown>;

      // A7 cut_index
      const ci = r.cut_index;
      if (ci === undefined) {
        problems.push({ rule: "A7", locator: `${loc}.cut_index`, kind: "missing", cause: undefined });
      } else if (typeof ci !== "number" || !Number.isInteger(ci)) {
        problems.push({ rule: "A7", locator: `${loc}.cut_index`, kind: "type", cause: ci });
      } else if (ci < 1 || ci > 4) {
        problems.push({ rule: "A7", locator: `${loc}.cut_index`, kind: "enum", cause: ci });
      } else if ((indexCounts.get(ci) ?? 0) > 1) {
        problems.push({
          rule: "A7",
          locator: `${loc}.cut_index`,
          kind: "relation",
          cause: { cut_index: ci, cut_indices: rawCutIndices(cuts) },
        });
      }

      // A5 필수 키 + A6 enum
      checkRequiredEnumField(r, "narrative_beat", VALID.narrative_beat, "A5", "A6", loc, problems);
      checkRequiredEnumField(r, "shot_type", VALID.shot_type, "A5", "A6", loc, problems);
      checkRequiredEnumField(r, "camera_angle", VALID.camera_angle, "A5", "A6", loc, problems);
      checkOptionalEnumField(r, "time_of_day", VALID.time_of_day, "A14", loc, problems);
      checkOptionalEnumField(r, "reserved_zone", VALID.reserved_zone, "A14", loc, problems);

      // A5 characters_in_frame + A6 하위 enum + A9 교차
      const fr = r.characters_in_frame;
      const floc = `${loc}.characters_in_frame`;
      if (fr === undefined) {
        problems.push({ rule: "A5", locator: floc, kind: "missing", cause: undefined });
      } else if (!Array.isArray(fr)) {
        problems.push({ rule: "A5", locator: floc, kind: "type", cause: fr });
      } else {
        if (fr.length < 1 || fr.length > 2) {
          problems.push({
            rule: "A5",
            locator: floc,
            kind: "cardinality",
            cause: {
              length: fr.length,
              members: fr.map((e) => (isRecord(e) ? (e as Record<string, unknown>).character_id : e)),
            },
          });
        }
        const ids = castIds(cast);
        fr.forEach((e, j) => {
          const eloc = frameLocator(fr, j, loc);
          if (!isRecord(e)) {
            problems.push({ rule: "A5", locator: eloc, kind: "type", cause: e });
            return;
          }
          const er = e as Record<string, unknown>;
          const fid = er.character_id;
          if (fid === undefined) {
            problems.push({ rule: "A5", locator: `${eloc}.character_id`, kind: "missing", cause: undefined });
          } else if (typeof fid !== "string") {
            problems.push({ rule: "A5", locator: `${eloc}.character_id`, kind: "type", cause: fid });
          } else if (fid.length === 0) {
            problems.push({ rule: "A5", locator: `${eloc}.character_id`, kind: "format", cause: fid });
          } else if (!ids.includes(fid)) {
            problems.push({
              rule: "A9",
              locator: `${eloc}.character_id`,
              kind: "relation",
              cause: {
                frame_ids: fr.map((x) =>
                  isRecord(x) ? (x as Record<string, unknown>).character_id : x
                ),
                cast_ids: ids,
              },
            });
          }
          checkRequiredEnumField(er, "expression", VALID.expression, "A5", "A6", eloc, problems);
          checkRequiredEnumField(er, "pose", VALID.pose, "A5", "A6", eloc, problems);
        });
      }

      // A5 caption
      const cap = r.caption;
      const cloc = `${loc}.caption`;
      if (cap === undefined) {
        problems.push({ rule: "A5", locator: cloc, kind: "missing", cause: undefined });
      } else if (!isRecord(cap)) {
        problems.push({ rule: "A5", locator: cloc, kind: "type", cause: cap });
      } else {
        const cr = cap as Record<string, unknown>;
        const text = cr.text;
        if (text === undefined) {
          problems.push({ rule: "A5", locator: `${cloc}.text`, kind: "missing", cause: undefined });
        } else if (typeof text !== "string") {
          problems.push({ rule: "A5", locator: `${cloc}.text`, kind: "type", cause: text });
        }
        checkRequiredEnumField(cr, "bubble_type", VALID.bubble_type, "A5", "A6", cloc, problems);
        checkRequiredEnumField(cr, "position", VALID.position, "A5", "A6", cloc, problems);

        // SPK captions.speaker_index (spec-242 A-5). frame 0명·3명 이상·비배열은
        // SPK 판정 안 함(기존 A5가 잡음).
        if (Array.isArray(fr) && (fr.length === 1 || fr.length === 2)) {
          const speakerLoc = `${cloc}.speaker_index`;
          if (fr.length === 1) {
            if ("speaker_index" in cr) {
              problems.push({
                rule: "SPK",
                locator: speakerLoc,
                kind: "relation",
                cause: { value: cr.speaker_index, frameLength: 1 },
              });
            }
          } else if ("speaker_index" in cr) {
            const speaker = cr.speaker_index;
            if (typeof speaker !== "number" || !Number.isInteger(speaker)) {
              problems.push({ rule: "SPK", locator: speakerLoc, kind: "type", cause: speaker });
            } else if (speaker !== 0 && speaker !== 1) {
              problems.push({ rule: "SPK", locator: speakerLoc, kind: "enum", cause: speaker });
            }
          }
        }

        // ANC captions.anchor (spec-242 B). 키가 없을 때만 통과, 있으면 아래 표대로.
        if ("anchor" in cr) {
          const anchorLoc = `${cloc}.anchor`;
          const anchor = cr.anchor;
          if (!isRecord(anchor)) {
            problems.push({ rule: "ANC", locator: anchorLoc, kind: "type", cause: anchor });
          } else {
            for (const axis of ["x", "y"] as const) {
              const axisLoc = `${anchorLoc}.${axis}`;
              if (!(axis in anchor)) {
                problems.push({ rule: "ANC", locator: axisLoc, kind: "missing", cause: undefined });
              } else {
                const value = anchor[axis];
                if (typeof value !== "number" || !Number.isFinite(value)) {
                  problems.push({ rule: "ANC", locator: axisLoc, kind: "type", cause: value });
                } else if (value < 0 || value > 1) {
                  problems.push({ rule: "ANC", locator: axisLoc, kind: "format", cause: value });
                }
              }
            }
            const extra = Object.keys(anchor).filter((k) => k !== "x" && k !== "y");
            if (extra.length > 0) {
              problems.push({ rule: "ANC", locator: anchorLoc, kind: "format", cause: extra });
            }
          }
        }
      }

      // CTA override id (cta 컷에서만 의미 — null이면 기본값 사용)
      const beat = r.narrative_beat;
      const ov = r.cta_override;
      if (typeof beat === "string" && beat === "cta" && ov !== undefined && ov !== null) {
        if (typeof ov !== "string") {
          problems.push({ rule: "CTA", locator: `${loc}.cta_override`, kind: "type", cause: ov });
        } else if (!isValidCtaId(ov)) {
          problems.push({ rule: "CTA", locator: `${loc}.cta_override`, kind: "enum", cause: ov });
        }
      }

      // A1 generated_image — 형식 검사이며 실존 검사가 아님. 키 자체가 없으면
      // 생성 전 컷이므로 위반이 아니다. 허용 집합(ctx)은 정확 일치만 통과.
      const g = r.generated_image;
      if (g !== undefined && g !== null) {
        const gloc = `${loc}.generated_image`;
        if (typeof g !== "string") {
          problems.push({ rule: "A1", locator: gloc, kind: "type", cause: g });
        } else if (ASSET_PATTERN.test(g)) {
          // 통과
        } else if (
          typeof demoCacheValues?.has === "function" &&
          demoCacheValues.has(g)
        ) {
          // 통과 — 허용 집합의 정확 일치
        } else {
          problems.push({ rule: "A1", locator: gloc, kind: "format", cause: g });
        }
      }
    });

    // CTA 비트 개수·위치 — 기존 assertCtaCutRule과 같은 규칙을 problem으로.
    const strengthRaw = rec.cta_strength;
    const effective = strengthRaw === "none" ? "none" : "clear";
    const ctaCuts: Array<{ loc: string; ci: unknown }> = [];
    cuts.forEach((c, i) => {
      if (isRecord(c) && (c as Record<string, unknown>).narrative_beat === "cta") {
        ctaCuts.push({
          loc: cutLocator(cuts, i),
          ci: (c as Record<string, unknown>).cut_index,
        });
      }
    });
    if (effective === "none") {
      if (ctaCuts.length !== 0) {
        problems.push({
          rule: "CTA",
          locator: "cuts",
          kind: "cardinality",
          cause: { cta_count: ctaCuts.length, cut_indices: rawCutIndices(cuts) },
        });
      }
      cuts.forEach((c, i) => {
        if (
          isRecord(c) &&
          (c as Record<string, unknown>).cta_override !== undefined &&
          (c as Record<string, unknown>).cta_override !== null
        ) {
          problems.push({
            rule: "CTA",
            locator: `${cutLocator(cuts, i)}.cta_override`,
            kind: "type",
            cause: (c as Record<string, unknown>).cta_override,
          });
        }
      });
    } else {
      if (ctaCuts.length !== 1) {
        problems.push({
          rule: "CTA",
          locator: "cuts",
          kind: "cardinality",
          cause: { cta_count: ctaCuts.length, cut_indices: rawCutIndices(cuts) },
        });
      } else if (ctaCuts[0].ci !== 4) {
        problems.push({
          rule: "CTA",
          locator: `${ctaCuts[0].loc}.cut_index`,
          kind: "relation",
          cause: ctaCuts[0].ci,
        });
      }
    }
  }

  // A10 cta_strength — 기존 검사는 none·soft·clear만 허용(없으면 clear 취급).
  const strength = rec.cta_strength;
  if (strength !== undefined) {
    if (typeof strength !== "string") {
      problems.push({ rule: "A10", locator: "cta_strength", kind: "type", cause: strength });
    } else if (!VALID.cta_strength.includes(strength)) {
      problems.push({ rule: "A10", locator: "cta_strength", kind: "enum", cause: strength });
    }
  }

  // A11 subject_tags — 기존 subjectTagsProblem 그대로.
  if (rec.subject_tags !== undefined) {
    const message = subjectTagsProblem(rec.subject_tags);
    if (message !== null) {
      problems.push({
        rule: "A11",
        locator: "subject_tags",
        kind: subjectTagsKind(message),
        cause: rec.subject_tags,
      });
    }
  }

  // XK 추가 키 6곳 — 저장 경로만 영향(배선 코드 변경 0). 읽기 경로·GET·Export 변경 없음.
  collectExtraKeyProblems(rec, problems);

  return problems;
}

/**
 * 스토리보드 저장 계약 판정(spec-263 3-1). throw하지 않는다 — 컨테이너 형태
 * 오류도 problem으로 돌려준다.
 */
export function storyboardContractProblems(
  sb: unknown,
  ctx?: StoryboardContractContext
): ContractProblem[] {
  try {
    return collectProblems(sb, ctx?.demoCacheValues);
  } catch {
    return [{ rule: "shape", locator: "storyboard", kind: "type", cause: null }];
  }
}
