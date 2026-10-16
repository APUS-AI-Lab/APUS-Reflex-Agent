/** Deterministic text classes for the compaction sweep: tool output that is certainly noise, and text never removed. */

/** Line starts of package-manager, download, build, and push progress output. */
const PROGRESS_LINES = [
  String.raw`\$ (?:pip3?|npm|pnpm|yarn|apt(?:-get)?|brew|cargo|go|docker) (?:install|update|add|fetch|pull|push|upgrade)\b.*`,
  'Collecting ', 'Downloading ', 'Using cached ', 'Installing collected', 'Successfully installed', 'Requirement already satisfied',
  String.raw`Get:\d`, String.raw`Hit:\d`, String.raw`Ign:\d`, String.raw`Fetched \d`, 'Reading package lists', 'Building dependency tree',
  'Reading state information', 'Setting up ', 'Unpacking ', 'Selecting previously', 'Preparing to unpack', 'Processing triggers',
  'npm (?:WARN|notice)', String.raw`added \d+ packages`, String.raw`audited \d+ packages`, String.raw`\d+ packages are looking for funding`,
  'run `npm fund`', '.*[━█▉#]{3,}', String.raw`.*\d+(?:\.\d+)?\/\d+(?:\.\d+)? ?[kMG]B`, String.raw`\[\s*\d+%\]`, 'Compiling ', 'Downloaded ',
  'Pushed', 'Layer already exists', 'Waiting', 'Pulling fs layer', 'Download complete', 'Pull complete', 'Verifying Checksum', 'Extracting',
  'Resolving', 'Receiving objects', 'Counting objects', 'Compressing objects', 'remote: ', '正在', '下载中', '已下载',
]
const PROGRESS = new RegExp(String.raw`^\s*(?:${PROGRESS_LINES.join('|')})`, 'u')
/** Cookie notices, page navigation and footers, and advertising. */
const FRAME = new RegExp([
  'Cookie', 'cookie', '版权所有', '©', 'ICP备', '继续浏览即表示同意', '使用 Cookie', String.raw`首页\s*\|`, String.raw`登录\s*\|\s*注册`, 'Sponsored',
  String.raw`\[广告\]`, '广告：', '推广：', '限时特惠', '立即申请', '点击立即', '猜你喜欢', '下载 App', '弹窗',
].join('|'), 'u')
const IMAGE = /data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]{100,}/u
const GUARD = [
  /\b(?:error|errors|failed|failure|fatal|emerg|exception|traceback|denied|refused|not found|cannot|could not)\b/iu,
  /\b(?:must|never|do not|don't|required?)\b/iu,
  /^E\s|FAILED|[A-Z][a-z]+Error\b/mu,
  /(?:错误|失败|报错|异常|无法|不能|不得|禁止|必须|不要|要求|规定|条款|过敏)/u,
] as const

/** Why a fragment is certain noise. */
export type ReflexNoiseKind = 'duplicate' | 'image' | 'progress' | 'frame'

/**
 * Classify one fragment as certain noise. Callers visit fragments newest first, so an earlier exact copy of a later
 * fragment is the one classified as a duplicate.
 * @param text - Original fragment text.
 * @param seen - Normalized texts of fragments already visited; this call adds the fragment.
 * @returns The noise kind, or undefined when the fragment needs a judgement.
 */
export function reflexNoiseKind(text: string, seen: Set<string>): ReflexNoiseKind | undefined {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (seen.has(normalized)) return 'duplicate'
  seen.add(normalized)
  const lines = text.split('\n').filter(line => line.trim().length > 0)
  if (IMAGE.test(text) && text.replace(IMAGE, '').trim().length < 40) return 'image'
  if (lines.filter(line => PROGRESS.test(line)).length >= lines.length * 0.75) return 'progress'
  if (lines.filter(line => FRAME.test(line)).length >= lines.length * 0.75) return 'frame'
  return undefined
}

/**
 * Whether a fragment names an error, failure, requirement, or allergy, which the sweep never removes.
 * @param text - Original fragment text.
 * @returns True when the fragment must stay visible.
 */
export function isGuardedFragment(text: string): boolean {
  return GUARD.some(pattern => pattern.test(text))
}
