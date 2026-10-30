import {Restart} from '#guoba.adapter'

/**
 * 执行重启
 */
export function doRestart() {
  const e = {
    reply: (msg) => logger.info(msg),
    bot: {
      uin: 'stdin'
    },
    logFnc: '[Guoba]'
  }
  return new Restart(e).restart()
}
