import fs from "fs";
import path from "path";
import chalk from 'chalk'

/**
 * 引入 class 资源
 * @param rootPath
 * @param clazz 筛选类
 * @param classes
 */
export async function loadClasses(rootPath, clazz, classes = {}) {
  let files = readdirRecursiveSync(
    rootPath,
    file => /\.c?js$/.test(file),
    files => files.includes('.ignored_loader')
  );
  // 并行 import
  // 每个文件都自己解析依赖（GI/GID），文件之间没有先后要求；Promise.all 保持结果顺序，
  // 所以 Object.assign 的合并顺序和原来一致。loadClass 内部已经 catch，不会让整批失败。
  const loaded = await Promise.all(files.map(filePath => loadClass(filePath, clazz)));
  for (const tempClasses of loaded) {
    Object.assign(classes, tempClasses);
  }
  return classes
}

/**
 *
 * @param filePath
 * @param clazz
 * @param onlyDefault 是否只处理 default
 * @return Promise<*>
 */
export async function loadClass(filePath, clazz, onlyDefault = false) {
  const classes = {}
  try {
    let app = await import('file://' + filePath + '?' + Date.now())
    // 可一次性导入多个类
    for (const [key, value] of Object.entries(app)) {
      if (instanceOf(value, clazz)) {
        if (key === 'default' && onlyDefault) {
          return value;
        }
        let name = key
        if (name === 'default' && value?.name) {
          name = value.name
        }
        classes[name] = value
      }
    }
  } catch (e) {
    logger.error(`[Guoba] loadClasses error: ${chalk.red(path.basename(filePath))}`, e)
  }
  if (onlyDefault) {
    return null
  }
  return classes;
}

/**
 * 获取某个目录下的所有文件（返回的是绝对路径）
 *
 * @param rootPath
 * @param include {boolean | Function} 文件名过滤器
 * @param exclude {Function} 排除器
 */
export function readdirRecursiveSync(rootPath, include = () => true, exclude = () => false) {
  let files = fs.readdirSync(rootPath)
  if (exclude(files)) {
    return []
  }
  let ret = []
  for (let file of files) {
    let filePath = path.join(rootPath, file)
    let stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
      ret = ret.concat(readdirRecursiveSync(filePath, include, exclude));
    } else if (include(file)) {
      ret.push(filePath)
    }
  }
  return ret
}

/**
 * 判断是否是某个类的实例或继承类
 *
 * @param obj
 * @param clazz
 */
export function instanceOf(obj, clazz) {
  if (obj instanceof clazz) {
    return true
  } else if (obj?.prototype) {
    return instanceOf(obj.prototype, clazz)
  }
  return false
}
