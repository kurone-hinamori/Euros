import type { Appearance, AppearanceField, AppearanceKey, Profile, Settings } from "../types";
import { APPEARANCE_KEYS, APPEARANCE_LABEL } from "../types";
import { chatJson } from "./ollama";

// Ollama に頼む処理。日本語の説明を、外見の項目(日本語と英語)とプロフィールに整理する。

/** 英語の書き方。画像生成のモデルがそのまま読める、具体的な語にする */
const EN_RULES = `en は画像生成に使う英語です。
- 見た目だけを、具体的な英語の語句で書く(色・長さ・形・素材・模様)。比喩や性格、物語は書かない。
- 色は "pale blue" "dark brown" のように明るさまで書く。長さは "shoulder-length" "waist-length" のように体の位置で書く。
- 身長は "short, about 150 cm, petite build" のように、cm と見た目の印象の両方で書く。
- 説明がない項目は、ほかの項目と合う無難なデザインを考えて埋める(空にしない)。ただし other は、書くことがなければ空でよい。
- 1項目は1〜3文か、カンマ区切りの語句。`;

const JA_RULES = `ja は人が読んで直す日本語です。en と同じ内容を、自然で短い日本語で書く。`;

const FIELD_GUIDE = APPEARANCE_KEYS.map((k) => `- ${k}(${APPEARANCE_LABEL[k]})`).join("\n");

const fieldSchema = { type: "object", properties: { ja: { type: "string" }, en: { type: "string" } }, required: ["ja", "en"] };
const appearanceSchema = {
  type: "object",
  properties: Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, fieldSchema])),
  required: [...APPEARANCE_KEYS],
};

const PROFILE_KEYS = ["name", "reading", "age", "gender", "role", "personality", "speech", "background"] as const;

export interface Structured {
  profile: Omit<Profile, "notes">;
  appearance: Appearance;
  /** 人ではない(ロボット・動物・物など) */
  notHuman: boolean;
}

/** 日本語の説明を、プロフィールと外見の項目に整理する */
export async function structureCharacter(s: Settings, input: { description: string; name: string; references: string[] }, signal?: AbortSignal): Promise<Structured> {
  const system = `あなたはキャラクターデザイナーです。日本語で書かれたキャラクターの説明を読み、キャラクターシートを描くための設定に整理します。

出力は JSON です。
- profile:name(名前)、reading(読み仮名)、age(年齢)、gender(性別)、role(立場・職業)、personality(性格)、speech(口調・一人称)、background(経歴)。説明にないものは、説明に合う短い案を書く。名前が指定されていればそのまま使う。指定がなければ、説明に合う名前を考える(「未指定」などにしない)。
- appearance:外見の項目。それぞれ ja と en を持つ。
${FIELD_GUIDE}
  outfit は服装の全体(上着・下・靴まで)、accessories は身に着けている小物(髪飾り・眼鏡・鞄・武器など)。
- notHuman:人ではない(ロボット・動物・物など)なら true。人の姿をした人外(獣耳の人やアンドロイドなど)は false。

${EN_RULES}
${JA_RULES}`;
  const refs = input.references.length ? `\n\n参照画像が ${input.references.length} 枚あります(${input.references.join("、")})。画像は見えないので、説明文だけから整理してください。` : "";
  const user = `${input.name.trim() ? `名前:${input.name.trim()}\n` : ""}説明:\n${input.description.trim()}${refs}`;
  const out = await chatJson<Structured>(s, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    schema: {
      type: "object",
      properties: {
        profile: { type: "object", properties: Object.fromEntries(PROFILE_KEYS.map((k) => [k, { type: "string" }])), required: [...PROFILE_KEYS] },
        appearance: appearanceSchema,
        notHuman: { type: "boolean" },
      },
      required: ["profile", "appearance", "notHuman"],
    },
    signal,
  });
  return {
    profile: Object.fromEntries(PROFILE_KEYS.map((k) => [k, String(out.profile?.[k] ?? "").trim()])) as Structured["profile"],
    appearance: cleanAppearance(out.appearance),
    notHuman: !!out.notHuman,
  };
}

function cleanAppearance(a: Partial<Record<AppearanceKey, Partial<AppearanceField>>> | undefined): Appearance {
  return Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, { ja: String(a?.[k]?.ja ?? "").trim(), en: String(a?.[k]?.en ?? "").trim() }])) as Appearance;
}

