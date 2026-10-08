// issue #5: 프리셋 전체 타입가드 (필수 필드 · 패턴 · enum). ajv 없이 손으로 짠 가드.
// enum 값 목록은 preset.schema.json에서 직접 읽어온다 — 여기 하드코딩된 건 TS 타입(컴파일 타임
// 전용, 런타임엔 사라짐)뿐이고, 이건 스키마가 바뀌면 사람이 같이 고쳐야 한다는 걸 뜻한다.
// (vocabulary.json ↔ storyboard.schema.json과 같은 종류의 수동 동기화 리스크 — spec/sync-check.mjs
// 참고. 이 파일의 타입도 그 스크립트 점검 대상에 넣는 걸 고려할 것.)
//
// 검증 범위: 최상위 6개 키의 additionalProperties만 재현한다. assets/style/rules/context
// 서브객체 4곳에도 스키마엔 additionalProperties:false가 걸려 있지만 여기선 안 잡는다(예:
// style.line_width처럼 오타난 필드가 이 가드는 통과함). uniqueItems(스키마 9곳)도 미검증.
// 가드의 목적이 LLM 출력의 큰 형태 오류를 잡는 것이라 오타 필드까지는 지금 급하지 않다고 판단.
//
// 검사하는 규칙 / 하지 않는 규칙 (spec-263 P3 문구):
// - assertValidPreset이 검사: 최상위 additionalProperties·preset_version·필수 키·asset 패턴·
//   enum(스키마에서 읽음)·cta id·font·mascot. 위반 시 throw.
// - presetContractProbe가 집계: B4·B5·B10·B16 중복, B15 하위(assets·style·rules·context)
//   추가 키, B6 character_pool 형식. throw하지 않음(집계 전용).
// - 어느 쪽도 하지 않음: character_pool 값의 실존 검사, 비객체 입력의 판정(probe는 빈 배열),

import presetSchema from "@/spec/preset.schema.json";
import styleVocabulary from "@/spec/data/style-vocabulary.json";
import { isValidCtaId, type Interest } from "./cta-presets";
import type { CtaStrength } from "./narrative-flow";

export type { Interest };
export type LineWeight = "thin" | "medium" | "thick";
export type Saturation = "pastel" | "vivid" | "muted";
export type CharacterRatio = "2head" | "2.5head" | "3head" | "realistic";
export type BackgroundDensity = "none" | "low" | "medium" | "high";
export type BubbleStyle = "rounded" | "rect" | "cloud";
export type AgeBand = "10s" | "20s" | "30s" | "40s" | "50s" | "60s_plus";
export type LifeStage =
  | "student"
  | "job_seeker"
  | "early_career"
  | "parent"
  | "business_owner"
  | "retired";

/** 프로젝트 폰트 주소 종류 (issue #209). 정본 지점 — #236·화면은 이 타입을 import한다. */
export type FontKind = "css" | "file";

/** 프로젝트 폰트 에셋 (issue #209). 값의 출처는 확인 API 응답 그대로 저장한다 (가공 금지). */
export interface PresetFont {
  family: string;
  url: string;
  kind: FontKind;
}

export interface Preset {
  preset_version: "1.1";
  project_name: string;
  assets: {
    character_sheet: string;
    style_refs: string[];
    reference_asset_ids: string[];
    /** 프로젝트 폰트 (issue #209). 없으면 현행(시스템 폰트). */
    font?: PresetFont;
  };
  style: {
    keywords: string[];
    keyword_hints?: string[];
    line_weight: LineWeight;
    palette: string[];
    saturation: Saturation;
    character_ratio: CharacterRatio;
    background_density: BackgroundDensity;
    bubble_style: BubbleStyle;
  };
  rules: {
    forbidden: string[];
    forbidden_hints?: string[];
    cta_format: string;
    /** 프로젝트 CTA 강도 기본값 (issue #205). 없으면 clear로 해석. */
    cta_strength?: CtaStrength;
  };
  context: {
    industry: string[];
    interests: Interest[];
    age_band: AgeBand[];
    life_stage: LifeStage[];
    main_subjects: string[];
  };
  /** 프로젝트 고정 마스코트(issue #150). 선택 필드 — 없으면 기존 동작 유지. */
  mascot?: {
    label: string;
    description: string;
  };
}

