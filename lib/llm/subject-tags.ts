/**
 * 소재 [태그] 파싱·투영·복원 공용 함수 (issue #206 K8).
 *
 * 순수 모듈이라 클라이언트·서버·lib/openai 어디서든 import할 수 있다 —
 * 서버 모듈·DB·env import 금지.
 *
 * 태그 식별자는 배열 순서다. 서버는 받은 subject를 스스로 다시 파싱해 raw
 * 목록을 얻고(화면 값을 믿지 않는다), category는 subject_tags에서 순서대로
 * 대응시킨다. 개수가 다르거나 누락되면 그 태그는 "제품"으로 둔다.
 *
 * 누출 방지 원칙(원문 브랜드는 어떤 경우에도 LLM·이미지로 보내지 않는다 —
 * 단, 카테고리 추론 호출(K9)은 원문을 입력으로 쓴다. 그 출력은 category만
 * 정리해 채택하고 raw는 버린다):
 * - 매칭은 절단 전 원문(fullRaw)으로 한다. 30자 절단은 저장·표시용 raw에만
 *   적용한다. 절단 꼬리가 텍스트에 남아도 매칭돼 category로 바뀐다.
 * - raw 매칭은 대소문자 무시 + 글자 사이 공백 유무 무시("New Balance" ↔
 *   "new balance"·"NewBalance", "나이키" ↔ "나 이 키"). dedup도 같은 기준이다.
 * - 치환은 모든 raw를 하나의 교대 정규식으로 묶어 한 번만 훑는다. 넣은
 *   category가 다시 훑이지 않으므로 재치환 오염이 없다.
 * - category는 categoryAt 한 곳에서 정리한다. 정리 후 그 태그(또는 다른 태그)의
 *   raw를 포함하면 "제품"으로 교체한다 — 모델·사용자가 원문을 category에
 *   담아도 새지 않는다.
 */

export interface SubjectTag {
  raw: string;
  category?: string;
}

/** 추론·지정 모두 실패했을 때 쓰는 카테고리. */
export const SUBJECT_TAG_FALLBACK_CATEGORY = "제품";

/** 태그 최대 개수·개별 최대 길이(저장·표시용 raw에만 적용). 서버 검증과 같은 값이다. */
export const SUBJECT_TAG_MAX_COUNT = 3;
export const SUBJECT_TAG_MAX_LENGTH = 30;

