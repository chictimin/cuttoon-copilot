"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { assertStoryboardRuntimeInvariants } from "@/lib/llm/storyboard-guard";
import type { Preset } from "@/lib/llm/preset-guard";
// 타입만 가져온다 — lib/llm/brainstorm.ts 는 OPENAI_API_KEY 를 쓰는 서버 모듈이라
// 런타임 import 는 클라이언트로 넘어오면 안 된다.
import type { BrainstormTurn, ExtractedSlot } from "@/lib/llm/brainstorm";
// brainstorm.ts와는 별개 파일이다 — OPENAI_API_KEY를 쓰지 않는 순수 상수라
// 값으로 import해도 위 규칙에 안 걸린다(lib/llm/brainstorm-options.ts 참고).
import {
  FLOW_QUESTION,
  NO_SUPPORTING_OPTION,
  PROTAGONIST_QUESTION,
  SUPPORTING_QUESTION,
  autoAnswer,
} from "@/lib/llm/brainstorm-options";
import {
  displaySubject,
  normalizeStoredSubjectTags,
  type StoredSubjectTag,
} from "@/lib/llm/subject-tags";
// caption-tones.ts도 JSON 로더라 OPENAI_API_KEY를 쓰지 않아 클라이언트에서 안전하다.
import { loadCaptionTones } from "@/lib/llm/caption-tones";
// #205: 흐름 라벨 표시·CTA 요청 타입과 CTA 목록도 JSON 로더·순수 함수라 클라이언트에서 안전하다.
import { displayFlowLabel, type CtaRequest, type CtaStrength } from "@/lib/llm/narrative-flow";
import { getCtaPresetById, resolveCandidates, type CtaPreset } from "@/lib/llm/cta-presets";
import {
  assembleStoryboard,
  applyCutDirections,
  setCaptionSpeaker,
  FLOW_OPTIONS,
  type BrainstormAnswers,
} from "./storyboard-assembly";
import { resolveImageUrl } from "../../asset-url";
import { CTA_STRENGTHS } from "../../cta-strength-options";
import { beatLabel } from "../../ui-labels";
import { generateChainedCuts, generateCoverVariants, type GeneratedCut } from "./generate-client";
// 순수 헬퍼라 클라이언트에서 값으로 import해도 된다(서버 모듈·DB import 없음, #207).
import {
  createSelectionLog,
  markRegenerated,
  markSelected,
  recordRound,
  toPayload,
  type SelectionLog,
} from "@/lib/session/selection-log";
import {
  EMPTY_CONTEXT_HINT,
  fetchSubjectSuggestions,
  hasSuggestionContext,
} from "./subject-suggestions";
import type { Cut, Storyboard } from "./storyboard-types";

type Step = "subject" | "brainstorm" | "tone" | "assembling" | "captions" | "cover" | "generating" | "cuts" | "saved";

const TURN_ORDER: BrainstormTurn["key"][] = ["protagonist", "supporting", "flow"];

// LLM 응답을 화면이 쓸 수 있는 형태로 맞춘다. 모델 응답은 순서·개수·문자열을
// 보장하지 않으므로 세 가지를 여기서 고정한다.
//
// 1. flow 턴은 서버가 정규화한 선택지를 쓴다(F1, spec-llm-line.md). 흐름 선택은
//    자유 텍스트가 아니라 NarrativeBeat 템플릿을 고르는 것이라(스키마의
//    narrative_beat enum), 허용 키와 일치하는 서버 옵션만 순서대로 살리고 빠진
//    키만 로컬 FLOW_OPTIONS 에서 채운다. 허용 키 밖 문자열은 여기서 덜어낸다 —
//    남기면 assembleStoryboard 가 조용히 기본 흐름으로 폴백해 어떤 흐름을 골라도
//    같은 4컷이 나온다. question 은 서버 값을 쓰되 비어 있으면 로컬 FLOW_QUESTION
//    으로 둔다(설명 문구 고정은 서버 몫).
// 2. 조연 없이 진행하는 선택지는 PRD 6절의 필수 경로다(조연 유무가 cast 구성을
//    바꾼다). 프롬프트가 그 문자열을 리터럴로 지시하지만 모델이 무시할 수 있어
//    빠져 있으면 되살린다 — 사용자 입력을 덮어쓰는 게 아니라 사라진 선택지를
//    복구하는 것이다.
// 3. 순서를 protagonist → supporting → flow 로 맞추고 빠진 턴은 채운다.
function normalizeTurns(turns: BrainstormTurn[]): BrainstormTurn[] {
  const byKey = new Map(turns.map((turn) => [turn.key, turn]));

  return TURN_ORDER.map((key) => {
    if (key === "flow") {
      return normalizeFlowTurn(byKey.get(key));
    }

    const turn = byKey.get(key);
    if (!turn || turn.options.length === 0) {
      // 모델이 이 턴을 빼먹은 경우. 선택지를 만들 근거가 없으니 "직접 쓸게" 로만
      // 진행하도록 빈 목록을 남긴다 — 임의 값을 지어내면 mock 으로 되돌아간다.
      return { key, question: FALLBACK_QUESTION[key], options: [] };
    }

    return key === "supporting" && !turn.options.includes(NO_SUPPORTING_OPTION)
      ? { ...turn, options: [...turn.options, NO_SUPPORTING_OPTION] }
      : turn;
  });
}

// #150: 대사 요청의 supporting_id — 조립된 cast의 조연 character_id(마스코트면
// mascot.label). 조연이 없으면 키를 빼 서버가 "supporting"으로 처리하게 둔다.
function supportingIdField(storyboard: Storyboard): { supporting_id?: string } {
  const supporting = storyboard.cast.find((member) => member.role === "supporting");
  return supporting ? { supporting_id: supporting.character_id } : {};
}

// spec-a3 3-2: 조립 전에는 상태 subjectTags, 조립 후에는 storyboard.subject_tags가
// 단일 출처다. 화면 타입(storyboard-types.ts)은 A① 소유라 손대지 않고, 이 화면에서만
// 쓰는 별칭으로 subject_tags를 단다(assembleStoryboard 반환형과 같은 모양).
type Board = Storyboard & { subject_tags?: StoredSubjectTag[] };

function stripSubjectTags(board: Board): Board {
  const copy = { ...board };
  delete copy.subject_tags;
  return copy;
}

const FALLBACK_QUESTION: Record<"protagonist" | "supporting", string> = {
  protagonist: PROTAGONIST_QUESTION,
  supporting: SUPPORTING_QUESTION,
};

function normalizeFlowTurn(turn: BrainstormTurn | undefined): BrainstormTurn {
  const question = turn?.question?.trim() ? turn.question : FLOW_QUESTION;
  const valid = [...new Set((turn?.options ?? []).filter((option) => FLOW_OPTIONS.includes(option)))];
  for (const key of FLOW_OPTIONS) {
    if (!valid.includes(key)) valid.push(key);
  }
  return { key: "flow", question, options: valid };
}

