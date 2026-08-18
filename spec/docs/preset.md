# Preset

- [1. Property `Preset > preset_version`](#preset_version)
- [2. Property `Preset > project_name`](#project_name)
- [3. Property `Preset > assets`](#assets)
  - [3.1. Property `Preset > assets > character_sheet`](#assets_character_sheet)
  - [3.2. Property `Preset > assets > style_refs`](#assets_style_refs)
    - [3.2.1. Preset > assets > style_refs > style_refs items](#assets_style_refs_items)
  - [3.3. Property `Preset > assets > reference_asset_ids`](#assets_reference_asset_ids)
    - [3.3.1. Preset > assets > reference_asset_ids > reference_asset_ids items](#assets_reference_asset_ids_items)
- [4. Property `Preset > style`](#style)
  - [4.1. Property `Preset > style > keywords`](#style_keywords)
    - [4.1.1. Preset > style > keywords > keywords items](#style_keywords_items)
  - [4.2. Property `Preset > style > line_weight`](#style_line_weight)
  - [4.3. Property `Preset > style > palette`](#style_palette)
    - [4.3.1. Preset > style > palette > palette items](#style_palette_items)
  - [4.4. Property `Preset > style > saturation`](#style_saturation)
  - [4.5. Property `Preset > style > character_ratio`](#style_character_ratio)
  - [4.6. Property `Preset > style > background_density`](#style_background_density)
  - [4.7. Property `Preset > style > bubble_style`](#style_bubble_style)
- [5. Property `Preset > rules`](#rules)
  - [5.1. Property `Preset > rules > forbidden`](#rules_forbidden)
    - [5.1.1. Preset > rules > forbidden > forbidden items](#rules_forbidden_items)
  - [5.2. Property `Preset > rules > cta_format`](#rules_cta_format)
- [6. Property `Preset > context`](#context)
  - [6.1. Property `Preset > context > industry`](#context_industry)
    - [6.1.1. Preset > context > industry > industry items](#context_industry_items)
  - [6.2. Property `Preset > context > interests`](#context_interests)
    - [6.2.1. Preset > context > interests > interests items](#context_interests_items)
  - [6.3. Property `Preset > context > age_band`](#context_age_band)
    - [6.3.1. Preset > context > age_band > age_band items](#context_age_band_items)
  - [6.4. Property `Preset > context > life_stage`](#context_life_stage)
    - [6.4.1. Preset > context > life_stage > life_stage items](#context_life_stage_items)
  - [6.5. Property `Preset > context > main_subjects`](#context_main_subjects)
    - [6.5.1. Preset > context > main_subjects > main_subjects items](#context_main_subjects_items)

**Title:** Preset

|                           |             |
| ------------------------- | ----------- |
| **Type**                  | `object`    |
| **Required**              | No          |
| **Additional properties** | Not allowed |

**Description:** 프로젝트 단위 1회 확정값. 프로젝트 안에서 컷툰 생성 세션을 시작할 때 자동으로 주입되는 공통 스타일·정책 묶음이다. 필드 추가·유지 판정 기준: 프로젝트 내 모든 컷툰에 공통으로 주입되는 값만 여기 둔다. 컷툰마다 달라지는 값(등장 캐릭터, 서사 전개, 소재, 대사, 컷별 연출)은 preset이 아니라 storyboard 소유다. 등장 캐릭터 1~2명·주인공 1명 같은 제약도 세션 단위이므로 storyboard.schema.json에서 강제한다

| Property                             | Pattern | Type             | Deprecated | Definition | Title/Description                                                                              |
| ------------------------------------ | ------- | ---------------- | ---------- | ---------- | ---------------------------------------------------------------------------------------------- |
| + [preset_version](#preset_version ) | No      | enum (of string) | No         | -          | 1.1에서 파괴적 변경: rules.characters 제거(세션 단위 값), project_name·context.industry·style.keywords 필수 추가 |
| + [project_name](#project_name )     | No      | string           | No         | -          | 프로젝트 표시 이름. 사용자가 온보딩에서 입력한다                                                                    |
| + [assets](#assets )                 | No      | object           | No         | -          | -                                                                                              |
| + [style](#style )                   | No      | object           | No         | -          | 그림체 확정값. 레퍼런스 이미지 추출값과 사용자가 직접 입력한 스타일 키워드를 합친 결과 — 레퍼런스 없이 키워드만으로도 성립한다                       |
| + [rules](#rules )                   | No      | object           | No         | -          | 프로젝트 전체에 적용되는 정책. 컷툰마다 달라지는 값은 여기 두지 않는다 — 등장 캐릭터 명단·역할은 세션에서 정하므로 storyboard 소유               |
| + [context](#context )               | No      | object           | No         | -          | 온보딩에서 수집하는 프로젝트 설정값. 각 필드는 빈 배열로 스킵 가능(assets/rules의 forbidden·style_refs와 동일한 규약)             |

## <a name="preset_version"></a>1. Property `Preset > preset_version`

|              |                    |
| ------------ | ------------------ |
| **Type**     | `enum (of string)` |
| **Required** | Yes                |

**Description:** 1.1에서 파괴적 변경: rules.characters 제거(세션 단위 값), project_name·context.industry·style.keywords 필수 추가

Must be one of:
* "1.1"

## <a name="project_name"></a>2. Property `Preset > project_name`

|              |          |
| ------------ | -------- |
| **Type**     | `string` |
| **Required** | Yes      |

**Description:** 프로젝트 표시 이름. 사용자가 온보딩에서 입력한다

| Restrictions   |   |
| -------------- | - |
| **Min length** | 1 |

## <a name="assets"></a>3. Property `Preset > assets`

|                           |             |
| ------------------------- | ----------- |
| **Type**                  | `object`    |
| **Required**              | Yes         |
| **Additional properties** | Not allowed |

| Property                                              | Pattern | Type            | Deprecated | Definition | Title/Description                                                                               |
| ----------------------------------------------------- | ------- | --------------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------- |
| + [character_sheet](#assets_character_sheet )         | No      | string          | No         | -          | 필수. 프로젝트의 캐릭터 풀. 캐릭터 동일성은 텍스트 서술로 대체 불가 — 매 컷 reference 주입의 근거 애셋. 각 컷툰에 이 중 누가 등장하는지는 세션에서 고른다 |
| + [style_refs](#assets_style_refs )                   | No      | array of string | No         | -          | 그림체 레퍼런스 업로드 애셋. 온보딩에서 스킵 가능 — 빈 배열이면 기본 스타일 적용                                                 |
| + [reference_asset_ids](#assets_reference_asset_ids ) | No      | array of string | No         | -          | 누적 메모리용. 지금은 항상 빈 배열 — 필드만 미리 박아 마이그레이션 회피                                                      |

### <a name="assets_character_sheet"></a>3.1. Property `Preset > assets > character_sheet`

|              |          |
| ------------ | -------- |
| **Type**     | `string` |
| **Required** | Yes      |

**Description:** 필수. 프로젝트의 캐릭터 풀. 캐릭터 동일성은 텍스트 서술로 대체 불가 — 매 컷 reference 주입의 근거 애셋. 각 컷툰에 이 중 누가 등장하는지는 세션에서 고른다

| Restrictions                      |                                                                       |
| --------------------------------- | --------------------------------------------------------------------- |
| **Must match regular expression** | ```^asset://``` [Test](https://regex101.com/?regex=%5Easset%3A%2F%2F) |

### <a name="assets_style_refs"></a>3.2. Property `Preset > assets > style_refs`

|              |                   |
| ------------ | ----------------- |
| **Type**     | `array of string` |
| **Required** | Yes               |

**Description:** 그림체 레퍼런스 업로드 애셋. 온보딩에서 스킵 가능 — 빈 배열이면 기본 스타일 적용

|                      | Array restrictions |
| -------------------- | ------------------ |
| **Min items**        | N/A                |
| **Max items**        | N/A                |
| **Items unicity**    | True               |
| **Additional items** | False              |
| **Tuple validation** | See below          |

| Each item of this array must be              | Description |
| -------------------------------------------- | ----------- |
| [style_refs items](#assets_style_refs_items) | -           |

#### <a name="assets_style_refs_items"></a>3.2.1. Preset > assets > style_refs > style_refs items

|              |          |
| ------------ | -------- |
| **Type**     | `string` |
| **Required** | No       |

| Restrictions                      |                                                                       |
| --------------------------------- | --------------------------------------------------------------------- |
| **Must match regular expression** | ```^asset://``` [Test](https://regex101.com/?regex=%5Easset%3A%2F%2F) |

### <a name="assets_reference_asset_ids"></a>3.3. Property `Preset > assets > reference_asset_ids`

|              |                   |
| ------------ | ----------------- |
| **Type**     | `array of string` |
| **Required** | Yes               |

**Description:** 누적 메모리용. 지금은 항상 빈 배열 — 필드만 미리 박아 마이그레이션 회피

|                      | Array restrictions |
| -------------------- | ------------------ |
| **Min items**        | N/A                |
| **Max items**        | N/A                |
| **Items unicity**    | True               |
| **Additional items** | False              |
| **Tuple validation** | See below          |

| Each item of this array must be                                | Description |
| -------------------------------------------------------------- | ----------- |
| [reference_asset_ids items](#assets_reference_asset_ids_items) | -           |

#### <a name="assets_reference_asset_ids_items"></a>3.3.1. Preset > assets > reference_asset_ids > reference_asset_ids items

|              |          |
| ------------ | -------- |
| **Type**     | `string` |
| **Required** | No       |

## <a name="style"></a>4. Property `Preset > style`

|                           |             |
| ------------------------- | ----------- |
| **Type**                  | `object`    |
| **Required**              | Yes         |
| **Additional properties** | Not allowed |

**Description:** 그림체 확정값. 레퍼런스 이미지 추출값과 사용자가 직접 입력한 스타일 키워드를 합친 결과 — 레퍼런스 없이 키워드만으로도 성립한다

| Property                                           | Pattern | Type             | Deprecated | Definition | Title/Description                                                                                                                                             |
| -------------------------------------------------- | ------- | ---------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| + [keywords](#style_keywords )                     | No      | array of string  | No         | -          | 사용자가 직접 입력하는 그림체 키워드. 단어 단위 태그 — enum 아님. 레퍼런스 업로드를 건너뛴 경우의 주 입력 경로이고, 업로드와 병행도 가능. 빈 배열이면 레퍼런스 추출값만 사용. forbidden·main_subjects와 동일하게 프롬프트 조립 시 미매핑 단어 위험 있음 |
| + [line_weight](#style_line_weight )               | No      | enum (of string) | No         | -          | -                                                                                                                                                             |
| + [palette](#style_palette )                       | No      | array of string  | No         | -          | -                                                                                                                                                             |
| + [saturation](#style_saturation )                 | No      | enum (of string) | No         | -          | -                                                                                                                                                             |
| + [character_ratio](#style_character_ratio )       | No      | enum (of string) | No         | -          | 캐릭터 두신 비율과 스타일을 하나로 묶은 선택지(의도적 결합) — 2~3두신 카툰 비율 또는 실사형                                                                                                       |
| + [background_density](#style_background_density ) | No      | enum (of string) | No         | -          | 배경 단순화(협상 불가 고정값)를 스키마로 강제하는 필드                                                                                                                               |
| + [bubble_style](#style_bubble_style )             | No      | enum (of string) | No         | -          | vocabulary.json의 bubble_type과 동일한 값 집합 — 값 변경 시 두 파일을 함께 갱신                                                                                                   |

### <a name="style_keywords"></a>4.1. Property `Preset > style > keywords`

|              |                   |
| ------------ | ----------------- |
| **Type**     | `array of string` |
| **Required** | Yes               |

**Description:** 사용자가 직접 입력하는 그림체 키워드. 단어 단위 태그 — enum 아님. 레퍼런스 업로드를 건너뛴 경우의 주 입력 경로이고, 업로드와 병행도 가능. 빈 배열이면 레퍼런스 추출값만 사용. forbidden·main_subjects와 동일하게 프롬프트 조립 시 미매핑 단어 위험 있음

**Example:**

```json
[
    "수채화",
    "따뜻한",
    "손그림"
]
```

|                      | Array restrictions |
| -------------------- | ------------------ |
| **Min items**        | N/A                |
| **Max items**        | N/A                |
| **Items unicity**    | True               |
| **Additional items** | False              |
| **Tuple validation** | See below          |

| Each item of this array must be         | Description |
| --------------------------------------- | ----------- |
| [keywords items](#style_keywords_items) | -           |

#### <a name="style_keywords_items"></a>4.1.1. Preset > style > keywords > keywords items

|              |          |
| ------------ | -------- |
| **Type**     | `string` |
| **Required** | No       |

### <a name="style_line_weight"></a>4.2. Property `Preset > style > line_weight`

|              |                    |
| ------------ | ------------------ |
| **Type**     | `enum (of string)` |
| **Required** | Yes                |

Must be one of:
* "thin"
* "medium"
* "thick"

### <a name="style_palette"></a>4.3. Property `Preset > style > palette`

|              |                   |
| ------------ | ----------------- |
| **Type**     | `array of string` |
| **Required** | Yes               |

|                      | Array restrictions |
| -------------------- | ------------------ |
| **Min items**        | 1                  |
| **Max items**        | N/A                |
| **Items unicity**    | True               |
| **Additional items** | False              |
| **Tuple validation** | See below          |

| Each item of this array must be       | Description |
| ------------------------------------- | ----------- |
| [palette items](#style_palette_items) | -           |

#### <a name="style_palette_items"></a>4.3.1. Preset > style > palette > palette items

|              |          |
| ------------ | -------- |
| **Type**     | `string` |
| **Required** | No       |

| Restrictions                      |                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| **Must match regular expression** | ```^#[0-9A-Fa-f]{6}$``` [Test](https://regex101.com/?regex=%5E%23%5B0-9A-Fa-f%5D%7B6%7D%24) |

### <a name="style_saturation"></a>4.4. Property `Preset > style > saturation`

|              |                    |
| ------------ | ------------------ |
| **Type**     | `enum (of string)` |
| **Required** | Yes                |

Must be one of:
* "pastel"
* "vivid"
* "muted"

### <a name="style_character_ratio"></a>4.5. Property `Preset > style > character_ratio`

|              |                    |
| ------------ | ------------------ |
| **Type**     | `enum (of string)` |
| **Required** | Yes                |

**Description:** 캐릭터 두신 비율과 스타일을 하나로 묶은 선택지(의도적 결합) — 2~3두신 카툰 비율 또는 실사형

Must be one of:
* "2head"
* "2.5head"
* "3head"
* "realistic"

### <a name="style_background_density"></a>4.6. Property `Preset > style > background_density`

|              |                    |
| ------------ | ------------------ |
| **Type**     | `enum (of string)` |
| **Required** | Yes                |

**Description:** 배경 단순화(협상 불가 고정값)를 스키마로 강제하는 필드

Must be one of:
* "none"
* "low"
* "medium"
* "high"

### <a name="style_bubble_style"></a>4.7. Property `Preset > style > bubble_style`

|              |                    |
| ------------ | ------------------ |
| **Type**     | `enum (of string)` |
| **Required** | Yes                |

**Description:** vocabulary.json의 bubble_type과 동일한 값 집합 — 값 변경 시 두 파일을 함께 갱신

Must be one of:
* "rounded"
* "rect"
* "cloud"

## <a name="rules"></a>5. Property `Preset > rules`

|                           |             |
| ------------------------- | ----------- |
| **Type**                  | `object`    |
| **Required**              | Yes         |
| **Additional properties** | Not allowed |

**Description:** 프로젝트 전체에 적용되는 정책. 컷툰마다 달라지는 값은 여기 두지 않는다 — 등장 캐릭터 명단·역할은 세션에서 정하므로 storyboard 소유

| Property                           | Pattern | Type            | Deprecated | Definition | Title/Description                                                                                                                         |
| ---------------------------------- | ------- | --------------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| + [forbidden](#rules_forbidden )   | No      | array of string | No         | -          | 네거티브 요소. 단어 단위 태그 — enum 아님. 프롬프트 조립 시 미매핑 단어 위험 있음(검증 로직 미정)                                                                             |
| + [cta_format](#rules_cta_format ) | No      | string          | No         | -          | 마지막 컷 CTA의 프로젝트 기본값. 세션에서 다른 값으로 덮어쓸 수 있고, 덮어쓰지 않으면 이 값이 주입된다. 값 목록은 코드가 아니라 JSON 데이터 파일(cta_presets.json, 미작성)로 분리 예정 — 목록 확정 전까지 자유 문자열 |

### <a name="rules_forbidden"></a>5.1. Property `Preset > rules > forbidden`

|              |                   |
| ------------ | ----------------- |
| **Type**     | `array of string` |
| **Required** | Yes               |

**Description:** 네거티브 요소. 단어 단위 태그 — enum 아님. 프롬프트 조립 시 미매핑 단어 위험 있음(검증 로직 미정)

|                      | Array restrictions |
| -------------------- | ------------------ |
| **Min items**        | N/A                |
| **Max items**        | N/A                |
| **Items unicity**    | True               |
| **Additional items** | False              |
| **Tuple validation** | See below          |

| Each item of this array must be           | Description |
| ----------------------------------------- | ----------- |
| [forbidden items](#rules_forbidden_items) | -           |

#### <a name="rules_forbidden_items"></a>5.1.1. Preset > rules > forbidden > forbidden items

|              |          |
| ------------ | -------- |
| **Type**     | `string` |
| **Required** | No       |

### <a name="rules_cta_format"></a>5.2. Property `Preset > rules > cta_format`

|              |          |
| ------------ | -------- |
| **Type**     | `string` |
| **Required** | Yes      |

**Description:** 마지막 컷 CTA의 프로젝트 기본값. 세션에서 다른 값으로 덮어쓸 수 있고, 덮어쓰지 않으면 이 값이 주입된다. 값 목록은 코드가 아니라 JSON 데이터 파일(cta_presets.json, 미작성)로 분리 예정 — 목록 확정 전까지 자유 문자열

| Restrictions   |   |
| -------------- | - |
| **Min length** | 1 |

## <a name="context"></a>6. Property `Preset > context`

|                           |             |
| ------------------------- | ----------- |
| **Type**                  | `object`    |
| **Required**              | Yes         |
| **Additional properties** | Not allowed |

**Description:** 온보딩에서 수집하는 프로젝트 설정값. 각 필드는 빈 배열로 스킵 가능(assets/rules의 forbidden·style_refs와 동일한 규약)

| Property                                   | Pattern | Type                      | Deprecated | Definition | Title/Description                                                                                                                                  |
| ------------------------------------------ | ------- | ------------------------- | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| + [industry](#context_industry )           | No      | array of string           | No         | -          | 이 프로젝트가 담당하는 분야. 회사가 무엇을 하는지에 해당한다. 단어 단위 태그 — enum 아님(값을 고정하면 특정 업종 분류가 스키마에 박혀 범용성이 깨진다)                                                         |
| + [interests](#context_interests )         | No      | array of enum (of string) | No         | -          | 마케팅 목적 축(업종 무관, 목적만). 브랜드 인지도/신뢰형성/제품소개/구매전환/이벤트홍보/정보전달/문의확보/모집                                                                                    |
| + [age_band](#context_age_band )           | No      | array of enum (of string) | No         | -          | 타깃층 — 연령대 축                                                                                                                                        |
| + [life_stage](#context_life_stage )       | No      | array of enum (of string) | No         | -          | 타깃층 — 생활단계 축(연령대와 독립, 동시 선택 가능)                                                                                                                    |
| + [main_subjects](#context_main_subjects ) | No      | array of string           | No         | -          | industry 안에서 이 프로젝트가 반복해 다루는 주제군(예: 카페라면 원두·디카페인·신메뉴). 컷툰 한 편의 실제 소재는 여기가 아니라 세션에서 받는다. 단어 단위 태그 — enum 아님. forbidden과 동일하게 프롬프트 조립 시 미매핑 단어 위험 있음 |

### <a name="context_industry"></a>6.1. Property `Preset > context > industry`

|              |                   |
| ------------ | ----------------- |
| **Type**     | `array of string` |
| **Required** | Yes               |

**Description:** 이 프로젝트가 담당하는 분야. 회사가 무엇을 하는지에 해당한다. 단어 단위 태그 — enum 아님(값을 고정하면 특정 업종 분류가 스키마에 박혀 범용성이 깨진다)

**Examples:**

```json
[
    "카페"
]
```

```json
[
    "헬스케어",
    "IT 솔루션"
]
```

|                      | Array restrictions |
| -------------------- | ------------------ |
| **Min items**        | N/A                |
| **Max items**        | N/A                |
| **Items unicity**    | True               |
| **Additional items** | False              |
| **Tuple validation** | See below          |

| Each item of this array must be           | Description |
| ----------------------------------------- | ----------- |
| [industry items](#context_industry_items) | -           |

#### <a name="context_industry_items"></a>6.1.1. Preset > context > industry > industry items

|              |          |
| ------------ | -------- |
| **Type**     | `string` |
| **Required** | No       |

### <a name="context_interests"></a>6.2. Property `Preset > context > interests`

|              |                             |
| ------------ | --------------------------- |
| **Type**     | `array of enum (of string)` |
| **Required** | Yes                         |

**Description:** 마케팅 목적 축(업종 무관, 목적만). 브랜드 인지도/신뢰형성/제품소개/구매전환/이벤트홍보/정보전달/문의확보/모집

|                      | Array restrictions |
| -------------------- | ------------------ |
| **Min items**        | N/A                |
| **Max items**        | N/A                |
| **Items unicity**    | True               |
| **Additional items** | False              |
| **Tuple validation** | See below          |

| Each item of this array must be             | Description |
| ------------------------------------------- | ----------- |
| [interests items](#context_interests_items) | -           |

#### <a name="context_interests_items"></a>6.2.1. Preset > context > interests > interests items

|              |                    |
| ------------ | ------------------ |
| **Type**     | `enum (of string)` |
| **Required** | No                 |

Must be one of:
* "brand_awareness"
* "trust_building"
* "product_showcase"
* "sales_conversion"
* "event_promotion"
* "info_education"
* "lead_generation"
* "recruiting"

### <a name="context_age_band"></a>6.3. Property `Preset > context > age_band`

|              |                             |
| ------------ | --------------------------- |
| **Type**     | `array of enum (of string)` |
| **Required** | Yes                         |

**Description:** 타깃층 — 연령대 축

|                      | Array restrictions |
| -------------------- | ------------------ |
| **Min items**        | N/A                |
| **Max items**        | N/A                |
| **Items unicity**    | True               |
| **Additional items** | False              |
| **Tuple validation** | See below          |

| Each item of this array must be           | Description |
| ----------------------------------------- | ----------- |
| [age_band items](#context_age_band_items) | -           |

#### <a name="context_age_band_items"></a>6.3.1. Preset > context > age_band > age_band items

|              |                    |
| ------------ | ------------------ |
| **Type**     | `enum (of string)` |
| **Required** | No                 |

Must be one of:
* "10s"
* "20s"
* "30s"
* "40s"
* "50s"
* "60s_plus"

### <a name="context_life_stage"></a>6.4. Property `Preset > context > life_stage`

|              |                             |
| ------------ | --------------------------- |
| **Type**     | `array of enum (of string)` |
| **Required** | Yes                         |

**Description:** 타깃층 — 생활단계 축(연령대와 독립, 동시 선택 가능)

|                      | Array restrictions |
| -------------------- | ------------------ |
| **Min items**        | N/A                |
| **Max items**        | N/A                |
| **Items unicity**    | True               |
| **Additional items** | False              |
| **Tuple validation** | See below          |

| Each item of this array must be               | Description |
| --------------------------------------------- | ----------- |
| [life_stage items](#context_life_stage_items) | -           |

#### <a name="context_life_stage_items"></a>6.4.1. Preset > context > life_stage > life_stage items

|              |                    |
| ------------ | ------------------ |
| **Type**     | `enum (of string)` |
| **Required** | No                 |

Must be one of:
* "student"
* "job_seeker"
* "early_career"
* "parent"
* "business_owner"
* "retired"

### <a name="context_main_subjects"></a>6.5. Property `Preset > context > main_subjects`

|              |                   |
| ------------ | ----------------- |
| **Type**     | `array of string` |
| **Required** | Yes               |

**Description:** industry 안에서 이 프로젝트가 반복해 다루는 주제군(예: 카페라면 원두·디카페인·신메뉴). 컷툰 한 편의 실제 소재는 여기가 아니라 세션에서 받는다. 단어 단위 태그 — enum 아님. forbidden과 동일하게 프롬프트 조립 시 미매핑 단어 위험 있음

|                      | Array restrictions |
| -------------------- | ------------------ |
| **Min items**        | N/A                |
| **Max items**        | N/A                |
| **Items unicity**    | True               |
| **Additional items** | False              |
| **Tuple validation** | See below          |

| Each item of this array must be                     | Description |
| --------------------------------------------------- | ----------- |
| [main_subjects items](#context_main_subjects_items) | -           |

#### <a name="context_main_subjects_items"></a>6.5.1. Preset > context > main_subjects > main_subjects items

|              |          |
| ------------ | -------- |
| **Type**     | `string` |
| **Required** | No       |

----------------------------------------------------------------------------------------------------------------------------
Generated using [json-schema-for-humans](https://github.com/coveooss/json-schema-for-humans) on 2026-08-18 at 17:58:18 +0900