const TAG_PATTERN = /\[([^\[\]\n]+)\]/g;
const BRACKET_PATTERN = /[\[\]]/g;
/** category에서 걷어내는 기호. 원문 조각이 기호에 숨어 새는 것을 막는다. */
const CATEGORY_STRIP_PATTERN = /[\[\]*'"`“”‘’「」『』]/g;

/** 매칭·dedupe용 정규화: 소문자 + 공백 제거. */
export function normalizeTagText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function cleanTagText(text: string): string {
  // 줄바꿈이 들어간 괄호는 위 정규식이 \n을 배제하므로 태그가 아니다.
  // `<`·`>`는 제거하는데, `<b>` 같은 마크업이 `<b>`→`b`처럼 글자로 남을 수 있다.
  // 태그명이 되는 자리라 실제 피해는 작아 수용한다(저위험).
  return text
    .replace(/[\r\n<>]/g, "")
    .trim()
    .slice(0, SUBJECT_TAG_MAX_LENGTH);
}

/** 저장용 raw + 매칭용 원문을 함께 들고 있는 내부 파싱 결과. */
export interface ParsedSubjectTag {
  /** 저장·표시용. 30자로 자른 값이다. */
  raw: string;
  /** 매칭용. 괄호 안 trim 전체(절단 없음)다. */
  fullRaw: string;
  category?: string;
}

/**
 * 소재 안의 [태그]를 등장 순서대로 파싱한다(내부용 상세형).
 *
 * - 빈 괄호(`[]`)는 무시한다. 짝 없는 괄호는 태그가 아니다(닫힘이 있어야 매칭된다).
 * - 중첩(`[[A]]`)은 안쪽만 태그다 — 바깥 `[` 뒤에 바로 `[`가 오면 매칭이 실패해
 *   다음 위치에서 다시 시도하므로 안쪽 `[A]`만 잡힌다.
 * - `[A:B]`는 raw=A·category=B(사용자 지정). 콜론이 여러 개면 첫 번째 기준이다.
 *   category가 비면 지정 없음으로 취급한다. raw가 비면 태그가 아니다.
 * - limit까지만 받는다. raw는 30자로 잘라 저장하고, 매칭은 절단 전 원문으로 한다.
 * - raw 정규화(소문자·공백 제거) 기준 중복 제거 — 먼저 나온 것을 유지한다.
 */
export function parseSubjectTagDetails(subject: string): ParsedSubjectTag[] {
  return parseTagDetails(subject, SUBJECT_TAG_MAX_COUNT);
}

/**
 * 상한 없는 파싱. 투영(projectForModel) 전용이다 — 4번째 이후 태그도 "제품"으로
 * 투영해야 해서 파싱 자체는 전부 본다. 저장(subject_tags)·추론 대상은
 * parseSubjectTagDetails의 3개 제한을 그대로 둔다.
 */
function parseAllTagDetails(subject: string): ParsedSubjectTag[] {
  return parseTagDetails(subject, Number.MAX_SAFE_INTEGER);
}

function parseTagDetails(subject: string, limit: number): ParsedSubjectTag[] {
  const tags: ParsedSubjectTag[] = [];
  const seen = new Set<string>();

  for (const match of subject.matchAll(TAG_PATTERN)) {
    if (tags.length >= limit) break;
    const inner = match[1].trim();
    if (!inner) continue;

    const colon = inner.indexOf(":");
    const fullRaw = (colon < 0 ? inner : inner.slice(0, colon)).trim();
    let category = colon < 0 ? undefined : inner.slice(colon + 1).trim();
    if (!fullRaw) continue;

    const key = normalizeTagText(fullRaw);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const raw = cleanTagText(fullRaw);
    if (!raw) continue;
    if (category !== undefined) {
      category = cleanTagText(category);
      if (!category) category = undefined;
    }
    tags.push(category === undefined ? { raw, fullRaw } : { raw, fullRaw, category });
  }

  return tags;
}

/** 저장·전송용. 매칭용 원문(fullRaw)은 빼고 돌려준다. */
export function parseSubjectTags(subject: string): SubjectTag[] {
  return parseSubjectTagDetails(subject).map(({ raw, category }) =>
    category === undefined ? { raw } : { raw, category }
  );
}

/** 화면 표시용. 괄호 기호만 지우고 글자는 유지한다(짝 없는 괄호 기호도 제거). */
export function displaySubject(subject: string): string {
  return subject.replace(BRACKET_PATTERN, "");
}

function escapeRegExpChar(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * category 정리 + 누출 검사. categoryAt(모든 호출부 공통 지점)와 K9 채택 직후가
 * 같은 함수를 통과한다.
 */
export function sanitizeTagCategory(
  category: string | undefined,
  allRaws: string[]
): string {
  if (category === undefined) return SUBJECT_TAG_FALLBACK_CATEGORY;
  const cleaned = category.replace(CATEGORY_STRIP_PATTERN, "").trim();
  const norm = normalizeTagText(cleaned);
  if (!norm) return SUBJECT_TAG_FALLBACK_CATEGORY;
  for (const other of allRaws) {
    const normRaw = normalizeTagText(other);
    if (normRaw && norm.includes(normRaw)) return SUBJECT_TAG_FALLBACK_CATEGORY;
  }
  return cleaned;
}

function categoryAt(
  subjectTags: SubjectTag[] | undefined,
  index: number,
  fullRaws: string[]
): string {
  return sanitizeTagCategory(subjectTags?.[index]?.category, fullRaws);
}

/**
 * 모델·이미지에 보낼 텍스트에서 raw를 category로 바꾼다. 소재 문장·cast 서술
 * 어디에나 쓰는 함수 하나다.
 *
 * - 서버가 subject를 스스로 다시 파싱해 raw 목록을 얻는다. category는
 *   subjectTags에서 순서대로 대응시키며, subjectTags 원소의 raw는 보지 않는다
 *   (위치가 식별자다). 개수 불일치·누락이면 그 태그는 "제품"이다.
 * - 매칭은 절단 전 원문 + 대소문자 무시 + 공백 유무 무시 + 괄호 span 전체
 *   (`[raw:category]`·`[raw]`) 먼저 + 괄호 밖 맨몸 raw 나중이다. 둘을 하나의
 *   교대 정규식으로 묶어 한 번만 훑고 콜백으로 category를 넣는다(span 안의
 *   `:category` 표기는 버리고 매핑값을 쓴다).
 * - 4번째 이후 태그도 전부 투영한다(3개 초과분은 "제품" — 조용한 누출 금지).
 * - 바꾼 뒤 남은 괄호 기호는 지운다.
 */
export function projectForModel(
  text: string,
  subject: string,
  subjectTags?: SubjectTag[]
): string {
  const details = parseAllTagDetails(subject);
  const fullRaws = details.map((tag) => tag.fullRaw);
  const ordered = details
    .map((tag, index) => ({ fullRaw: tag.fullRaw, index }))
    .filter(({ fullRaw }) => normalizeTagText(fullRaw))
    .sort((a, b) => b.fullRaw.length - a.fullRaw.length);
  if (ordered.length === 0) return text.replace(BRACKET_PATTERN, "");

  const parts = ordered.map(({ fullRaw }, k) => {
    const chars = [...normalizeTagText(fullRaw)].map(escapeRegExpChar).join("\\s*");
    return `(?<t${k}>\\[${chars}(?::[^\\[\\]\\n]*)?\\]|${chars})`;
  });
  const pattern = new RegExp(parts.join("|"), "giu");

  const out = text.replace(pattern, (...args: unknown[]) => {
    const groups = args[args.length - 1] as Record<string, string | undefined>;
    for (let k = 0; k < ordered.length; k++) {
      if (groups[`t${k}`] !== undefined) {
        return categoryAt(subjectTags, ordered[k].index, fullRaws);
      }
    }
    return args[0] as string;
  });
  return out.replace(BRACKET_PATTERN, "");
}

export interface CaptionLine {
  cut_index: number;
  text: string;
}

/**
 * 대사 생성 직후 한 번만 적용하는 복원. 대상 컷 하나에서만, 태그 순서대로
 * category의 첫 등장 1곳을 raw로 바꾼다.
 *
 * - subjectTags가 없거나 파싱 결과와 개수가 다르면 아무것도 바꾸지 않는다.
 *   개수가 어긋난 채로 "제품"을 raw로 바꾸면 대사의 일반 단어가 브랜드로
 *   바뀌는 오작동이 되기 때문이다.
 * - category가 없거나(undefined) trim 후 빈 문자열인 태그는 복원하지 않고
 *   건너뛴다. 투영(projectForModel)의 "제품" 폴백과 달리 복원은 미확정 태그를
 *   건드리지 않는다.
 * - 같은 category가 둘(TYPE이 같은 두 태그)이면 등장 순서대로 대응한다 —
 *   category별로 다음 탐색 시작 위치를 기억해 첫 태그는 첫 등장, 두 번째
 *   태그는 그 다음 등장을 바꾼다.
 * - 그 컷에서 category를 못 찾으면 그대로 둔다. 재요청·조사 보정·삽입 없음.
 * - 다른 컷은 손대지 않는다. 입력 배열을 고치지 않고 새 배열을 반환한다.
 */
export function restoreFirstMention(
  captions: CaptionLine[],
  subject: string,
  subjectTags: SubjectTag[] | undefined,
  targetCutIndex = 3
): CaptionLine[] {
  const details = parseSubjectTagDetails(subject);
  if (!subjectTags || details.length !== subjectTags.length) return captions;

  const fullRaws = details.map((tag) => tag.fullRaw);
  const categories = details.map((_, index) => {
    const rawCategory = subjectTags[index]?.category;
    if (typeof rawCategory !== "string" || rawCategory.trim().length === 0) {
      return undefined;
    }
    return categoryAt(subjectTags, index, fullRaws);
  });
  const nextFrom = new Map<string, number>();

  return captions.map((caption) => {
    if (caption.cut_index !== targetCutIndex) return caption;
    let text = caption.text;
    details.forEach((tag, i) => {
      const category = categories[i];
      if (category === undefined) return;
      const from = nextFrom.get(category) ?? 0;
      const at = text.indexOf(category, from);
      if (at < 0) return;
      text = text.slice(0, at) + tag.raw + text.slice(at + category.length);
      nextFrom.set(category, at + tag.raw.length);
    });
    return text === caption.text ? caption : { ...caption, text };
  });
}