const ASSET_URI_PATTERN = /^asset:\/\//;
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getEnumAt(pathParts: string[]): string[] {
  let node: unknown = presetSchema;
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
  line_weight: getEnumAt(["properties", "style", "properties", "line_weight"]),
  saturation: getEnumAt(["properties", "style", "properties", "saturation"]),
  character_ratio: getEnumAt(["properties", "style", "properties", "character_ratio"]),
  background_density: getEnumAt([
    "properties",
    "style",
    "properties",
    "background_density",
  ]),
  bubble_style: getEnumAt(["properties", "style", "properties", "bubble_style"]),
  age_band: getEnumAt(["properties", "context", "properties", "age_band", "items"]),
  life_stage: getEnumAt(["properties", "context", "properties", "life_stage", "items"]),
  interests: getEnumAt(["properties", "context", "properties", "interests", "items"]),
  cta_strength: getEnumAt(["properties", "rules", "properties", "cta_strength"]),
};

// getEnumAt이 경로를 못 찾으면 []를 반환하는데, 그대로 두면 나중에 "값이 유효하지 않음"
// 에러가 나면서 마치 데이터가 잘못된 것처럼 보인다 — 실제 원인은 스키마 경로 오류일 수 있다.
// 모듈 로드 시점에 fail-fast로 잡아 진단이 어긋나지 않게 한다.
for (const [key, values] of Object.entries(VALID)) {
  if (values.length === 0) {
    throw new Error(`preset.schema.json에서 ${key} enum을 못 읽음 — 스키마 경로 확인 필요`);
  }
}

export class PresetValidationError extends Error {}

function fail(message: string): never {
  throw new PresetValidationError(message);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
}

/**
 * preset.schema.json v1.1을 그대로 옮긴 손 타입가드.
 * 최상위 additionalProperties만 재현(정의 안 된 최상위 필드는 던짐) — 서브객체
 * additionalProperties·uniqueItems는 파일 상단 주석 참고, 미검증.
 */
