# Euros キャラクター形式 v1

Euros が保存するキャラクターの形です。Notos など、ほかのアプリがキャラクターを読むときは、この文書に従います。

- 形を変えるときは `schemaVersion` を上げ、この文書も直します(型の定義は `src/types.ts`)。
- 項目を足すだけなら `schemaVersion` は上げません。読む側は、知らない項目を無視してください。
- 読む側は、`schemaVersion` が知っている版より大きいキャラクターを読まないか、読めた項目だけを使ってください。

## 保存先(ライブラリ)

```
<ライブラリ>/
  characters/
    <キャラクターの id>/
      character.json
      sheets/<版の id>.png      … 版ごとのキャラクターシート
      refs/<参照画像の id>.<拡張子>  … 読み込んだ参照画像(png / jpg / jpeg / webp)
  .trash/                       … 削除したキャラクター(読む側は無視する)
```

ライブラリの場所:

1. `%APPDATA%\io.github.kurone-hinamori.euros\settings.json` の `libraryDir` が空でなければ、そのフォルダー
2. それ以外は `%APPDATA%\Euros\library`

ほかのアプリは、ライブラリを **読むだけ** にしてください。Euros は `character.json` を一時ファイルに書いてから置き換えるので、読んでいる途中で中身が半端になることはありません。`.tmp` で終わるファイルは無視してください。

## .euros ファイル(受け渡し用)

1人のキャラクターを1つにまとめた zip です。中身はキャラクターのフォルダーと同じです。

```
character.json
sheets/<版の id>.png
refs/<参照画像の id>.<拡張子>
```

- Euros の詳細の画面の「書き出す」で作り、一覧の画面の「読み込む」で取り込みます。
- 同じ id のキャラクターがあるときは、置き換えるか、別のキャラクター(新しい id)として取り込むかを選びます。
- 上の3種類以外のファイルは読み込みません。

## character.json

文字コードは UTF-8 です。日時は ISO 8601(`2026-11-21T09:30:00.000Z`)です。

| 項目 | 型 | 説明 |
|---|---|---|
| `schemaVersion` | number | いまは `1` |
| `app` | `"Euros"` | 作ったアプリ |
| `id` | string | キャラクターの id(英数字・`-`・`_`、64文字まで)。フォルダー名と同じ |
| `createdAt` / `updatedAt` | string | 作った日時と、最後に保存した日時 |
| `profile` | Profile | 名前や性格など(下の表) |
| `sourceJa` | string | 最初に入力した日本語の説明 |
| `style` | string | 画風(英語) |
| `appearance` | Appearance | いまの外見 |
| `references` | ReferenceImage[] | 読み込んだ参照画像 |
| `sheet` | SheetOptions | シートの作り方(表情など) |
| `revisions` | Revision[] | シートの版(古い順) |
| `currentRevision` | string? | 採用中の版の id |

### いまのシートの画像

`revisions` から `id` が `currentRevision` の版を探し、その `image`(例:`sheets/r1a2b3.png`)を読みます。`currentRevision` がないときや、版に `image` がないときは、シートはありません。

シートは 2304×1536 の PNG です。左半分に正面・横・背面の全身、右上に表情一覧、右下に衣装・小物の詳細を描きます(区画の位置は決まっていません)。

### Profile

Notos の CharacterSheet と同じ名前の項目は、同じ意味です。どれも文字列で、空のこともあります。

| 項目 | 説明 |
|---|---|
| `name` / `reading` | 名前と読み |
| `age` / `gender` / `role` | 年齢・性別・立場 |
| `personality` / `speech` | 性格・話し方 |
| `background` / `notes` | 経歴・メモ |

### Appearance

次の9項目を持ちます。各項目は `{ "ja": 日本語の説明, "en": 生成に使う英語 }` です。

`hair`(髪)、`eyes`(目)、`face`(顔立ち)、`skin`(肌)、`height`(身長)、`body`(体型)、`outfit`(衣装)、`accessories`(小物)、`other`(その他)

