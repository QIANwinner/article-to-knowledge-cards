#!/usr/bin/env bash
# build-exe.sh — 产出 Windows exe（约 2.5 MB，无需安装，双击即用）
#
# 关键点：必须带 RUSTFLAGS="--cfg has_std"
#   indexmap 的 struct 定义分两个 cfg 分支：
#     #[cfg(has_std)]      pub struct IndexMap<K, V, S = RandomState> {}  有默认参数
#     #[cfg(not(has_std))] pub struct IndexMap<K, V, S> {}                无默认参数
#   has_std 不是 rustc 内置标记，而是 indexmap 的 build.rs 用 autocfg
#   探测目标三元组是否含 std 后自行 emit的：
#     autocfg::new().emit_sysroot_crate("std")
#   Rust 1.99 上探测失败 → has_std 未定义 → 走 not(has_std) 分支 →
#   schemars 的 IndexMap<K, V>（依赖默认参数）编译失败（E0107）。
#   手动注入该 cfg 即让 indexmap 走对分支。
#
# 用法：bash scripts/build-exe.sh
# 前置：Node.js ≥ 18、已 npm install、已装 Visual Studio Build Tools

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="C:/Users/21889/.workbuddy/binaries/python/versions/3.13.12/python.exe"
export PATH="$HOME/.cargo/bin:$PATH"
export RUSTFLAGS="--cfg has_std"

echo "=============================================="
echo " 构建 Windows exe"
echo "=============================================="

# 前置检查
command -v cargo >/dev/null 2>&1 || { echo "[x] 未找到 cargo，请先安装 Rust：https://rustup.rs"; exit 1; }
if ! command -v link.exe >/dev/null 2>&1 && [ ! -f "/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Auxiliary/Build/vcvars64.bat" ]; then
  echo "[!] 可能缺少 MSVC 链接器。若报 link.exe not found，请安装："
  echo "    curl -L -o vs_BuildTools.exe https://aka.ms/vs/17/release/vs_buildtools.exe"
  echo "    ./vs_BuildTools.exe --quiet --wait --norestart --nocache \\"
  echo "      --add Microsoft.VisualStudio.Workload.VCTools \\"
  echo "      --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 \\"
  echo "      --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
  exit 1
fi

echo "[1/3] cargo build --release（首次约 10-25 分钟，之后约 1-2 分钟）..."
cd "$ROOT/src-tauri"
cargo build --release 2>&1 | tail -8

EXE="target/release/knowledge-cards.exe"
[ -f "$EXE" ] || { echo "[x] 编译失败，未产出 exe"; exit 1; }

echo ""
echo "[2/3] 收集产物..."
mkdir -p "$ROOT/release"
cp "$EXE" "$ROOT/release/knowledge-cards.exe"
cp "$EXE" "$ROOT/release/knowledge-cards-v0.1.3-portable.exe"

SIZE=$(wc -c < "$ROOT/release/knowledge-cards.exe")
MB=$("$PY" -c "print(f'{$SIZE/1024/1024:.2f}')")

echo ""
echo "=============================================="
echo " 构建完成"
echo "=============================================="
echo "  产物    : release/knowledge-cards.exe"
echo "  大小    : $MB MB"
echo ""
echo "  直接双击运行，无需安装。"
echo "=============================================="
echo ""

echo "[3/3] 校验 gitignore..."
cd "$ROOT"
if git check-ignore -q release/knowledge-cards.exe 2>/dev/null; then
  echo "  [!] 被 .gitignore 排除，需检查规则"
  exit 1
else
  echo "  OK: release/knowledge-cards.exe 会被纳入版本控制"
fi