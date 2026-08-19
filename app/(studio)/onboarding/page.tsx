"use client";

import { useState } from "react";

// 임시 스켈레톤. spec/preset.schema.json v1.1 중 "사용자가 실제로 입력·선택하는 필드"만 둔다.
// 상태·제출 로직 없음. input name은 스키마 경로를 그대로 쓴다.
//
// 이 화면에 없는 이유:
// - style.* 6개 → 레퍼런스에서 자동 추출·확정되는 값. 사용자가 고르는 값이 아니다
//   (추출 결과 확인 + 다시 뽑기는 별도 단계)
// - assets.reference_asset_ids → 지금은 항상 빈 배열
// - 등장 캐릭터·서사 전개·소재·대사 → 컷툰마다 달라지는 값이라 세션 화면 소관

const INTERESTS = [
  ["brand_awareness", "브랜드 인지도"],
  ["trust_building", "신뢰 형성"],
  ["product_showcase", "제품 소개"],
  ["sales_conversion", "구매 전환"],
  ["event_promotion", "이벤트 홍보"],
  ["info_education", "정보 전달"],
  ["lead_generation", "문의 확보"],
  ["recruiting", "모집"],
];

const AGE_BAND = [
  ["10s", "10대"],
  ["20s", "20대"],
  ["30s", "30대"],
  ["40s", "40대"],
  ["50s", "50대"],
  ["60s_plus", "60대 이상"],
];

const LIFE_STAGE = [
  ["student", "학생"],
  ["job_seeker", "구직자"],
  ["early_career", "사회초년생"],
  ["parent", "부모"],
  ["business_owner", "사업자"],
  ["retired", "은퇴"],
];

interface ExtractedStyle {
  line_weight: string;
  saturation: string;
  character_ratio: string;
  background_density: string;
  bubble_style: string;
  palette: string[];
}

const STYLE_LABELS: Record<string, string> = {
  line_weight: "선 굵기",
  saturation: "채도감",
  character_ratio: "캐릭터 비율",
  background_density: "배경 디테일",
  bubble_style: "말풍선 모양",
  palette: "색상 팔레트",
};

