// #190: 이미지 생성 설정 선택. 개발·QA 비용을 줄이려고 저가 설정(openai-low)을
// 내부 옵션으로 둔다 — 환경변수로만 고르고 사용자 선택 UI는 두지 않는다(PRD 3절
// "멀티 프로바이더 선택 UI" 제외는 그대로).
//
// P0 판정(#113)·gate-evidence·발표 데모·10-14 이후 최종 회귀는 기본값(openai)으로만
// 한다. 저가 설정은 그림이 달라서, 거기서 합격해도 기본 설정에서 합격한다는 보장이
// 없다(#190 QA 인정 범위).
//
// comfyui 는 로컬 ComfyUI 로 그리는 개발 테스트 전용 POC 다(#190 10-01 결정). 체이닝·시트
// reference 가 없어 그림 조건이 다르다 — 자세한 차이는 comfyui.ts 머리말.
import { comfyuiBaseUrl, comfyuiModel } from './comfyui'

export const IMAGE_SETTING_ENV = 'IMAGE_PROVIDER'

const SETTINGS = ['openai', 'openai-low', 'comfyui'] as const
export type ImageSetting = (typeof SETTINGS)[number]

// 호출 시점에 읽는다 — COVER_VARIANT_RETRY 와 같은 이유로, 모듈 로드 때 캐시하면
// 값을 바꿔도 프로세스를 다시 띄울 때까지 안 먹는다.
//
// 모르는 값은 던진다. 오타('openai_low', 'low')가 조용히 기본값으로 떨어지면
// "저가로 돌리는 줄 알았는데 기본 요금이 나가는" 쪽으로 실패한다 — 스텁 3규칙 ②
// (실패 가시화). 호출부는 유료 호출 전에 이 함수를 불러 거기서 막는다.
export function imageSetting(): ImageSetting {
  const raw = process.env[IMAGE_SETTING_ENV]?.trim().toLowerCase()
  if (!raw) return 'openai'
  if ((SETTINGS as readonly string[]).includes(raw)) {
    // comfyui 는 주소가 없으면 여기서 막는다. 표지 3안은 allSettled 배치라 안에서 던지면
    // "3안 모두 실패"로 원인이 뭉개진다. 연결 실패는 호출 때 comfyui.ts 가 던진다.
    if (raw === 'comfyui') {
      comfyuiBaseUrl()
      comfyuiModel()
    }
    return raw as ImageSetting
  }
  throw new Error(`${IMAGE_SETTING_ENV}=${raw} 는 모르는 값입니다 — ${SETTINGS.join(' | ')} 중 하나로 두거나 비워 두세요`)
}

// 기본값(openai)은 quality 를 아예 보내지 않는다. 지금까지 판정(#113)이 모델 기본값으로
// 돌았으므로, 'auto' 를 명시하는 것도 조건 변경이 될 수 있어 요청 모양을 그대로 둔다.
export function imageQuality(setting: ImageSetting): 'low' | undefined {
  return setting === 'openai-low' ? 'low' : undefined
}

// 어느 설정으로 만든 이미지인지는 스키마를 건드리지 않고 서버 로그에만 남긴다(#190).
export function logImageSetting(kind: 'character_sheet' | 'cover_variant' | 'cut', setting: ImageSetting): void {
  console.info(`[image] ${kind} ${IMAGE_SETTING_ENV}=${setting}`)
}