/** 直した日本語から英語を作り直す(keys の項目だけ) */
export async function translateFields(s: Settings, appearance: Appearance, keys: AppearanceKey[], signal?: AbortSignal): Promise<Partial<Record<AppearanceKey, string>>> {
  if (!keys.length) return {};
  const context = APPEARANCE_KEYS.filter((k) => !keys.includes(k) && appearance[k].en)
    .map((k) => `- ${k}: ${appearance[k].en}`)
    .join("\n");
  const target = keys.map((k) => `- ${k}(${APPEARANCE_LABEL[k]}):${appearance[k].ja}`).join("\n");
  const out = await chatJson<Record<string, string>>(s, {
    messages: [
      {
        role: "system",
        content: `キャラクターの外見の日本語を、画像生成に使う英語にします。出力は JSON で、項目名をキーにした英語の文字列です。\n${EN_RULES}`,
      },
      { role: "user", content: `${context ? `ほかの項目(参考。訳さない):\n${context}\n\n` : ""}英語にする項目:\n${target}` },
    ],
    schema: { type: "object", properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])), required: keys },
    signal,
  });
  return Object.fromEntries(keys.map((k) => [k, String(out[k] ?? "").trim()]));
}

export interface InstructionResult {
  /** 変わる項目と、変えた後の説明 */
  changes: Partial<Record<AppearanceKey, AppearanceField>>;
  /** 変える所を、描き直しのプロンプトに入れる短い英語(「前髪を眉の下まで伸ばす」など) */
  summaryEn: string;
  /** 外見では直せない指示だったときの説明(日本語) */
  note: string;
}

/**
 * 日本語の修正指示(「前髪をもう少し長く」など)を、外見の項目の書き換えにする。
 * 指示に関係する項目だけを変え、ほかの項目はそのまま残す。
 */
export async function applyInstruction(s: Settings, appearance: Appearance, instruction: string, signal?: AbortSignal): Promise<InstructionResult> {
  const current = APPEARANCE_KEYS.map((k) => `- ${k}(${APPEARANCE_LABEL[k]})\n  ja: ${appearance[k].ja || "(なし)"}\n  en: ${appearance[k].en || "(なし)"}`).join("\n");
  const out = await chatJson<{ changes: { key: string; ja: string; en: string }[]; summaryEn: string; note: string }>(s, {
    messages: [
      {
        role: "system",
        content: `あなたはキャラクターデザイナーです。キャラクターシートの修正指示を受けて、外見の設定を書き換えます。

- 指示に関係する項目だけを changes に入れる。関係しない項目は入れない(書き換えない)。
- changes の ja と en は、その項目の書き換えた後の全文。指示にない部分(前髪を直すなら後ろ髪や色)は、元の説明のまま残す。
- 「もう少し」「少し」は控えめに、「かなり」「もっと」ははっきり変える。変えた結果が分かる具体的な語にする(「長め」ではなく "bangs reaching the eyebrows" のように)。
- summaryEn は、何をどう変えるかを短い英語で(例:"make the bangs longer, reaching just below the eyebrows")。描き直しのときに画像生成のモデルへ伝える。
- 外見の設定では直せない指示(ポーズ、構図、画風、表情の種類など)なら、changes は空にして、note に日本語で理由を書く。直せるなら note は空。

${EN_RULES}
${JA_RULES}`,
      },
      { role: "user", content: `いまの外見:\n${current}\n\n修正指示:${instruction.trim()}` },
    ],
    schema: {
      type: "object",
      properties: {
        changes: {
          type: "array",
          items: { type: "object", properties: { key: { type: "string", enum: [...APPEARANCE_KEYS] }, ja: { type: "string" }, en: { type: "string" } }, required: ["key", "ja", "en"] },
        },
        summaryEn: { type: "string" },
        note: { type: "string" },
      },
      required: ["changes", "summaryEn", "note"],
    },
    signal,
  });
  const changes: InstructionResult["changes"] = {};
  for (const c of out.changes ?? []) {
    const key = c.key as AppearanceKey;
    if (!APPEARANCE_KEYS.includes(key)) continue;
    const next = { ja: String(c.ja ?? "").trim(), en: String(c.en ?? "").trim() };
    if (next.ja !== appearance[key].ja || next.en !== appearance[key].en) changes[key] = next;
  }
  return { changes, summaryEn: String(out.summaryEn ?? "").trim(), note: String(out.note ?? "").trim() };
}