ほかのアプリで画像を作るときは `en` を、人に見せるときは `ja` を使ってください。

### ReferenceImage

| 項目 | 説明 |
|---|---|
| `id` | 参照画像の id |
| `file` | `refs/<id>.<拡張子>` |
| `label` | 元のファイル名 |
| `use` | `all`(全体)/ `face`(顔)/ `outfit`(衣装)/ `style`(画風) |
| `addedAt` | 読み込んだ日時 |

### SheetOptions

| 項目 | 説明 |
|---|---|
| `expressions` | 表情一覧に並べる表情。`{ "ja": 名前, "en": 生成に使う説明 }` の配列 |
| `notHuman` | 人ではないキャラクター(ロボット・動物・物など) |

### Revision

1回の生成ごとに1つ増えます。同じ画像を作り直せるよう、生成に使ったものをすべて残します。

| 項目 | 説明 |
|---|---|
| `id` | 版の id |
| `parentId` | 元にした版(最初の版にはない) |
| `createdAt` | 作った日時 |
| `kind` | `create`(新規作成)/ `instruction`(修正指示)/ `redraw`(範囲の描き直し)/ `manual`(説明を直接直した) |
| `instructionJa` | 修正指示の文(複数のときは `／` でつなぐ) |
| `changes` | 変わった項目。`{ key, before, after }` の配列(before と after は Appearance の1項目) |
| `appearance` | この版の外見(丸ごと) |
| `prompt` / `negative` | 生成に使ったプロンプトの全文 |
| `engine` | `moss`(MOSS-Image)/ `minimax_h3`(MiniMax-H3-Image)。今後増えます |
| `modelFiles` | ComfyUI で使ったファイル(`unet` / `clip` / `vae` / `lora`) |
| `seed` / `width` / `height` | seed と仕上がりの大きさ |
| `method` | `fresh`(新しく描く)/ `same_seed`(同じ seed)/ `reference`(元のシートを参照)/ `redraw`(範囲だけ) |
| `references` | 参照した画像の id。元のシートは `sheet:<版の id>` |
| `boxes` | 描き直した範囲。0〜1000 の `[上, 左, 下, 右]` の配列 |
| `workflow` | ComfyUI に送ったワークフロー(API 形式) |
| `image` | できた画像(`sheets/<id>.png`)。失敗した版にはない |

## 例

```json
{
  "schemaVersion": 1,
  "app": "Euros",
  "id": "3f9c1a7b2e4d4c8a9b10",
  "createdAt": "2026-11-21T09:30:00.000Z",
  "updatedAt": "2026-11-21T09:45:12.000Z",
  "profile": { "name": "時任しずく", "reading": "ときとう しずく", "age": "17", "gender": "女性", "role": "高校生", "personality": "物静かだが芯が強い", "speech": "", "background": "", "notes": "" },
  "sourceJa": "17歳の女子高生。黒髪のロングヘアで前髪ぱっつん。…",
  "style": "Japanese anime style, clean thin line art, flat cel shading, soft natural colors",
  "appearance": {
    "hair": { "ja": "黒髪のロングヘア。前髪ぱっつん。", "en": "long straight black hair, blunt bangs" },
    "eyes": { "ja": "赤い瞳", "en": "red eyes" }
  },
  "references": [],
  "sheet": { "expressions": [{ "ja": "通常", "en": "neutral" }], "notHuman": false },
  "revisions": [
    { "id": "r1", "createdAt": "2026-11-21T09:30:00.000Z", "kind": "create", "appearance": {}, "prompt": "…", "negative": "…", "engine": "moss",
      "modelFiles": { "unet": "moss_image_sft_int8_convrot.safetensors", "clip": "qwen3.5_9b_w4a8_gptq.safetensors", "vae": "flux2-vae_small.safetensors" },
      "seed": 7, "width": 2304, "height": 1536, "method": "fresh", "references": [], "image": "sheets/r1.png" }
  ],
  "currentRevision": "r1"
}
```

(例では `appearance` の項目を一部省いています。実際のファイルには9項目すべてがあります。)
