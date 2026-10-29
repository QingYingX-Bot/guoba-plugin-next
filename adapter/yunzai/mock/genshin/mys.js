/**
 * mock MysInfo
 *
 * 没装 genshin 时用它顶替：只影响首页的米游社 CK 统计，锅巴其余功能不受影响，所以静默降级。
 */
export class MysInfo {
  static async getBingCkUid() {
    return {}
  }

  static async initCache() {
    return {}
  }
}

/**
 * mock MysUser
 */
export class MysUser {
  static async getStatData() {
    return {
      count: {
        total: -1
      }
    }
  }
}
