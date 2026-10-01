/**
 * 소재 [태그] 파싱·투영·복원 공용 함수 (issue #206 K8).
 *
 * 순수 모듈이라 클라이언트·서버·lib/openai 어디서든 import할 수 있다 —
 * 서버 모듈·DB·env import 금지.
 *
 * 태그 식별자는 배열 순서다. 서버는 받은 subject를 스스로 다시 파싱해 raw
 * 목록을 얻고(화면 값을 믿지 않는다), category는 subject_tags에서 순서대로
 * 대응시킨다. 개수가 다르거나 누락되면 그 태그는 "제품"으로 둔다.
 */

export interface SubjectTag {
  raw: string;
  category?: string;
}

/** 추론·지정 모두 실패했을 때 쓰는 카테고리. */
export const SUBJECT_TAG_FALLBACK_CATEGORY = "제품";

/** 태그 최대 개수·개별 최대 길이. 서버 검증과 같은 값이다. */
export const SUBJECT_TAG_MAX_COUNT = 3;
export const SUBJECT_TAG_MAX_LENGTH = 30;

const TAG_PATTERN = /\[([^\[\]\n]+)\]/g;
const BRACKET_PATTERN = /[\[\]]/g;

function cleanTagText(text: string): string {
  return text
    .replace(/[\r\n<>]/g, "")
    .trim()
    .slice(0, SUBJECT_TAG_MAX_LENGTH);
}

/**
 * 소재 안의 [태그]를 등장 순서대로 파싱한다.
 *
 * - 빈 괄호(`[]`)는 무시한다. 짝 없는 괄호는 태그가 아니다(닫힘이 있어야 매칭된다).
 * - 중첩(`[[A]]`)은 안쪽만 태그다 — 바깥 `[` 뒤에 바로 `[`가 오면 매칭이 실패해
 *   다음 위치에서 다시 시도하므로 안쪽 `[A]`만 잡힌다.
 * - `[A:B]`는 raw=A·category=B(사용자 지정). 콜론이 여러 개면 첫 번째 기준이다.
 *   category가 비면 지정 없음으로 취급한다. raw가 비면 태그가 아니다.
 * - 최대 3개·각 30자(넘으면 자름). raw 기준 중복 제거(순서 유지).
 * - 태그 안의 줄바꿈·`<`·`>`은 제거한다.
 */
export function parseSubjectTags(subject: string): SubjectTag[] {
  const tags: SubjectTag[] = [];
  const seen = new Set<string>();

  for (const match of subject.matchAll(TAG_PATTERN)) {
    if (tags.length >= SUBJECT_TAG_MAX_COUNT) break;
    const inner = match[1].trim();
    if (!inner) continue;

    const colon = inner.indexOf(":");
    let raw: string;
    let category: string | undefined;
    if (colon < 0) {
      raw = inner;
    } else {
      raw = inner.slice(0, colon);
      category = inner.slice(colon + 1);
    }

    raw = cleanTagText(raw);
    if (!raw) continue;
    if (category !== undefined) {
      category = cleanTagText(category);
      if (!category) category = undefined;
    }
    if (seen.has(raw)) continue;
    seen.add(raw);
    tags.push(category === undefined ? { raw } : { raw, category });
  }

  return tags;
}

/** 화면 표시용. 괄호 기호만 지우고 글자는 유지한다(짝 없는 괄호 기호도 제거). */
export function displaySubject(subject: string): string {
  return subject.replace(BRACKET_PATTERN, "");
}

function categoryAt(subjectTags: SubjectTag[] | undefined, index: number): string {
  const category = subjectTags?.[index]?.category?.trim();
  return category ? category : SUBJECT_TAG_FALLBACK_CATEGORY;
}

/**
 * 모델·이미지에 보낼 텍스트에서 raw를 category로 바꾼다. 소재 문장·cast 서술
 * 어디에나 쓰는 함수 하나다.
 *
 * - 서버가 subject를 스스로 다시 파싱해 raw 목록을 얻는다. category는
 *   subjectTags에서 순서대로 대응시키며, subjectTags 원소의 raw는 보지 않는다
 *   (위치가 식별자다). 개수 불일치·누락이면 그 태그는 "제품"이다.
 * - text 안의 raw는 괄호 포함(`[raw]`)·미포함 둘 다 바꾼다. 긴 raw부터 바꿔
 *   짧은 raw가 긴 raw 안에 들어있을 때 겹침을 막는다.
 * - 바꾼 뒤 남은 괄호 기호는 지운다.
 */
export function projectForModel(
  text: string,
  subject: string,
  subjectTags?: SubjectTag[]
): string {
  const raws = parseSubjectTags(subject).map((tag) => tag.raw);
  const order = raws
    .map((raw, index) => ({ raw, index }))
    .sort((a, b) => b.raw.length - a.raw.length);

  let out = text;
  for (const { raw, index } of order) {
    const category = categoryAt(subjectTags, index);
    out = out.split(`[${raw}]`).join(category).split(raw).join(category);
  }
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
 * - 매핑은 projectForModel과 같은 규칙이다(subject 재파싱 + 순서 대응 +
 *   누락은 "제품").
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
  const raws = parseSubjectTags(subject).map((tag) => tag.raw);
  const categories = raws.map((_, index) => categoryAt(subjectTags, index));
  const nextFrom = new Map<string, number>();

  return captions.map((caption) => {
    if (caption.cut_index !== targetCutIndex) return caption;
    let text = caption.text;
    raws.forEach((raw, i) => {
      const category = categories[i];
      const from = nextFrom.get(category) ?? 0;
      const at = text.indexOf(category, from);
      if (at < 0) return;
      text = text.slice(0, at) + raw + text.slice(at + category.length);
      nextFrom.set(category, at + raw.length);
    });
    return text === caption.text ? caption : { ...caption, text };
  });
}