export function assertValidPreset(data: unknown): asserts data is Preset {
  if (typeof data !== "object" || data === null) fail("preset이 객체가 아님");
  const d = data as Record<string, unknown>;

  const allowedTopKeys = ["preset_version", "project_name", "assets", "style", "rules", "context", "mascot"];
  const extraTop = Object.keys(d).filter((k) => !allowedTopKeys.includes(k));
  if (extraTop.length) {
    fail(`허용되지 않은 최상위 필드: ${extraTop.join(", ")} (additionalProperties: false)`);
  }

  if (d.preset_version !== "1.1") {
    fail(`preset_version은 "1.1"만 허용 (받은 값: ${String(d.preset_version)})`);
  }
  if (typeof d.project_name !== "string" || d.project_name.length < 1) {
    fail("project_name 누락");
  }

  // assets
  if (typeof d.assets !== "object" || d.assets === null) fail("assets 누락");
  const assets = d.assets as Record<string, unknown>;
  if (typeof assets.character_sheet !== "string" || !ASSET_URI_PATTERN.test(assets.character_sheet)) {
    fail(`assets.character_sheet는 asset://로 시작해야 함 (받은 값: ${String(assets.character_sheet)})`);
  }
  if (
    !isStringArray(assets.style_refs) ||
    !assets.style_refs.every((s) => ASSET_URI_PATTERN.test(s))
  ) {
    fail("assets.style_refs는 asset:// 문자열 배열이어야 함");
  }
  if (!isStringArray(assets.reference_asset_ids)) {
    fail("assets.reference_asset_ids는 문자열 배열이어야 함");
  }

  // font (issue #209) — 선택 필드. 있으면 객체, 키 정확히 3개, 각 제약은 스키마와 동일.
  if (assets.font !== undefined) {
    if (typeof assets.font !== "object" || assets.font === null) fail("assets.font는 객체여야 함");
    const font = assets.font as Record<string, unknown>;
    const extraFont = Object.keys(font).filter(
      (k) => k !== "family" && k !== "url" && k !== "kind"
    );
    if (extraFont.length) {
      fail(`assets.font에 허용되지 않은 필드: ${extraFont.join(", ")}`);
    }
    if (typeof font.family !== "string" || Array.from(font.family).length < 1 || Array.from(font.family).length > 60) {
      fail("assets.font.family는 1~60자 문자열이어야 함");
    }
    if (
      typeof font.url !== "string" ||
      Array.from(font.url).length > 2048 ||
      !font.url.startsWith("https://")
    ) {
      fail("assets.font.url은 https://로 시작하는 2048자 이하 문자열이어야 함");
    }
    if (font.kind !== "css" && font.kind !== "file") {
      fail(`assets.font.kind는 "css"·"file" 중 하나여야 함 (받은 값: ${String(font.kind)})`);
    }
  }

  // style
  if (typeof d.style !== "object" || d.style === null) fail("style 누락");
  const style = d.style as Record<string, unknown>;
  if (!isStringArray(style.keywords)) fail("style.keywords는 문자열 배열이어야 함");
  if (style.keyword_hints !== undefined && !isStringArray(style.keyword_hints)) {
    fail("style.keyword_hints는 문자열 배열이어야 함");
  }
  if (!VALID.line_weight.includes(style.line_weight as string)) {
    fail(`style.line_weight 값이 유효하지 않음: ${String(style.line_weight)}`);
  }
  if (
    !isStringArray(style.palette) ||
    style.palette.length < 1 ||
    !style.palette.every((c) => HEX_COLOR_PATTERN.test(c))
  ) {
    fail("style.palette는 #RRGGBB 형식 문자열 1개 이상 배열이어야 함");
  }
  if (!VALID.saturation.includes(style.saturation as string)) {
    fail(`style.saturation 값이 유효하지 않음: ${String(style.saturation)}`);
  }
  if (!VALID.character_ratio.includes(style.character_ratio as string)) {
    fail(`style.character_ratio 값이 유효하지 않음: ${String(style.character_ratio)}`);
  }
  if (!VALID.background_density.includes(style.background_density as string)) {
    fail(`style.background_density 값이 유효하지 않음: ${String(style.background_density)}`);
  }
  if (!VALID.bubble_style.includes(style.bubble_style as string)) {
    fail(`style.bubble_style 값이 유효하지 않음: ${String(style.bubble_style)}`);
  }

  // rules
  if (typeof d.rules !== "object" || d.rules === null) fail("rules 누락");
  const rules = d.rules as Record<string, unknown>;
  if (!isStringArray(rules.forbidden)) fail("rules.forbidden은 문자열 배열이어야 함");
  if (rules.forbidden_hints !== undefined && !isStringArray(rules.forbidden_hints)) {
    fail("rules.forbidden_hints는 문자열 배열이어야 함");
  }
  if (typeof rules.cta_format !== "string" || rules.cta_format.length < 1) {
    fail("rules.cta_format 누락");
  }
  if (!isValidCtaId(rules.cta_format as string)) {
    fail(`rules.cta_format "${String(rules.cta_format)}"가 cta_presets.json의 preset id가 아님`);
  }
  if (
    rules.cta_strength !== undefined &&
    !VALID.cta_strength.includes(rules.cta_strength as string)
  ) {
    fail(`rules.cta_strength 값이 유효하지 않음: ${String(rules.cta_strength)}`);
  }

  // context
  if (typeof d.context !== "object" || d.context === null) fail("context 누락");
  const context = d.context as Record<string, unknown>;
  if (!isStringArray(context.industry)) fail("context.industry는 문자열 배열이어야 함");
  if (
    !isStringArray(context.interests) ||
    !context.interests.every((v) => VALID.interests.includes(v))
  ) {
    fail("context.interests에 정의되지 않은 값이 있음");
  }
  if (
    !isStringArray(context.age_band) ||
    !context.age_band.every((v) => VALID.age_band.includes(v))
  ) {
    fail("context.age_band에 정의되지 않은 값이 있음");
  }
  if (
    !isStringArray(context.life_stage) ||
    !context.life_stage.every((v) => VALID.life_stage.includes(v))
  ) {
    fail("context.life_stage에 정의되지 않은 값이 있음");
  }
  if (!isStringArray(context.main_subjects)) {
    fail("context.main_subjects는 문자열 배열이어야 함");
  }

  // mascot (issue #150) — 선택 필드. 있으면 객체, label·description은 비어 있지
  // 않은 문자열, 그 외 키는 금지한다.
  if (d.mascot !== undefined) {
    if (typeof d.mascot !== "object" || d.mascot === null) fail("mascot은 객체여야 함");
    const mascot = d.mascot as Record<string, unknown>;
    const extraMascot = Object.keys(mascot).filter((k) => k !== "label" && k !== "description");
    if (extraMascot.length) {
      fail(`mascot에 허용되지 않은 필드: ${extraMascot.join(", ")}`);
    }
    if (typeof mascot.label !== "string" || mascot.label.length < 1) {
      fail("mascot.label은 비어 있지 않은 문자열이어야 함");
    }
    if (typeof mascot.description !== "string" || mascot.description.length < 1) {
      fail("mascot.description은 비어 있지 않은 문자열이어야 함");
    }
  }
}

