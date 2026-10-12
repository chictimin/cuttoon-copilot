// #326 비교 실험(POC 한정): 컷 참조 방식 스위치. 서버(generate.ts)와 화면
// (SessionFlow·generate-client)이 같은 값을 읽어야 해서 NEXT_PUBLIC_ 변수 하나로 둔다.
//
// - chain (기본, A): 지금 그대로. 표지 = 컷 1, 컷 2~4는 앞 컷 이어받기 + [시트, ...style_refs].
// - chain-nostyle (A'): A와 같되, 이어 그리는 컷(continueFrom 있음)에는 style_refs를 빼고 시트만(#328 1번).
// - cover-ref (C): 표지는 기준 그림. 컷 1~4를 새로 그리고, 각 컷은 [시트, 고른 표지]만 참조,
//   이어받기 없이 동시 생성.
//
// 모르는 값은 chain으로 돌린다 — 실험 스위치 오타로 생성이 막히지 않게 하되, 콘솔에 남긴다.
// NEXT_PUBLIC_ 값은 화면 번들에 빌드(dev 서버 시작) 시점에 박힌다. 바꾸면 dev 서버를 다시 띄운다.
export type CutReferenceMode = 'chain' | 'chain-nostyle' | 'cover-ref'

const MODES: readonly CutReferenceMode[] = ['chain', 'chain-nostyle', 'cover-ref']

export function cutReferenceMode(): CutReferenceMode {
  // process.env.NEXT_PUBLIC_… 를 그대로 적어야 Next가 화면 번들에 값을 넣는다(구조 분해 금지).
  const raw = (process.env.NEXT_PUBLIC_CUT_REFERENCE_MODE ?? '').trim()
  if (!raw) return 'chain'
  if ((MODES as readonly string[]).includes(raw)) return raw as CutReferenceMode
  console.warn(`[cut-reference-mode] 모르는 값 "${raw}" — chain(A)으로 동작합니다`)
  return 'chain'
}
