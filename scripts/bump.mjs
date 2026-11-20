// バージョンを上げる。package.json・Cargo.toml・tauri.conf.json をそろえる。
//   node scripts/bump.mjs patch|minor|major|<x.y.z>
// 新しいバージョンを標準出力に出す(GitHub Actions で使う)。
import { readFileSync, writeFileSync } from "node:fs";

const arg = process.argv[2] ?? "patch";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);
const next =
  arg === "major" ? `${major + 1}.0.0`
  : arg === "minor" ? `${major}.${minor + 1}.0`
  : arg === "patch" ? `${major}.${minor}.${patch + 1}`
  : arg;
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`バージョンの形が正しくありません: ${arg}`);
  process.exit(1);
}

const setJson = (file) => {
  const text = readFileSync(file, "utf8");
  writeFileSync(file, text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`));
};
setJson("package.json");
setJson("src-tauri/tauri.conf.json");

const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
writeFileSync("src-tauri/Cargo.toml", cargo.replace(/^version = ".*?"/m, `version = "${next}"`));

const lock = "package-lock.json";
try {
  const l = JSON.parse(readFileSync(lock, "utf8"));
  l.version = next;
  if (l.packages?.[""]) l.packages[""].version = next;
  writeFileSync(lock, JSON.stringify(l, null, 2) + "\n");
} catch {
  /* lock がなければ何もしない */
}

console.log(next);