// F2 실물 계약(OC-A PR #188, spec-llm-line.md F2절). tone_id 3개 문자열·요청의
// context{industry, interests, cta_format}·응답 fallbackCutIndexes·컷별 재생성
// (같은 경로에 문맥+cut_index) 확정.
// F4(OC-A F2+F4 단일 API, spec-llm-line.md F4절): 응답 directions[]와
// fallbackDirectionCuts를 받아 검증된 연출만 조립된 컷에 적용한다. 컷별 다시
// 뽑기는 그 컷의 대사+연출을 함께 교체한다.
const CAPTIONS_ROUTE = "/api/session/captions";
// 톤 목록은 spec/data/caption-tones.json 단일 출처에서 읽는다.
const CAPTION_TONES = loadCaptionTones();
// #205: 이번 편 목적 후보 — 온보딩(DetailsStep)과 같은 resolveCandidates 기준.
// 프로젝트 기본 목적이 후보 밖이면 맨 앞에 넣어 기본값이 항상 보이게 한다.
function ctaPurposeOptions(preset: Preset): CtaPreset[] {
  const candidates = resolveCandidates(preset.context.interests);
  if (candidates.some((p) => p.id === preset.rules.cta_format)) return candidates;
  const current = getCtaPresetById(preset.rules.cta_format);
  return current ? [current, ...candidates] : candidates;
}

interface CaptionsResponse {
  captions?: Array<{ cut_index?: unknown; text?: unknown }>;
  fallbackCutIndexes?: unknown;
  directions?: unknown;
  fallbackDirectionCuts?: unknown;
}

function promptForCut(subject: string, cut: Cut): string {
  return `${subject} · ${cut.narrative_beat} · ${cut.shot_type}/${cut.camera_angle}`;
}

// issue #143: 저장된 세션 URL로 재진입해도 완성된 4컷이 복원되지 않던 문제.
// asset://를 공개 URL로 바꿔야 <img>에 그릴 수 있다(공용 유틸: ../../asset-url.ts, #144).
async function resolveCutImages(cuts: Cut[]): Promise<Record<number, string>> {
  const entries = await Promise.all(
    cuts.map(async (cut) => {
      if (!cut.generated_image) return null;
      try {
        return [cut.cut_index, await resolveImageUrl(cut.generated_image)] as const;
      } catch {
        return null;
      }
    })
  );
  return Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => e !== null));
}

