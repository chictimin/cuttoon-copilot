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
// TASK-004(#222 5번·#261): 설정에 더해 호출마다 걸린 시간·성공 여부도 남긴다. 리허설
// 측정(이미지 호출 수·비용, 한 편 완성 시간)과 "생성 전 소요 시간 안내" 근거 숫자용이다.
// 유료 호출 1회 = 로그 1줄이 되게 실제 생성 호출만 감싼다.
//
//   [image] cut IMAGE_PROVIDER=openai ok 41.3s
//   [image] cover_variant IMAGE_PROVIDER=openai fail 0.8s 429 project_spend_limit_exceeded
//
// 실패 사유는 status·code 만 찍는다. 에러 메시지 전문에는 요청 파라미터·조직 정보가 섞일
// 수 있어(route.ts 가 응답에 원문을 안 넣는 것과 같은 이유) 프롬프트·키·URL 과 함께 뺀다.
// 에러는 그대로 다시 던진다 — 호출부의 실패 처리(allSettled·재시도)는 바뀌지 않는다.
//
// style_extract 는 이미지 생성이 아니라 레퍼런스 분석(gpt-4o) 호출이다. IMAGE_PROVIDER 와
// 무관하게 OpenAI 로 가므로 설정 대신 모델 이름을 찍는다.
export type ImageCallKind = 'character_sheet' | 'cover_variant' | 'cut' | 'style_extract'

/** 로그에 찍을 설정 표기. 이미지 호출은 `IMAGE_PROVIDER=<값>`. */
export function settingTag(setting: ImageSetting): string {
  return `${IMAGE_SETTING_ENV}=${setting}`
}

/** 경과 초를 소수 1자리로. */
export function elapsedSeconds(startedAt: number): string {
  return ((performance.now() - startedAt) / 1000).toFixed(1)
}

// 실패 사유는 허용 목록으로만 찍는다(#274 리뷰). 처음엔 "식별자 모양"(영문·숫자·_ . -)이면
// 통과시켰는데, sk-proj-… 같은 키도 그 모양이라 code 자리에 들어오면 그대로 새었다.
// 그래서 로그에 나가는 것은 숫자 status 와 아래 목록의 고정 문자열뿐이다.
//
// code: OpenAI API 오류 응답의 error.code / error.type 으로 문서·실측에서 본 값이다
// (429 지출 한도·크레딧 부족, 키 오류, 모델 없음, 안전 정책 거절, 서버 오류 등). 값이 있는데
// 목록에 없으면 `code_other` 로만 남긴다 — 새 코드가 보이면 여기에 추가한다.
const KNOWN_ERROR_CODES = new Set([
  'insufficient_quota',
  'project_spend_limit_exceeded',
  'rate_limit_exceeded',
  'billing_hard_limit_reached',
  'invalid_api_key',
  'model_not_found',
  'content_policy_violation',
  'moderation_blocked',
  'server_error',
  'timeout',
  'invalid_request_error',
  'context_length_exceeded',
  'image_generation_user_error',
])

// name: status·code 가 둘 다 없을 때만 쓴다. openai SDK 오류 클래스 이름 + 기본 오류 이름.
const KNOWN_ERROR_NAMES = new Set([
  'APIError',
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'APIUserAbortError',
  'AuthenticationError',
  'BadRequestError',
  'PermissionDeniedError',
  'NotFoundError',
  'ConflictError',
  'UnprocessableEntityError',
  'RateLimitError',
  'InternalServerError',
  'Error',
  'TypeError',
  'AbortError',
])

function safeStatus(value: unknown): string | undefined {
  // 문자열이면 숫자로만 이뤄졌을 때 바꾼다("429" 허용, "429abc"·"sk-…" 버림).
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : NaN
  return Number.isInteger(n) && n >= 100 && n <= 599 ? String(n) : undefined
}

function safeCode(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return typeof value === 'string' && KNOWN_ERROR_CODES.has(value) ? value : 'code_other'
}

export function failReason(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const { status, code, name } = err as { status?: unknown; code?: unknown; name?: unknown }
    const parts = [safeStatus(status), safeCode(code)].filter((v): v is string => v !== undefined)
    if (parts.length) return parts.join(' ')
    if (typeof name === 'string' && KNOWN_ERROR_NAMES.has(name)) return name
  }
  return 'error'
}

export async function timeImageCall<T>(kind: ImageCallKind, tag: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now()
  try {
    const result = await fn()
    console.info(`[image] ${kind} ${tag} ok ${elapsedSeconds(startedAt)}s`)
    return result
  } catch (err) {
    console.info(`[image] ${kind} ${tag} fail ${elapsedSeconds(startedAt)}s ${failReason(err)}`)
    throw err
  }
}
