#!/usr/bin/env node
/**
 * 构建锅巴 WebUI：web/ -> server/static/
 *
 * 为什么需要这个脚本：
 * server/static/ 是 vite 构建产物，被 .gitignore 排除，全新部署默认没有。
 * 缺了它，首页请求会在 loadPreload 里抛 ENOENT。这里把「装依赖 + 构建 + 校验产物」
 * 一步做完，并给出明确提示，免得用户对着 Missing script 发呆。
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const webDir = path.join(root, "web")
const viteBin = path.join(webDir, "node_modules", "vite", "bin", "vite.js")
const outIndex = path.join(root, "server", "static", "index.html")

if (!fs.existsSync(webDir)) {
  console.error("[Guoba] 找不到 web/ 目录，无法构建 WebUI")
  process.exit(1)
}

if (!fs.existsSync(viteBin)) {
  console.log("[Guoba] 前端依赖未安装，先执行 npm install（web/）…")
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const install = spawnSync(npm, ["install"], { cwd: webDir, stdio: "inherit" })
  if (install.status !== 0) {
    console.error("[Guoba] web/ 依赖安装失败")
    process.exit(install.status || 1)
  }
}

console.log("[Guoba] 正在构建 WebUI…")
const build = spawnSync(process.execPath, [viteBin, "build"], { cwd: webDir, stdio: "inherit" })
if (build.status !== 0) {
  console.error("[Guoba] WebUI 构建失败")
  process.exit(build.status || 1)
}

if (!fs.existsSync(outIndex)) {
  console.error("[Guoba] 构建结束但没有生成 " + outIndex + "，请检查 web/vite.config.ts 的 outDir")
  process.exit(1)
}
console.log("[Guoba] WebUI 构建完成：" + outIndex)