function CheckboxGroup({ name, options }: { name: string; options: string[][] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {options.map(([value, label]) => (
        <label key={value} className="flex items-center gap-1">
          <input type="checkbox" name={name} value={value} className="size-4" />
          {label}
        </label>
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const [extractedStyle, setExtractedStyle] = useState<ExtractedStyle | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const handleExtract = async () => {
    setIsExtracting(true);
    // TODO: 실제 API 호출로 교체
    // 지금은 더미 데이터
    setTimeout(() => {
      setExtractedStyle({
        line_weight: "medium",
        saturation: "pastel",
        character_ratio: "2.5head",
        background_density: "low",
        bubble_style: "rounded",
        palette: ["#4A90E2", "#50C878", "#FFD700", "#FF6B6B"],
      });
      setIsExtracting(false);
    }, 1000);
  };

  const handleRetry = () => {
    setExtractedStyle(null);
    handleExtract();
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold">온보딩 · 프리셋 설정</h1>
        <p className="text-sm text-zinc-500">
          프로젝트 전체에 공통으로 주입되는 값만 설정합니다 (preset_version 1.1)
        </p>
      </div>

      <form className="flex flex-col gap-6">
        <input type="hidden" name="preset_version" value="1.1" />

        <fieldset className="flex flex-col gap-3 border border-zinc-300 p-4">
          <legend className="px-1 text-sm font-semibold">프로젝트</legend>

          <div className="flex flex-col gap-1">
            <label htmlFor="project_name" className="text-sm">
              프로젝트 이름 (필수)
            </label>
            <input
              id="project_name"
              name="project_name"
              type="text"
              required
              className="border border-zinc-300 p-1 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="industry" className="text-sm">
              담당 분야 (단어 태그, 쉼표 구분 · 예: 헬스케어, 카페, IT 솔루션)
            </label>
            <input
              id="industry"
              name="context.industry"
              type="text"
              className="border border-zinc-300 p-1 text-sm"
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 border border-zinc-300 p-4">
          <legend className="px-1 text-sm font-semibold">레퍼런스 · 그림체</legend>

          <div className="flex flex-col gap-1">
            <label htmlFor="character_sheet" className="text-sm">
              캐릭터 시트 (필수)
            </label>
            <input
              id="character_sheet"
              name="assets.character_sheet"
              type="file"
              accept="image/*"
              required
              className="text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="style_refs" className="text-sm">
              그림체 레퍼런스 (건너뛰면 기본 스타일)
            </label>
            <input
              id="style_refs"
              name="assets.style_refs"
              type="file"
              accept="image/*"
              multiple
              className="text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="style_keywords" className="text-sm">
              그림체 키워드 (단어 태그, 쉼표 구분 · 예: 수채화, 따뜻한, 손그림)
            </label>
            <input
              id="style_keywords"
              name="style.keywords"
              type="text"
              className="border border-zinc-300 p-1 text-sm"
            />
            <p className="text-xs text-zinc-500">
              레퍼런스를 올리지 않아도 키워드만으로 그림체를 정할 수 있습니다. 둘 다
              입력하면 합쳐서 씁니다.
            </p>
          </div>

          {/* 스타일 추출 결과 표시 */}
          <div className="mt-4">
            <button
              type="button"
              onClick={handleExtract}
              disabled={isExtracting}
              className="border border-blue-500 bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:bg-zinc-300"
            >
              {isExtracting ? "추출 중..." : "그림체 추출하기"}
            </button>
          </div>

          {extractedStyle && (
            <div className="mt-4 rounded border border-zinc-200 bg-zinc-50 p-4">
              <h3 className="mb-2 text-sm font-semibold">추출된 스타일</h3>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(STYLE_LABELS).map(([key, label]) => (
                  <div key={key}>
                    <dt className="text-zinc-500">{label}</dt>
                    <dd className="font-medium">
                      {key === "palette" ? (
                        <div className="flex gap-1">
                          {extractedStyle.palette.map((color, i) => (
                            <div
                              key={i}
                              className="size-4 rounded-full border"
                              style={{ backgroundColor: color }}
                              title={color}
                            />
                          ))}
                        </div>
                      ) : (
                        String(extractedStyle[key as keyof ExtractedStyle])
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-3 border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100"
              >
                다시 뽑기
              </button>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3 border border-zinc-300 p-4">
          <legend className="px-1 text-sm font-semibold">규칙 · 프로젝트 정책</legend>

          <div className="flex flex-col gap-1">
            <label htmlFor="forbidden" className="text-sm">
              넣지 말 것 (단어 태그, 쉼표 구분)
            </label>
            <input
              id="forbidden"
              name="rules.forbidden"
              type="text"
              className="border border-zinc-300 p-1 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="cta_format" className="text-sm">
              마지막 컷 CTA 기본값 (필수, 세션에서 변경 가능)
            </label>
            <input
              id="cta_format"
              name="rules.cta_format"
              type="text"
              required
              className="border border-zinc-300 p-1 text-sm"
            />
            {/* 값 목록은 cta_presets.json으로 분리 예정 — 확정 전까지 자유 입력 */}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 border border-zinc-300 p-4">
          <legend className="px-1 text-sm font-semibold">
            프로젝트 맥락 · 전부 건너뛸 수 있음
          </legend>

          <div className="flex flex-col gap-1">
            <p className="text-sm">마케팅 목적</p>
            <CheckboxGroup name="context.interests" options={INTERESTS} />
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-sm">타깃 연령대</p>
            <CheckboxGroup name="context.age_band" options={AGE_BAND} />
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-sm">타깃 생활단계</p>
            <CheckboxGroup name="context.life_stage" options={LIFE_STAGE} />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="main_subjects" className="text-sm">
              주요 소재 (담당 분야 안에서 반복해 다루는 주제군 · 쉼표 구분)
            </label>
            <input
              id="main_subjects"
              name="context.main_subjects"
              type="text"
              className="border border-zinc-300 p-1 text-sm"
            />
          </div>
        </fieldset>

        <button
          type="submit"
          className="self-start border border-zinc-400 px-4 py-2 text-sm"
        >
          프리셋 확정
        </button>
      </form>
    </main>
  );
}