export function isValidPreset(data: unknown): data is Preset {
  try {
    assertValidPreset(data);
    return true;
  } catch {
    return false;
  }
}

export type UnmappedWordStatus = "mapped" | "substituted" | "unmapped" | "enum_applied";
export type VocabField = "style.keywords" | "rules.forbidden";

export interface UnmappedWordFinding {
  field: VocabField;
  original: string;
  status: UnmappedWordStatus;
  matchedTerm?: string;
  promptHint?: string;
}

export interface UnmappedWordsResult {
  findings: UnmappedWordFinding[];
  /** 프롬프트 조립에 바로 쓸 영문 힌트. unmapped는 원본 문자열 그대로 들어간다. */
  resolvedHints: Record<VocabField, string[]>;
}

type VocabEntry = { hint: string };

// 순수 Levenshtein 거리 — 근접 매칭 하나만 필요해서 외부 라이브러리를 새로 넣지 않는다.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

const SIMILARITY_THRESHOLD = 0.4; // 편집거리 / 두 단어 중 긴 쪽 길이 <= 0.4면 근접 매칭 인정

function findClosestTerm(
  word: string,
  vocab: Record<string, VocabEntry>
): { term: string; hint: string } | null {
  if (vocab[word]) return { term: word, hint: vocab[word].hint };

  // 포함 관계 우선 — "무서운"이 "무서운 표정"에 포함되는 경우처럼 편집거리보다 신뢰도가 높다.
  for (const [term, { hint }] of Object.entries(vocab)) {
    if (term.includes(word) || word.includes(term)) return { term, hint };
  }

  let best: { term: string; hint: string; dist: number } | null = null;
  for (const [term, { hint }] of Object.entries(vocab)) {
    const dist = levenshtein(word, term);
    const normalized = dist / Math.max(word.length, term.length, 1);
    if (normalized <= SIMILARITY_THRESHOLD && (!best || dist < best.dist)) {
      best = { term, hint, dist };
    }
  }
  return best ? { term: best.term, hint: best.hint } : null;
}

function resolveField(
  field: VocabField,
  words: string[],
  vocab: Record<string, VocabEntry>
): { findings: UnmappedWordFinding[]; hints: string[] } {
  const findings: UnmappedWordFinding[] = [];
  const hints: string[] = [];

  for (const raw of words) {
    const word = raw.trim();
    if (!word) continue;

    if (vocab[word]) {
      findings.push({ field, original: word, status: "mapped", matchedTerm: word, promptHint: vocab[word].hint });
      hints.push(vocab[word].hint);
      continue;
    }

    const closest = findClosestTerm(word, vocab);
    if (closest) {
      findings.push({ field, original: word, status: "substituted", matchedTerm: closest.term, promptHint: closest.hint });
      hints.push(closest.hint);
    } else {
      // 딸깍 원칙: 차단·경고 팝업으로 사용자 판단을 요구하지 않는다. 원본을 그대로
      // 흘려보내고 findings에만 "unmapped"로 남겨 로그·UI에서 나중에 확인할 수 있게 한다.
      findings.push({ field, original: word, status: "unmapped" });
      hints.push(word);
    }
  }

  return { findings, hints };
}

/**
 * issue #15: style.keywords/rules.forbidden의 미매핑 단어 처리.
 *
 * 정책(2026-08-20 확정, spec/data/style-vocabulary.json 신설과 함께): 어휘 목록에
 * 있으면 그대로, 없으면 근접 매칭(포함 관계 → 편집거리)으로 치환, 그래도 못 찾으면
 * 원본을 그대로 쓰되 findings에 "unmapped"로 남긴다. 차단이나 경고 팝업은 딸깍
 * 원칙과 충돌해서 쓰지 않는다.
 *
 * context.industry/context.main_subjects는 다루지 않는다 — preset.schema.json이
 * "값을 고정하면 특정 업종 분류가 스키마에 박혀 범용성이 깨진다"고 명시적으로
 * 업종 종속 없는 자유 필드로 설계했다(context.industry description). 고정 어휘로
 * 치환하면 그 설계를 그대로 깨뜨리므로 대상에서 제외한다.
 */