export default function SessionFlow({ sessionId }: { sessionId: string }) {
  const [step, setStep] = useState<Step>("subject");
  // issue #134: 에디터로 가는 링크가 실제 저장된 세션 id를 알아야 한다.
  // sessionId prop은 저장 전 임시값일 수 있고 저장 후에도 window.history로만
  // URL을 바꿔서 prop 자체는 갱신되지 않는다 — 그래서 저장 결과를 별도로 든다.
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  // issue #143: URL의 sessionId로 이미 저장된 세션이 있으면 처음부터 다시
  // 만들지 않고 그 결과를 그대로 보여준다. checkingExisting이 풀리기 전까지는
  // "subject" 단계를 잠깐이라도 보여주지 않는다(있던 데이터가 순간 안 보이는
  // 깜빡임 방지).
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [isRestoredView, setIsRestoredView] = useState(false);
  const [subject, setSubject] = useState("");
  // 2차 4번: 소재 후보(preset.context 기반 LLM 제안, #181). 후보는 선택지로만 보여주고
  // 자동으로 채택하지 않는다 — 누르면 입력창에 채워져 수정할 수 있다.
  const [subjectSuggestions, setSubjectSuggestions] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [turnIndex, setTurnIndex] = useState(0);
  const [turns, setTurns] = useState<BrainstormTurn[] | null>(null);
  const [turnsError, setTurnsError] = useState<string | null>(null);
  // issue #119-1: 소재에서 이미 파악된 슬롯 — 화면 안내 배너용. 서버가 answers를
  // 대신 채워준 것이라 값 자체는 answers state에도 이미 들어가 있다.
  const [resolvedSlots, setResolvedSlots] = useState<ExtractedSlot[]>([]);
  const [answers, setAnswers] = useState<Partial<Record<BrainstormTurn["key"], string>>>({});
  const [customText, setCustomText] = useState("");
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  // F1: flow 턴에서 허용 키 밖 직접 입력을 거부했을 때 보여줄 안내.
  const [answerError, setAnswerError] = useState<string | null>(null);
  // F2: 대사 생성 직전 방향 선택(톤). 3턴 구조는 유지하고 그 다음에 한 번만 묻는다.
  const [toneId, setToneId] = useState<string | null>(null);
  // #205: 말투와 마무리 화면의 선택값. null이면 프로젝트 기본값(강도는
  // preset.rules.cta_strength ?? "clear", 목적은 rules.cta_format)을 그대로 쓴다.
  const [ctaStrengthChoice, setCtaStrengthChoice] = useState<CtaStrength | null>(null);
  const [ctaPurposeChoice, setCtaPurposeChoice] = useState<string | null>(null);
  // #205: 말투를 고른 순간 확정한 이번 편 CTA. 조립·대사 생성·컷별 다시 뽑기가 같은 값을 쓴다.
  const [sessionCta, setSessionCta] = useState<CtaRequest | undefined>(undefined);
  // F2: 이미지 호출 전 생성 대사의 상태. "idle"이면 captions 단계 진입 시 1회 호출.
  const [captionStatus, setCaptionStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [captionError, setCaptionError] = useState<string | null>(null);
  // F2: 기본 대사로 남은 컷 번호(서버 fallbackCutIndexes 기준). "기본 대사" 표시에 쓴다.
  const [defaultCutIndexes, setDefaultCutIndexes] = useState<number[]>([]);
  const [regenCutIndex, setRegenCutIndex] = useState<number | null>(null);
  const [storyboard, setStoryboard] = useState<Board | null>(null);
  // spec-a3 3-2: 조립 전 태그 단일 출처(브레인스토밍 결과). 조립할 때
  // assembleStoryboard 6번째 인자로 넘기면 storyboard.subject_tags가 된다.
  const [subjectTags, setSubjectTags] = useState<StoredSubjectTag[]>([]);
  // spec-a3 3-2(a): 브레인스토밍 요청마다 올리는 id + 요청 당시 소재. 응답은
  // id가 최신이고 요청 소재가 현재 소재와 같을 때만 태그를 반영한다.
  const requestIdRef = useRef(0);
  // 응답 시점의 현재 소재와 대조한다(클로저의 subject는 요청 시점 값이라 렌더마다 거울에 둔다).
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const [preset, setPreset] = useState<Preset | null>(null);
  const [coverVariants, setCoverVariants] = useState<GeneratedCut[] | null>(null);
  const [coverRequested, setCoverRequested] = useState<number | undefined>(undefined);
  const [cutImageUrls, setCutImageUrls] = useState<Record<number, string>>({});
  const [genError, setGenError] = useState<string | null>(null);
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);
  // 나머지 3컷 체이닝의 진행 상태 — 중간 실패 뒤 "이어서 만들기"가 이미 만든 컷과
  // 다음 컷 체이닝 토큰에서 재개하도록 렌더와 무관하게 들고 있는다(#104).
  const chainRef = useRef<{ storyboard: Board; token: string } | null>(null);
  // #207: 표지 3안을 보여줄 때마다 한 라운드씩 쌓아 두었다가 "저장" 때 selections로
  // 함께 보낸다. 화면에 그리지 않는 기록이라 state가 아니라 ref로 든다.
  const selectionLogRef = useRef<SelectionLog>(createSelectionLog());
  // #207: 세션은 저장됐지만 선택 기록만 실패한 경우(selectionsSaved: false)의 비차단 안내.
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [editingCutIndex, setEditingCutIndex] = useState<number | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // spec-a3 3-3: 400(subject_tags) 복구. saveRecovery가 true면 복구 버튼+안내를
  // 기존 에러 아래에 보여준다. saveLockRef는 원래 저장과 복구를 같은 플래그로
  // 막는다(두 번 클릭·동시 클릭으로 세션 2개 생성 금지 — state가 아니라 동기 잠금).
  const [recovering, setRecovering] = useState(false);
  const [saveRecovery, setSaveRecovery] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const saveLockRef = useRef(false);

  // #259: 4컷을 만드는 중이거나 만든 뒤 저장 전이면, 새로고침·탭 닫기 때 브라우저 확인창을 띄운다.
  // 이미 저장된 세션을 다시 연 화면(isRestoredView)과 저장 완료(saved)는 잃을 것이 없다.
  const hasUnsavedResult = step === "generating" || (step === "cuts" && !isRestoredView);
  useEffect(() => {
    if (!hasUnsavedResult) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedResult]);
  const [presetError, setPresetError] = useState<string | null>(null);

  // issue #123: preset(상의 색 후보 palette 포함)을 브레인스토밍 진행과 병렬로
  // 미리 받아둔다. 원래는 "cover" 단계(loadCoverVariants)에서만 fetch했는데, 그러면
  // storyboard 조립 시점(assembleStoryboard 호출)에 palette 값이 없어서 주인공
  // 상의 색을 세션당 1회로 고정할 수 없었다(#113 케이스 5 — 4컷 내내 색이 흔들림).
  // presetId는 온보딩이 남겨둔 sessionStorage 값이라 마운트 시 바로 조회 가능하다.
  useEffect(() => {
    void loadPreset();
  }, [sessionId]);

  async function loadPreset() {
    const presetId = window.sessionStorage.getItem("cuttoon:preset-id");
    if (!presetId) {
      setPresetError("먼저 온보딩에서 프로젝트를 만들어주세요");
      return;
    }
    try {
      const res = await fetch(`/api/preset?id=${presetId}`);
      if (!res.ok) throw new Error("프리셋을 찾을 수 없습니다");
      const { preset: loaded } = (await res.json()) as { preset: Preset };
      setPreset(loaded);
      setPresetError(null);
    } catch {
      setPresetError("프로젝트 정보를 불러오지 못했어요. 다시 시도해주세요");
    }
  }

  // issue #143: 마운트 시 이 id로 이미 저장된 세션이 있는지 확인한다. 있으면
  // (POST /api/session은 handleSave에서 골든패스 완주 후에만 호출되므로,
  // 저장된 세션은 항상 4컷이 다 채워진 상태다) 그 storyboard로 상태를 채우고
  // "cuts" 단계로 바로 보여준다 — 처음부터 다시 만들지 않는다.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/session?id=${encodeURIComponent(sessionId)}`);
        if (cancelled) return;
        if (!res.ok) return; // 없으면(404 등) 새로 만드는 골든패스를 그대로 둔다.

        const data = await res.json();
        if (cancelled) return;

        // spec-a3 3-2(e): 재진입은 저장본 자체를 정규화해 상태와 저장본을 같은
        // 값으로 둔다. 태그가 깨졌으면 storyboard에 subject_tags 키 없이 둔다.
        const restored = data.storyboard as Board;
        const reentry = normalizeStoredSubjectTags(restored.subject_tags, restored.subject);
        const normalized: Board =
          reentry.tags.length > 0
            ? { ...restored, subject_tags: reentry.tags }
            : stripSubjectTags(restored);
        const urls = await resolveCutImages(normalized.cuts);
        if (cancelled) return;

        setStoryboard(normalized);
        setSubjectTags(reentry.tags);
        setSubject(normalized.subject);
        setCutImageUrls(urls);
        setSavedSessionId(sessionId);
        setIsRestoredView(true);
        setStep("cuts");
      } catch {
        // 조회 자체가 실패해도 골든패스를 막지 않는다 — 새로 시작하는 것과 같다.
      } finally {
        if (!cancelled) setCheckingExisting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  function recordAnswer(value: string) {
    if (!turns) return;
    const key = turns[turnIndex].key;
    // F1: flow 직접 입력은 정규화 후 허용 키만 받는다. 자유 입력 값은 조립 전에
    // 거부한다 — 남기면 assembleStoryboard 의 기본 흐름 폴백이 조용히 타 어떤
    // 흐름을 골라도 같은 4컷이 나온다.
    if (key === "flow" && !FLOW_OPTIONS.includes(value)) {
      setAnswerError("흐름은 제시된 선택지 중에서 골라주세요");
      return;
    }
    setAnswerError(null);
    const next = { ...answers, [key]: value };
    setAnswers(next);
    setIsCustomOpen(false);
    setCustomText("");

    if (turnIndex < turns.length - 1) {
      setTurnIndex(turnIndex + 1);
    } else {
      // F2: 3턴을 마치면 바로 조립하지 않고 톤(말투 방향)을 먼저 고른다.
      setStep("tone");
    }
  }

  // #205: 화면에 보이는 강도 — 사용자가 고르지 않았으면 프로젝트 기본값.
  const ctaStrength: CtaStrength = ctaStrengthChoice ?? preset?.rules.cta_strength ?? "clear";

  function handleSelectTone(id: string) {
    if (!preset) return;
    setToneId(id);
    // 사용자가 고른 강도를 보정 없이 보낸다. none이면 목적은 보내지 않는다(#205 화면 계약).
    setSessionCta(
      ctaStrength === "none"
        ? { strength: "none" }
        : { strength: ctaStrength, purpose_id: ctaPurposeChoice }
    );
    setCaptionStatus("idle");
    setCaptionError(null);
    setDefaultCutIndexes([]);
    setStep("assembling");
  }

  // 소재에 맞는 선택지를 실제 LLM 으로 받아온다 (issue #84). 이전에는 화면 안의
  // 하드코딩 상수(BRAINSTORM_TURNS)를 썼다.
  //
  // issue #119-1: draft는 여전히 클라이언트가 만들어 보내지 않는다 — 이 시점엔
  // 답변이 하나도 없다. 대신 서버(/api/brainstorm)가 subject만으로 자체 추출해서
  // 이미 파악된 슬롯을 resolved로 함께 돌려준다. 그 값으로 answers를 미리 채우면
  // generateBrainstormTurns가 이미 걸러낸 턴 배열(남은 것만)과 answers가 맞아
  // 떨어진다 — PRD 6절 "소재에 이미 정보가 있으면 해당 턴은 건너뛴다"가 여기서
  // 실현된다.
  // 여기서 setTurnsError(null) 로 시작하지 않는다 — effect 가 이 함수를 부르는
  // 경로에서 동기 setState 가 되어 cascading render 를 만든다
  // (react-hooks/set-state-in-effect). 초기화는 재시도 버튼 쪽에서 한다.
  // spec-a3 3-2(b): 소재 변경은 이 함수 하나로 — 태그 비움 + 진행 중 요청의
  // 태그 반영 무효화. 입력 onChange와 후보 onClick이 함께 쓴다.
  function changeSubject(next: string) {
    setSubject(next);
    setSubjectTags([]);
    requestIdRef.current += 1;
  }

  async function loadTurns() {
    const trimmed = subject.trim();
    // 소재가 없으면 라우트가 400 을 준다 — 부르기 전에 끊는다. "다음" 버튼이
    // 빈 소재를 막고 있어 실제로는 도달하지 않는다.
    if (!trimmed) return;
    // spec-a3 3-2(a): 요청 id와 요청 당시 소재를 기록한다. 요청 body에는 태그 없음.
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const requestSubject = trimmed;

    try {
      const res = await fetch("/api/brainstorm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: trimmed,
          // #150: 마스코트가 있으면 서버가 조연 첫 후보로 넣는다(없으면 키 생략).
          context: {
            industry: preset?.context.industry ?? [],
            ...(preset?.mascot ? { mascot: preset.mascot } : {}),
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "선택지를 만들지 못했습니다");
      }
      const { turns: loaded, resolved, subjectTags: responseTags } = (await res.json()) as {
        turns: BrainstormTurn[];
        resolved?: ExtractedSlot[];
        subjectTags?: unknown;
      };
      if (!Array.isArray(loaded) || loaded.length === 0) {
        throw new Error("선택지가 비어 있습니다");
      }
      if (resolved && resolved.length > 0) {
        setAnswers((prev) => {
          const next = { ...prev };
          for (const slot of resolved) next[slot.key] = slot.value;
          return next;
        });
        setResolvedSlots(resolved);
      }
      setTurns(normalizeTurns(loaded));
      // spec-a3 3-2(a): id가 최신이고 요청 소재가 현재 소재와 같을 때만 태그 반영.
      // turns 등 기존 반영 조건은 현행 유지 — 태그 반영만 이 조건을 탄다.
      if (requestId === requestIdRef.current && requestSubject === subjectRef.current) {
        setSubjectTags(normalizeStoredSubjectTags(responseTags, requestSubject).tags);
      }
    } catch {
      setTurnsError("선택지를 만드는 데 실패했어요. 다시 시도해주세요");
    }
  }

  // 소재를 확정하는 사용자 액션에서 바로 요청을 띄운다. effect 로 옮기면
  // cascading render 가 되고(react-hooks/set-state-in-effect), 이 요청은 화면
  // 진입이 아니라 "다음" 클릭이라는 이벤트에 속한 일이다.
  // "알아서 해줘"(다시 뽑기 포함) — 횟수 제한 없이 새 후보 3개를 받는다. 실패해도
  // 입력창은 그대로 쓸 수 있고, 이전 후보는 지우지 않는다.
  async function handleSuggestSubjects() {
    if (!preset || suggesting) return;
    const presetId = window.sessionStorage.getItem("cuttoon:preset-id");
    if (!presetId) {
      setSuggestError("먼저 온보딩에서 프로젝트를 만들어주세요");
      return;
    }
    setSuggesting(true);
    setSuggestError(null);
    try {
      setSubjectSuggestions(await fetchSubjectSuggestions(presetId));
    } catch {
      setSuggestError("소재 후보를 만드는 데 실패했어요. 다시 시도하거나 직접 적어주세요");
    } finally {
      setSuggesting(false);
    }
  }

  function startBrainstorm() {
    setStep("brainstorm");
    void loadTurns();
  }

  useEffect(() => {
    if (step !== "assembling") return;
    // preset(palette)이 아직 안 왔으면 기다린다 — 도착하면 이 effect가 preset을
    // 의존성으로 다시 실행된다. presetError가 나면 아래 렌더링이 재시도를 보여준다.
    if (!preset) return;

    const full: BrainstormAnswers = {
      protagonist: answers.protagonist ?? "",
      supporting:
        answers.supporting && answers.supporting !== NO_SUPPORTING_OPTION
          ? answers.supporting
          : null,
      flow: answers.flow ?? "",
    };

    const timer = setTimeout(() => {
      // #150: 마스코트는 4번째 인자로만 넘긴다 — 조연 답변이 마스코트 후보면
      // cast의 조연 character_id가 mascot.label이 된다. 5번째는 #205 CTA.
      // spec-a3 3-2(c): 6번째는 조립 전 단일 출처 subjectTags. 비면 필드 생략(조립 함수 내).
      setStoryboard(
        assembleStoryboard(subject, full, preset.style.palette, preset.mascot, sessionCta, subjectTags)
      );
      // F2: 조립된 기본 대사를 먼저 보여주고 이미지 호출 전에 생성 대사로 바꾼다.
      setStep("captions");
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, preset]);

  useEffect(() => {
    if (step !== "captions" || !storyboard || !preset || !toneId) return;
    if (captionStatus !== "idle") return;
    void loadCaptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, storyboard, captionStatus]);

  // F2: 이미지 호출 전에 생성 대사를 받아 편집 화면에 둔다. preset 전체나
  // 이미지·비밀값은 넘기지 않는다(spec-llm-line.md F2절, OC-A PR #188).
  async function loadCaptions() {
    if (!storyboard || !preset || !toneId) return;
    setCaptionStatus("loading");
    setCaptionError(null);

    // spec-a3 3-2(d): 조립 후 단일 출처는 storyboard.subject_tags. 대사 body를
    // 별도 상태에서 만들지 않는다. 태그가 비면 키를 뺀다.
    const tags = storyboard.subject_tags ?? [];
    try {
      const res = await fetch(CAPTIONS_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          flow: answers.flow ?? "",
          beats: storyboard.cuts.map((cut) => cut.narrative_beat),
          cast: storyboard.cast.map((member) => member.description),
          tone_id: toneId,
          context: {
            industry: preset.context.industry,
            interests: preset.context.interests,
            cta_format: preset.rules.cta_format,
          },
          ...supportingIdField(storyboard),
          // #205: 조립에 쓴 것과 같은 cta. 빠지면 서버가 clear로 보고 none 4컷에 400을 낸다.
          cta: sessionCta,
          ...(tags.length > 0 ? { subject_tags: tags } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "대사를 만들지 못했습니다");
      }
      const data = (await res.json()) as CaptionsResponse;
      applyCaptions(
        data.captions,
        storyboard.cuts.map((cut) => cut.cut_index),
        data.fallbackCutIndexes
      );
      // F4: 검증된 연출만 조립된 컷에 적용한다. 생략·무효·fallback 목록의 컷은
      // 조립 기본값이 그대로 남는다.
      applyDirections(data.directions, data.fallbackDirectionCuts);
      setCaptionStatus("ready");
    } catch {
      setCaptionError("대사를 만드는 데 실패했어요. 다시 시도해주세요");
      setCaptionStatus("error");
    }
  }

  // F2: 컷 인덱스 1~4별 유효 문자열만 채택한다. 기본 대사 표시는 서버의
  // fallbackCutIndexes를 쓰고, 없을 때만 유효 대사를 못 받은 컷으로 본다.
  // 다른 컷의 유효 대사·사용자 편집은 건드리지 않는다.
  function applyCaptions(
    list: CaptionsResponse["captions"],
    cutIndexes: number[],
    fallback: CaptionsResponse["fallbackCutIndexes"]
  ) {
    const valid = new Map<number, string>();
    const validSpeakerIndex = new Map<number, unknown>(); // setCaptionSpeaker speaker source per cut
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (typeof entry !== "object" || entry === null) continue;
        const { cut_index, text } = entry as Record<string, unknown>;
        if (
          typeof cut_index === "number" &&
          Number.isInteger(cut_index) &&
          cut_index >= 1 &&
          cut_index <= 4 &&
          typeof text === "string" &&
          text.trim().length > 0
        ) {
          valid.set(cut_index, text);
          validSpeakerIndex.set(cut_index, (entry as Record<string, unknown>).speaker); // setCaptionSpeaker
        }
      }
    }
    setStoryboard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cuts: prev.cuts.map((cut) =>
          valid.has(cut.cut_index)
            ? setCaptionSpeaker({ ...cut, caption: { ...cut.caption, text: valid.get(cut.cut_index) as string } }, typeof validSpeakerIndex.get(cut.cut_index) === "string" ? (validSpeakerIndex.get(cut.cut_index) as string) : undefined) // setCaptionSpeaker speaker_index
            : cut
        ),
      };
    });
    setDefaultCutIndexes(
      Array.isArray(fallback)
        ? fallback.filter((n): n is number => typeof n === "number")
        : cutIndexes.filter((n) => !valid.has(n))
    );
  }

  // F4: 서버 연출안을 조립된 컷에 반영한다. 검증·기본값 유지는
  // applyCutDirections(storyboard-assembly.ts)가 맡는다.
  function applyDirections(directions: unknown, fallbackCuts: unknown) {
    setStoryboard((prev) => {
      if (!prev) return prev;
      return { ...prev, cuts: applyCutDirections(prev.cuts, directions, fallbackCuts) };
    });
  }

  // F2: 컷별 다시 뽑기 — 같은 경로에 문맥과 cut_index를 함께 보내 그 컷의
  // 대사+연출을 함께 교체한다(F4). 다른 컷의 대사·연출·사용자 편집은 보존한다.
  async function regenCutCaption(cutIndex: number) {
    if (!storyboard || !preset || !toneId) return;
    setRegenCutIndex(cutIndex);
    // spec-a3 3-2(d): 다시 뽑기도 같은 단일 출처. 재진입 후 진행 문맥(toneId 등)
    // 미복원은 범위 밖이라 현행대로 toneId 없으면 반환한다.
    const tags = storyboard.subject_tags ?? [];
    try {
      const res = await fetch(CAPTIONS_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          flow: answers.flow ?? "",
          beats: storyboard.cuts.map((cut) => cut.narrative_beat),
          cast: storyboard.cast.map((member) => member.description),
          tone_id: toneId,
          context: {
            industry: preset.context.industry,
            interests: preset.context.interests,
            cta_format: preset.rules.cta_format,
          },
          ...supportingIdField(storyboard),
          cta: sessionCta,
          ...(tags.length > 0 ? { subject_tags: tags } : {}),
          cut_index: cutIndex,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "대사를 다시 뽑지 못했습니다");
      }
      const data = (await res.json()) as CaptionsResponse;
      const list = data.captions;
      const entry = Array.isArray(list)
        ? list.find(
            (item): item is { cut_index: number; text: string } =>
              typeof item === "object" &&
              item !== null &&
              (item as Record<string, unknown>).cut_index === cutIndex &&
              typeof (item as Record<string, unknown>).text === "string" &&
              ((item as Record<string, unknown>).text as string).trim().length > 0
          )
        : undefined;
      if (!entry) throw new Error("대사를 다시 뽑지 못했습니다");
      const text = entry.text;
      const directions = data.directions;
      const directionFallback = data.fallbackDirectionCuts;
      setStoryboard((prev) => {
        if (!prev) return prev;
        const withCaption = prev.cuts.map((cut) =>
          cut.cut_index === cutIndex ? setCaptionSpeaker({ ...cut, caption: { ...cut.caption, text } }, typeof (entry as Record<string, unknown>).speaker === "string" ? ((entry as Record<string, unknown>).speaker as string) : undefined) : cut // setCaptionSpeaker speaker_index
        );
        return { ...prev, cuts: applyCutDirections(withCaption, directions, directionFallback) };
      });
      const fellBack =
        Array.isArray(data.fallbackCutIndexes) && data.fallbackCutIndexes.includes(cutIndex);
      setDefaultCutIndexes((prev) => {
        const next = prev.filter((n) => n !== cutIndex);
        if (fellBack) next.push(cutIndex);
        return next;
      });
    } catch {
      setCaptionError("그 컷 대사를 다시 뽑지 못했어요. 다시 시도해주세요");
    } finally {
      setRegenCutIndex(null);
    }
  }

  function updateCaptionAndClearDefault(index: number, text: string) {
    updateCaption(index, text);
    const cutIndex = storyboard?.cuts[index]?.cut_index;
    if (cutIndex != null) setDefaultCutIndexes((prev) => prev.filter((n) => n !== cutIndex));
  }

  // #207: 비차단 안내는 몇 초 뒤 스스로 사라진다(닫기 버튼으로 먼저 닫을 수도 있다).
  useEffect(() => {
    if (!selectionNotice) return;
    const timer = window.setTimeout(() => setSelectionNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [selectionNotice]);

  useEffect(() => {
    if (step !== "cover" || !storyboard || coverVariants) return;
    void loadCoverVariants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, storyboard]);

  async function loadCoverVariants() {
    // preset은 assembling effect가 "cover"로 넘어가기 전에 이미 기다렸으므로
    // 이 시점엔 항상 준비돼 있다 — 여기서 다시 fetch하지 않는다(issue #123).
    if (!storyboard || !preset) return;
    setGenError(null);

    try {
      const { variants, requested } = await generateCoverVariants(storyboard, preset);
      setCoverVariants(variants);
      setCoverRequested(requested);
      selectionLogRef.current = recordRound(selectionLogRef.current, variants, requested ?? variants.length);
    } catch {
      setGenError("표지를 만드는 데 실패했어요. 다시 시도해주세요");
    }
  }

  async function handleSelectCover(variant: GeneratedCut, index: number) {
    if (!storyboard || !preset) return;
    selectionLogRef.current = markSelected(selectionLogRef.current, index);
    const firstCutIndex = storyboard.cuts[0].cut_index;
    const updated: Board = {
      ...storyboard,
      cuts: storyboard.cuts.map((cut, i) =>
        i === 0
          ? { ...cut, generated_image: variant.asset, prompt_used: promptForCut(storyboard.subject, cut) }
          : cut
      ),
    };
    setStoryboard(updated);
    setCutImageUrls((prev) => ({ ...prev, [firstCutIndex]: variant.image }));
    void runChainedCuts(updated, variant.continuationToken ?? "");
  }

  // 컷이 하나 끝날 때마다 storyboard·이미지 URL을 바로 반영한다. 다음 컷이 실패해도
  // 이미 유료로 만든 컷이 화면 상태에 남고, 재시도는 첫 미생성 컷부터 이어진다.
  async function runChainedCuts(startStoryboard: Board, token: string) {
    if (!preset) return;
    chainRef.current = { storyboard: startStoryboard, token };
    setStep("generating");
    setGenError(null);
    setGenProgress(null);

    try {
      await generateChainedCuts(startStoryboard, preset, token, {
        onProgress: (done, total) => setGenProgress({ done, total }),
        onCut: (i, generated) => {
          const chain = chainRef.current;
          if (!chain) return;
          const cuts = chain.storyboard.cuts.map((cut, idx) =>
            idx === i
              ? {
                  ...cut,
                  generated_image: generated.asset,
                  prompt_used: promptForCut(chain.storyboard.subject, cut),
                }
              : cut
          );
          chainRef.current = {
            storyboard: { ...chain.storyboard, cuts },
            token: generated.continuationToken ?? chain.token,
          };
          setStoryboard(chainRef.current.storyboard);
          setCutImageUrls((prev) => ({ ...prev, [cuts[i].cut_index]: generated.image }));
        },
      });
      setStep("cuts");
    } catch {
      // step은 generating에 둔다 — 표지로 돌아가면 만든 컷이 버려진다.
      // chainRef는 메모리 상태라 새로고침·탭 닫기 시 사라진다 — 문구에 그 한계를 밝힌다.
      setGenError(
        "나머지 컷 생성에 실패했어요. 이미 만든 컷은 이 화면을 닫거나 새로고침하기 전까지만 보관돼요. 창을 닫지 말고 '이어서 만들기'를 눌러주세요"
      );
    }
  }

  function updateCaption(index: number, text: string) {
    setStoryboard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cuts: prev.cuts.map((cut, i) =>
          i === index ? { ...cut, caption: { ...cut.caption, text } } : cut
        ),
      };
    });
  }

  async function handleSave() {
    if (!storyboard) return;

    try {
      // #205: 강도를 함께 넘겨야 none(CTA 컷 0개)이 기존 규칙(CTA 1개)에 막히지 않는다.
      assertStoryboardRuntimeInvariants(storyboard.cuts, storyboard.cta_strength);
    } catch {
      setSaveError("컷 구성에 문제가 있어요. 처음부터 다시 시도해주세요");
      return;
    }

    // 온보딩(POST /api/preset)이 남겨둔 값 — 세션 생성에 둘 다 필요하다 (issue #41).
    const projectId = window.sessionStorage.getItem("cuttoon:project-id");
    const presetId = window.sessionStorage.getItem("cuttoon:preset-id");
    if (!projectId || !presetId) {
      setSaveError("먼저 온보딩에서 프로젝트를 만들어주세요");
      return;
    }

    // spec-a3 3-3: 동기 잠금 — 복구 버튼과 같은 플래그를 쓴다.
    if (saveLockRef.current) return;
    saveLockRef.current = true;
    setSaveError(null);
    setSaveRecovery(false);
    setSaving(true);
    const selections = toPayload(selectionLogRef.current);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 닫힌 라운드가 없으면(표지 기록 없음) 키를 빼 기존 응답 형태를 유지한다.
        body: JSON.stringify({
          projectId,
          presetId,
          storyboard,
          ...(selections.length > 0 ? { selections } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // spec-a3 3-3: HTTP 400이고 error가 "subject_tags"로 시작할 때만 복구 버튼.
        // #260: 이때 서버 메시지(영문 필드명 포함)는 화면에 보이지 않고 콘솔에만 남긴다.
        if (res.status === 400 && typeof body?.error === "string" && body.error.startsWith("subject_tags")) {
          console.warn(body.error);
          setSaveError("소재 태그를 저장하지 못했어요");
          setSaveRecovery(true);
        } else {
          setSaveError(body?.error ?? "저장에 실패했어요. 다시 시도해주세요");
        }
        return;
      }

      const { sessionId: savedId, selectionsSaved } = (await res.json()) as {
        sessionId: string;
        selectionsSaved?: boolean;
      };
      // #207: 선택 기록만 실패해도 세션은 저장됐다 — 흐름을 막지 않고 알리기만 한다.
      if (selectionsSaved === false) {
        setSelectionNotice("선택 기록은 저장되지 않았어요. 컷툰은 정상 저장됐습니다.");
      }
      // URL의 id는 세션이 생기기 전 임시값이었을 수 있으니 실제 id로 맞춘다 —
      // 에디터 화면이 이 id로 세션을 조회한다. history API로 바꾸는 이유는
      // useRouter().replace()가 이 라우트를 다시 서버에서 그려서 컴포넌트를
      // 리마운트시키고 "저장됨" 화면을 보여주기 전에 상태를 초기화해버리기 때문.
      if (savedId !== sessionId) {
        window.history.replaceState(null, "", `/session/${savedId}`);
      }
      setSavedSessionId(savedId);
      setSaveNotice(null);
      setStep("saved");
    } catch {
      setSaveError("저장에 실패했어요. 다시 시도해주세요");
    } finally {
      setSaving(false);
      saveLockRef.current = false;
    }
  }

  // spec-a3 3-3: "소재 태그 없이 저장" 복구. 요청 본문은 현재 storyboard에서
  // subject_tags 키를 뺀 사본이고 화면 상태는 아직 바꾸지 않는다. 실패하면 원본
  // 유지·에러 표시·버튼 재사용, 성공할 때만 사본으로 교체한다.
  async function handleRecoverSave() {
    if (!storyboard || saveLockRef.current) return;
    saveLockRef.current = true;
    setRecovering(true);
    setSaveError(null);
    try {
      const stripped = stripSubjectTags(storyboard);
      const projectId = window.sessionStorage.getItem("cuttoon:project-id");
      const presetId = window.sessionStorage.getItem("cuttoon:preset-id");
      if (!projectId || !presetId) {
        setSaveError("먼저 온보딩에서 프로젝트를 만들어주세요");
        return;
      }
      const selections = toPayload(selectionLogRef.current);
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          presetId,
          storyboard: stripped,
          ...(selections.length > 0 ? { selections } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setSaveError(body?.error ?? "저장에 실패했어요. 다시 시도해주세요");
        return;
      }

      const { sessionId: savedId, selectionsSaved } = (await res.json()) as {
        sessionId: string;
        selectionsSaved?: boolean;
      };
      if (selectionsSaved === false) {
        setSelectionNotice("선택 기록은 저장되지 않았어요. 컷툰은 정상 저장됐습니다.");
      }
      if (savedId !== sessionId) {
        window.history.replaceState(null, "", `/session/${savedId}`);
      }
      setSavedSessionId(savedId);
      setStoryboard(stripped);
      setSubjectTags([]);
      setSaveRecovery(false);
      setSaveNotice("소재 태그 매핑 없이 저장했어요");
      setStep("saved");
    } catch {
      setSaveError("저장에 실패했어요. 다시 시도해주세요");
    } finally {
      setRecovering(false);
      saveLockRef.current = false;
    }
  }

  if (checkingExisting) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-700" />
        <p className="text-sm text-zinc-500">불러오는 중...</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      {/* issue #123: preset을 마운트 시점에 미리 받는데, 그 실패는 storyboard가
          조립되기 전(subject·brainstorm·assembling 단계 전부) 어디서든 보여줘야
          한다 — assembling까지 3턴을 다 진행한 뒤에야 알리면 너무 늦다.
          checkingExisting은 위에서 이미 걸러졌고, storyboard가 있으면(복원된
          세션이거나 이미 조립됐으면) preset 문제와 무관하니 띄우지 않는다. */}
      {presetError && !storyboard && (
        <div className="flex w-full max-w-xl flex-col items-center gap-3 rounded-md bg-red-50 px-4 py-3 text-center">
          <p className="text-sm text-red-600">{presetError}</p>
          <button
            type="button"
            onClick={() => void loadPreset()}
            className="rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700"
          >
            다시 시도
          </button>
        </div>
      )}

      {step === "subject" && (
        <div className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-semibold">이번엔 어떤 이야기를 만들어볼까요?</h1>
          <p className="text-sm text-zinc-500">
            이 컷툰 한 편의 실제 소재를 한 줄로 적어주세요
          </p>
          {/* spec-a3 3-5: 선택 사항 + 가상 실명 예시. 새 입력 요소 없음. */}
          <p className="text-sm text-zinc-500">
            브랜드나 제품명을 넣으려면 실제 이름을 [대괄호]로 감싸 주세요. 예: [별빛핏]으로 운동 시작
          </p>
          <input
            value={subject}
            onChange={(e) => changeSubject(e.target.value)}
            placeholder="예: 무릎 연골 나감"
            className="w-full rounded-md border border-zinc-300 px-4 py-3 text-sm"
          />

          {preset && !hasSuggestionContext(preset) ? (
            <p className="text-sm text-zinc-500">{EMPTY_CONTEXT_HINT}</p>
          ) : null}
          <button
            type="button"
            disabled={!preset || !hasSuggestionContext(preset) || suggesting}
            onClick={() => void handleSuggestSubjects()}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
          >
            {suggesting ? "소재를 찾고 있어요..." : subjectSuggestions ? "다시 뽑기" : "알아서 해줘"}
          </button>

          {suggestError && (
            <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{suggestError}</p>
          )}

          {subjectSuggestions && (
            <div className="flex w-full flex-col gap-2">
              {subjectSuggestions.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => changeSubject(candidate)}
                  className={`rounded-md border px-4 py-2.5 text-left text-sm hover:bg-zinc-50 ${
                    subject === candidate ? "border-zinc-900 bg-zinc-50" : "border-zinc-300"
                  }`}
                >
                  {candidate}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            disabled={subject.trim().length === 0}
            onClick={startBrainstorm}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {step === "brainstorm" && !turns && !turnsError && (
        <Spinner text="소재에 맞는 선택지를 고르고 있어요..." />
      )}

      {step === "brainstorm" && turnsError && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-red-600">{turnsError}</p>
          <button
            type="button"
            onClick={() => {
              setTurnsError(null);
              void loadTurns();
            }}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            다시 시도
          </button>
        </div>
      )}

      {step === "brainstorm" && turns && (
        <div className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
          {/* issue #119-1: 소재에서 이미 파악된 슬롯이 있으면 알려준다 — 3턴이
              갑자기 줄어든 이유를 사용자가 알 수 있게. */}
          {resolvedSlots.length > 0 && (
            <div className="w-full rounded-md bg-zinc-50 px-4 py-2 text-left text-xs text-zinc-500">
              <p>소재에서 몇 가지는 이미 파악했어요</p>
              <ul className="mt-1 list-disc pl-4">
                {resolvedSlots.map((slot) => (
                  <li key={slot.key}>
                    {slot.key === "protagonist" ? "주인공" : "조연"}: {slot.value}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-zinc-400">
            {turnIndex + 1} / {turns.length}
          </p>
          <h1 className="text-xl font-semibold">{turns[turnIndex].question}</h1>

          <div className="flex w-full flex-col gap-2">
            {turns[turnIndex].options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => recordAnswer(option)}
                className="rounded-md border border-zinc-300 px-4 py-2.5 text-sm hover:bg-zinc-50"
              >
                {/* #205: "→ CTA"는 "→ 마무리"로 보여주기만 하고, 보내는 값은 원래 키 그대로. */}
                {displayFlowLabel(option)}
              </button>
            ))}
          </div>

          {answerError && (
            <p className="w-full rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
              {answerError}
            </p>
          )}
          {isCustomOpen ? (
            <div className="flex w-full gap-2">
              <input
                autoFocus
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={customText.trim().length === 0}
                onClick={() => recordAnswer(customText.trim())}
                className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                확인
              </button>
            </div>
          ) : (
            <div className="flex gap-2 text-sm">
              {/* F1 선택 제안: flow 턴은 허용 키만 받으므로 직접 입력을 숨긴다(통합 WIP 436ae7b hunk). */}
              {turns[turnIndex].key !== "flow" && (
                <button
                  type="button"
                  onClick={() => setIsCustomOpen(true)}
                  className="rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-zinc-600 hover:bg-zinc-50"
                >
                  직접 쓸게
                </button>
              )}
              {/* spec-a3 3-6: "알아서 해줘"는 선택지 개수와 무관하게 렌더한다.
                  선택지가 있으면 options[0], 빈 턴이면 autoAnswer 결정값. */}
              <button
                type="button"
                onClick={() =>
                  recordAnswer(
                    autoAnswer(turns[turnIndex], {
                      mascot: preset?.mascot ?? undefined,
                      context: preset?.context ?? undefined,
                    })
                  )
                }
                className="rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-zinc-500 hover:bg-zinc-50"
              >
                알아서 해줘
              </button>
            </div>
          )}
        </div>
      )}

      {step === "tone" && (
        <div className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-semibold">말투와 마무리를 골라주세요</h1>

          {/* #205: 마무리 강도·이번 편 목적은 기본값이 채워져 있어 말투만 눌러도 넘어간다. */}
          <div className="flex w-full flex-col gap-4 rounded-md border border-zinc-200 px-4 py-3 text-left">
            <div className="flex flex-col gap-1">
              <label htmlFor="cta-strength" className="text-sm font-medium">
                마무리 강도
              </label>
              <input
                id="cta-strength"
                type="range"
                min={0}
                max={CTA_STRENGTHS.length - 1}
                step={1}
                value={CTA_STRENGTHS.findIndex((s) => s.id === ctaStrength)}
                onChange={(e) => setCtaStrengthChoice(CTA_STRENGTHS[Number(e.target.value)].id)}
                aria-valuetext={CTA_STRENGTHS.find((s) => s.id === ctaStrength)?.label}
                className="w-full"
              />
              <div className="flex justify-between text-xs">
                {CTA_STRENGTHS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setCtaStrengthChoice(s.id)}
                    className={s.id === ctaStrength ? "font-semibold text-zinc-900" : "text-zinc-400"}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="cta-purpose" className="text-sm font-medium">
                이번 편 목적
              </label>
              <select
                id="cta-purpose"
                disabled={!preset || ctaStrength === "none"}
                value={ctaPurposeChoice ?? preset?.rules.cta_format ?? ""}
                onChange={(e) =>
                  // 프로젝트 기본 목적으로 되돌리면 null(= 프로젝트 기본)로 둔다.
                  setCtaPurposeChoice(
                    e.target.value === preset?.rules.cta_format ? null : e.target.value
                  )
                }
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-40"
              >
                {preset &&
                  ctaPurposeOptions(preset).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </select>
              {ctaStrength === "none" && (
                <p className="text-xs text-zinc-400">이야기만으로 끝내서 목적은 쓰지 않아요</p>
              )}
            </div>
          </div>

          <p className="w-full text-left text-sm font-medium">말투</p>
          {/* #223 리뷰 제안 1: 프로젝트 정보 전에 말투를 누르면 강도가 기본값("clear")으로
              굳으므로, 도착할 때까지 막는다. 불러오기 실패는 위 presetError 안내가 맡는다. */}
          {!preset && !presetError && (
            <p className="w-full text-left text-xs text-zinc-400">프로젝트 정보를 불러오는 중이에요</p>
          )}
          <div className="flex w-full flex-col gap-2">
            {CAPTION_TONES.map((tone) => (
              <button
                key={tone.id}
                type="button"
                disabled={!preset}
                onClick={() => handleSelectTone(tone.id)}
                className="rounded-md border border-zinc-300 px-4 py-2.5 text-sm hover:bg-zinc-50 disabled:opacity-40"
              >
                {tone.label}
              </button>
            ))}
          </div>
          {/* #186 지적 5(캡틴 확정): 톤 단계 알아서 해줘는 공감형(empathy) 고정 적용(통합 WIP 436ae7b hunk). */}
          <button
            type="button"
            disabled={!preset}
            onClick={() => handleSelectTone("empathy")}
            className="rounded-md border border-dashed border-zinc-300 px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
          >
            알아서 해줘
          </button>
        </div>
      )}

      {step === "assembling" && !presetError && <Spinner text="이야기를 엮고 있어요..." />}

      {step === "captions" && storyboard && (
        <div className="flex w-full max-w-2xl flex-col items-center gap-4">
          <h1 className="text-xl font-semibold">대사를 확인하고 다듬어주세요</h1>
          {captionStatus === "loading" && <Spinner text="대사를 만들고 있어요..." />}
          {captionError && (
            <div className="flex w-full flex-col items-center gap-3 rounded-md bg-red-50 px-4 py-3 text-center">
              <p className="text-sm text-red-600">{captionError}</p>
              <button
                type="button"
                onClick={() => setCaptionStatus("idle")}
                className="rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700"
              >
                다시 시도
              </button>
            </div>
          )}
          {captionStatus !== "loading" && (
            <>
              <div className="flex w-full flex-col gap-3">
                {storyboard.cuts.map((cut, i) => (
                  <div
                    key={cut.cut_index}
                    className="flex w-full flex-col gap-2 rounded-lg border border-zinc-200 p-3"
                  >
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span>
                        {cut.cut_index}컷 · {beatLabel(cut.narrative_beat)}
                      </span>
                      {defaultCutIndexes.includes(cut.cut_index) && (
                        <span className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-600">
                          생성 실패 — 기본 대사
                        </span>
                      )}
                    </div>
                    <div className="flex w-full gap-2">
                      <input
                        value={cut.caption.text}
                        onChange={(e) => updateCaptionAndClearDefault(i, e.target.value)}
                        className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        disabled={regenCutIndex === cut.cut_index}
                        onClick={() => void regenCutCaption(cut.cut_index)}
                        className="shrink-0 rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40"
                      >
                        {regenCutIndex === cut.cut_index ? "뽑는 중…" : "다시 뽑기"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                disabled={regenCutIndex !== null}
                onClick={() => setStep("cover")}
                className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
              >
                이 대사로 그림 만들기
              </button>
            </>
          )}
        </div>
      )}
      {step === "cover" && !coverVariants && !genError && <Spinner text="표지 3안을 그리고 있어요..." />}
      {step === "generating" && !genError && (
        <Spinner
          text={
            genProgress
              ? `나머지 컷을 완성하고 있어요... (${genProgress.done}/${genProgress.total})`
              : "나머지 컷을 완성하고 있어요..."
          }
          progress={genProgress}
        />
      )}

      {(step === "cover" || step === "generating") && genError && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{genError}</p>
          <button
            type="button"
            onClick={() => {
              if (step === "generating" && chainRef.current) {
                void runChainedCuts(chainRef.current.storyboard, chainRef.current.token);
                return;
              }
              setGenError(null);
              setCoverVariants(null);
              setCoverRequested(undefined);
              setStep("cover");
              void loadCoverVariants();
            }}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            {step === "generating" ? "이어서 만들기" : "다시 시도"}
          </button>
        </div>
      )}

      {step === "cover" && coverVariants && storyboard && !genError && (
        <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
          <h1 className="text-xl font-semibold">마음에 드는 표지를 골라주세요</h1>
          {/* #259 4번: 카드 자체가 버튼이고 확인 단계가 없다 — 누르면 바로 나머지 컷 생성이 시작되는 것을 미리 알린다. */}
          <p className="text-sm text-zinc-500">표지를 누르면 바로 나머지 컷을 만들기 시작해요</p>
          {coverRequested != null && coverVariants.length < coverRequested && (
            <p className="w-full max-w-md rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-700">
              {coverRequested}안 중 {coverVariants.length}안만 만들어졌어요. 다시 뽑기를 눌러보세요
            </p>
          )}
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
            {coverVariants.map((variant, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelectCover(variant, i)}
                className="overflow-hidden rounded-lg border border-zinc-200 hover:border-zinc-900"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- mock placeholder, next/image 불필요 */}
                <img src={variant.image} alt={`표지 안 ${i + 1}`} className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              selectionLogRef.current = markRegenerated(selectionLogRef.current);
              setCoverVariants(null);
              setCoverRequested(undefined);
              void loadCoverVariants();
            }}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            다시 뽑기
          </button>
        </div>
      )}

      {step === "cuts" && storyboard && (
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <h1 className="text-xl font-semibold">
            {isRestoredView ? "이미 저장된 컷툰이에요" : "4컷이 완성됐어요"}
          </h1>
          {saveError && (
            <p className="w-full max-w-md rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
              {saveError}
            </p>
          )}
          {/* spec-a3 3-3: 기존 에러 아래 복구 버튼 + 안내 1줄. 다른 400·5xx에는 안 보인다. */}
          {saveRecovery && (
            <div className="flex w-full max-w-md flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRecoverSave()}
                disabled={saving || recovering}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
              >
                {recovering ? "저장 중…" : "소재 태그 없이 저장"}
              </button>
              <p className="text-sm text-zinc-500">
                저장된 대사·그림은 그대로이고, 이후 컷을 다시 뽑으면 브랜드 대신 &lsquo;제품&rsquo;으로 나올 수 있어요
              </p>
            </div>
          )}
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
            {storyboard.cuts.map((cut, i) => (
              <div key={cut.cut_index} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
                <div className="relative">
                  {cutImageUrls[cut.cut_index] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- 생성된 이미지의 리졸브 URL, next/image 불필요
                    <img
                      src={cutImageUrls[cut.cut_index]}
                      alt={`컷 ${cut.cut_index}`}
                      className="aspect-square w-full rounded-md object-cover"
                    />
                  ) : (
                    // #104: 생성 자체(유료 호출)는 성공했는데 URL 리졸브만 실패했을
                    // 수 있다 — asset은 보존되고 저장에도 문제없으니 깨진 이미지
                    // 대신 안내만 보여준다. 새로고침 후 에디터에서 다시 리졸브된다.
                    <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md bg-zinc-100 text-center">
                      <span className="text-xs text-zinc-400">이미지를 불러오지 못했어요</span>
                      <span className="text-xs text-zinc-400">저장 후 에디터에서 다시 확인해주세요</span>
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                    {cut.cut_index}컷 · {beatLabel(cut.narrative_beat)}
                  </span>
                </div>
                {/* 복원 뷰에는 저장 수단(handleSave)이 없어 여기서 고치면 그냥
                    사라진다 — 캡션 수정은 실제로 저장되는 에디터로 유도한다. */}
                {isRestoredView ? (
                  <p className="rounded-md px-2 py-1.5 text-left text-sm text-zinc-700">
                    {cut.caption.text}
                  </p>
                ) : editingCutIndex === i ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={draftCaption}
                      onChange={(e) => setDraftCaption(e.target.value)}
                      className="flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        updateCaption(i, draftCaption);
                        setEditingCutIndex(null);
                      }}
                      className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
                    >
                      완료
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCutIndex(i);
                      setDraftCaption(cut.caption.text);
                    }}
                    className="rounded-md border border-transparent px-2 py-1.5 text-left text-sm hover:border-zinc-200 hover:bg-zinc-50"
                  >
                    {cut.caption.text}
                  </button>
                )}
              </div>
            ))}
          </div>
          {isRestoredView ? (
            // 이미 저장된 세션이다 — 다시 "저장"을 누르면 POST /api/session이
            // 매번 새 세션을 만들기 때문에(같은 id로 덮어쓰는 경로가 없음),
            // 여기서는 저장을 다시 시도하지 않고 실제로 고칠 수 있는 에디터로 보낸다.
            <Link
              href={`/editor/${sessionId}`}
              className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
            >
              에디터에서 수정하기
            </Link>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || recovering}
              className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          )}
        </div>
      )}

      {step === "saved" && storyboard && (
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-semibold">{saveNotice ?? "저장됐습니다"}</h1>
          <p className="text-sm text-zinc-500">&ldquo;{displaySubject(storyboard.subject)}&rdquo; 4컷이 준비됐어요</p>
          <Link
            href={`/editor/${savedSessionId ?? sessionId}`}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            대사·말풍선 수정하러 가기
          </Link>
        </div>
      )}

      {selectionNotice && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md bg-zinc-800 px-4 py-2.5 text-sm text-white shadow-lg"
        >
          <span>{selectionNotice}</span>
          <button
            type="button"
            onClick={() => setSelectionNotice(null)}
            aria-label="안내 닫기"
            className="text-zinc-300 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
    </main>
  );
}

function Spinner({ text, progress }: { text: string; progress?: { done: number; total: number } | null }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-700" />
      <p className="text-base font-medium">{text}</p>
      {progress && progress.total > 0 && (
        <div className="h-2 w-48 overflow-hidden rounded-full bg-zinc-200">
          <div
            className="h-full bg-zinc-700 transition-all"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
