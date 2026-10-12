// #326 컷 참조 방식 스위치(POC 통합 기준). 서버(generate.ts)가 읽는다.
//
// - cover-ref-chain (기본, C´): 컷 1 = 기준 컷(cover_variants count 1, bust·eye). 컷 2~4는
//   [시트, 기준 컷](reference_asset) + 앞 컷 이어받기(continueFrom).
// - chain (비상용, A): main 기존 방식. reference_asset 을 무시하고 [시트, ...style_refs] +
//   앞 컷 이어받기.
//
// 값이 비었거나 모르는 값이면 C´로 돈다(모르는 값은 콘솔에 남긴다).
// NEXT_PUBLIC_ 이라 값이 빌드(dev 서버 시작) 시점에 박힌다. 바꾸면 dev 서버를 다시 띄운다.
export type CutReferenceMode = 'cover-ref-chain' | 'chain'

const MODES: readonly CutReferenceMode[] = ['cover-ref-chain', 'chain']

export function cutReferenceMode(): CutReferenceMode {
  // process.env.NEXT_PUBLIC_… 를 그대로 적어야 Next가 번들에 값을 넣는다(구조 분해 금지).
  const raw = (process.env.NEXT_PUBLIC_CUT_REFERENCE_MODE ?? '').trim()
  if (!raw) return 'cover-ref-chain'
  if ((MODES as readonly string[]).includes(raw)) return raw as CutReferenceMode
  console.warn(`[cut-reference-mode] 모르는 값 "${raw}" — cover-ref-chain(C´)으로 동작합니다`)
  return 'cover-ref-chain'
}