export function checkUnmappedWordsPolicy(preset: {
  style: Pick<Preset["style"], "keywords">;
  rules: Pick<Preset["rules"], "forbidden">;
}): UnmappedWordsResult {
  const keywords = resolveField("style.keywords", preset.style.keywords, styleVocabulary["style.keywords"]);
  const forbidden = resolveField("rules.forbidden", preset.rules.forbidden, styleVocabulary["rules.forbidden"]);

  return {
    findings: [...keywords.findings, ...forbidden.findings],
    resolvedHints: {
      "style.keywords": keywords.hints,
      "rules.forbidden": forbidden.hints,
    },
  };
}

// ── P0 preset probe (spec-263 rev4 3-5) ─────────────────────────────
//
// R 보호 설계용 집계 전용 순수 함수. assertValidPreset이 검사하지 않는 항목
// (B4·B5·B10·B16 중복, B15 하위 추가 키, B6 character_pool 형식)을 problem
// 목록으로 모은다. throw하지 않는다 — 컨테이너 형태 오류(비객체 입력)도 빈
// 배열로 돌려준다(판정이 아니라 집계이므로. 비객체 거부는 assertValidPreset 몫).
// cause에는 비교 근거만 담는다. 중복 값 자체는 메모리에만 머물고, P0 스크립트
// 출력에는 건수·locator·값 타입만 나간다(원문 출력 금지).

export type PresetProbeRule = "B4" | "B5" | "B10" | "B16" | "B15" | "B6";

export interface PresetProbeProblem {
  rule: PresetProbeRule;
  locator: string;
  kind: "duplicate" | "extra-key" | "format" | "type";
  cause: unknown;
}

function findDuplicates(values: unknown[]): { count: number; index: number; value: unknown }[] {
  const seen = new Map<unknown, { count: number; index: number }>();
  values.forEach((v, i) => {
    const hit = seen.get(v);
    if (hit) hit.count += 1;
    else seen.set(v, { count: 1, index: i });
  });
  return [...seen.entries()]
    .filter(([, e]) => e.count > 1)
    .map(([value, e]) => ({ value, count: e.count, index: e.index }));
}

function getSchemaPropsAt(pathParts: string[]): string[] {
  let node: unknown = presetSchema;
  for (const part of pathParts) {
    if (!isRecord(node)) return [];
    node = node[part];
  }
  if (!isRecord(node) || !isRecord(node.properties)) return [];
  return Object.keys(node.properties);
}

function readCharacterPoolPattern(): RegExp {
  let node: unknown = presetSchema;
  for (const part of ["properties", "assets", "properties", "character_pool", "items", "pattern"]) {
    if (!isRecord(node)) return ASSET_URI_PATTERN;
    node = node[part];
  }
  if (typeof node !== "string") return ASSET_URI_PATTERN;
  try {
    return new RegExp(node);
  } catch {
    return ASSET_URI_PATTERN;
  }
}

/**
 * B4·B5·B10·B16 중복, B15 하위 추가 키, B6 character_pool 형식을 집계한다.
 * 중복 검사는 스키마에 uniqueItems가 있는 문자열 배열 중 B4·B5·B10이 맡지 않은
 * 것(style.keywords·style.palette·context 5종)을 B16으로 묶는다.
 * B15 허용 키는 스키마 properties에서 읽는다(값 목록 복제 금지와 같은 취지).
 */
