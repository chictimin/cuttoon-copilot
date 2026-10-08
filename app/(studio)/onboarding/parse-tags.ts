// 쉼표로 구분한 자유 텍스트(업종·주요 소재·금지 요소·그림체 키워드)를 목록으로 바꾼다. 화면 두 곳
// (DetailsStep·OnboardingFlow)이 각자 갖고 있던 같은 함수를 하나로 합쳤다(#263).
// 각 항목은 trim하고, trim 뒤 글자가 정확히 같으면(대소문자 구분) 처음 것만 남겨 순서를 유지한다.
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}