export function presetContractProbe(data: unknown): PresetProbeProblem[] {
  const out: PresetProbeProblem[] = [];
  if (!isRecord(data)) return out;

  const at = (path: string[]): unknown => {
    let node: unknown = data;
    for (const part of path) {
      if (!isRecord(node)) return undefined;
      node = node[part];
    }
    return node;
  };

  const dupPaths: { rule: PresetProbeRule; path: string[] }[] = [
    { rule: "B4", path: ["assets", "style_refs"] },
    { rule: "B5", path: ["assets", "reference_asset_ids"] },
    { rule: "B10", path: ["rules", "forbidden"] },
    { rule: "B16", path: ["style", "keywords"] },
    { rule: "B16", path: ["style", "palette"] },
    { rule: "B16", path: ["context", "industry"] },
    { rule: "B16", path: ["context", "interests"] },
    { rule: "B16", path: ["context", "age_band"] },
    { rule: "B16", path: ["context", "life_stage"] },
    { rule: "B16", path: ["context", "main_subjects"] },
  ];
  for (const { rule, path } of dupPaths) {
    const value = at(path);
    if (!Array.isArray(value)) continue;
    for (const d of findDuplicates(value)) {
      out.push({
        rule,
        locator: `${path.join(".")}[${d.index}]`,
        kind: "duplicate",
        cause: { value: d.value, count: d.count },
      });
    }
  }

  for (const obj of ["assets", "style", "rules", "context"]) {
    const node = at([obj]);
    if (!isRecord(node)) continue;
    const allowed = getSchemaPropsAt(["properties", obj]);
    if (allowed.length === 0) continue;
    for (const key of Object.keys(node)) {
      if (!allowed.includes(key)) {
        out.push({ rule: "B15", locator: `${obj}.${key}`, kind: "extra-key", cause: key });
      }
    }
  }

  const pool = at(["assets", "character_pool"]);
  if (pool !== undefined) {
    if (!Array.isArray(pool)) {
      out.push({ rule: "B6", locator: "assets.character_pool", kind: "type", cause: typeof pool });
    } else {
      const pattern = readCharacterPoolPattern();
      for (let i = 0; i < pool.length; i++) {
        const v: unknown = pool[i];
        if (typeof v !== "string" || !pattern.test(v)) {
          out.push({ rule: "B6", locator: `assets.character_pool[${i}]`, kind: "format", cause: typeof v });
        }
      }
      for (const d of findDuplicates(pool)) {
        out.push({
          rule: "B6",
          locator: `assets.character_pool[${d.index}]`,
          kind: "duplicate",
          cause: { count: d.count },
        });
      }
    }
  }

  return out;
}

/**
 * R1-a (K2): 프리셋 저장 경로(`/api/preset` POST·PATCH) 전용 중복 제거.
 * 대상은 스키마에서 uniqueItems가 걸린 문자열 배열을 읽어 정한다(경로 목록
 * 복제 금지). B6 character_pool은 읽는 코드가 없어 제외한다(명시 목록 1개).
 * 규칙: 배열 안 정확히 같은 값(===)의 두 번째 이후를 제거, 첫 등장 순서 유지.
 * 대소문자 구분, trim 등 정규화 없음(정확 일치만). 입력을 바꾸지 않고 새 객체를
 * 반환한다(순수). removed에는 경로·건수만 담는다(값 원문 없음).
 * 공개: 프리셋 저장 시 배열의 중복 값은 첫 등장만 남기고 지운다 —
 * 저장 값이 보낸 값과 다를 수 있다(중복만).
 */
const DEDUPE_EXCLUDED_PATHS = new Set(["assets.character_pool"]);

function uniqueStringArrayPaths(): string[][] {
  const out: string[][] = [];
  const schemaRec = presetSchema as unknown as Record<string, unknown>;
  const root: Record<string, unknown> = isRecord(schemaRec.properties)
    ? schemaRec.properties
    : {};
  for (const section of Object.keys(root)) {
    const def: unknown = root[section];
    if (!isRecord(def) || !isRecord(def.properties)) continue;
    for (const key of Object.keys(def.properties)) {
      const field: unknown = def.properties[key];
      if (!isRecord(field) || field.type !== "array" || field.uniqueItems !== true) continue;
      const items: unknown = field.items;
      if (!isRecord(items) || items.type !== "string") continue;
      if (DEDUPE_EXCLUDED_PATHS.has(`${section}.${key}`)) continue;
      out.push([section, key]);
    }
  }
  return out;
}

export interface DedupeRemoved {
  path: string;
  count: number;
}

export function dedupePresetArrays<T>(preset: T): { preset: T; removed: DedupeRemoved[] } {
  const removed: DedupeRemoved[] = [];
  if (!isRecord(preset)) return { preset, removed };
  const next: Record<string, unknown> = { ...(preset as Record<string, unknown>) };
  for (const [section, key] of uniqueStringArrayPaths()) {
    const node = next[section];
    if (!isRecord(node)) continue;
    const arr: unknown = node[key];
    if (!Array.isArray(arr)) continue;
    const kept: unknown[] = [];
    let count = 0;
    for (const v of arr) {
      if (kept.indexOf(v) < 0) kept.push(v);
      else count += 1;
    }
    if (count > 0) {
      next[section] = { ...node, [key]: kept };
      removed.push({ path: `${section}.${key}`, count });
    }
  }
  return { preset: next as T, removed };
}
