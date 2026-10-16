/** Live A/B scenarios for the Reflex compaction sweep: noisy tool output surrounds the facts each final answer needs. */

/** One scenario: user turns in order and the substrings the last answer must contain. */
export interface SweepScenario {
  readonly name: string
  readonly turns: readonly string[]
  /** Every group must have at least one substring in the final answer. */
  readonly expect: readonly (readonly string[])[]
}

const noise = {
  pip: (n: number) => `for i in $(seq 1 ${String(n)}); do echo "Downloading package_number_$i-1.0.$i-py3-none-any.whl (1.$i MB)"; done`,
  apt: (n: number) => `for i in $(seq 1 ${String(n)}); do echo "Get:$i http://deb.debian.org/debian bookworm/main amd64 libexample$i amd64 1.$i [$i kB]"; done`,
  npm: (n: number) => `for i in $(seq 1 ${String(n)}); do echo "npm WARN deprecated some-old-package-$i@1.0.$i: This module is no longer supported"; done`,
  build: (n: number) => `for i in $(seq 1 ${String(n)}); do echo "[ $((i*100/${String(n)}))%] Building C object CMakeFiles/app.dir/src/module_$i.c.o"; done`,
  weather: (n: number) => `for i in $(seq 1 ${String(n)}); do echo "Weather report for city number $i: sunny, $((i%30)) degrees, wind $((i%9)) km/h"; done`,
  news: (n: number) => `for i in $(seq 1 ${String(n)}); do echo "News headline $i: the city council discussed park benches and bicycle lanes on Tuesday"; done`,
  ads: (n: number) => `for i in $(seq 1 ${String(n)}); do echo "广告 $i：限时特惠！办理信用卡送 $i 元餐饮券，点击立即申请。本网站使用 Cookie 改善浏览体验。"; done`,
  oldOrders: (n: number) => `for i in $(seq 1 ${String(n)}); do echo "历史订单 $i：上个月购买的洗衣凝珠第 $i 批，已签收，与本次无关。"; done`,
}
/** A command that prints fixed text; the text must not contain single quotes. */
const show = (text: string): string => `printf '%s\\n' '${text.replaceAll('\n', "' '")}'`

/** Ask for every command, followed by three noise commands, to run separately, then for the final answer. */
function task(intro: string, facts: readonly string[], question: string): string {
  // Extra noise after the facts makes every scenario cross the compaction threshold in both arms.
  const commands = [...facts, noise.news(90), noise.apt(100), noise.weather(90)]
  return `${intro}请用 bash 工具依次运行下面 ${String(commands.length)} 条命令，每条单独调用一次，不要合并也不要跳过。全部运行完以后，${question}\n`
    + commands.map((command, index) => `${String(index + 1)}. ${command}`).join('\n')
}

export const SWEEP_SCENARIOS: readonly SweepScenario[] = [
  { name: 'ops-nginx', expect: [['8080'], ['apache', 'Apache'], ['/data/site']], turns: [task('你在部署 nginx：要求监听 8080 端口，根目录是 /data/site。',
    [noise.apt(100), show('nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)'), noise.weather(90),
      show('tcp LISTEN 0 511 0.0.0.0:80 users:(("apache2",pid=211,fd=4))'), noise.apt(100), show('/data/site contains: index.html health assets/'), noise.news(90)],
    '用三句话说明：nginx 为什么启动失败、是哪个进程占了端口、应该怎样配置 8080 和根目录。')] },
  { name: 'py-test', expect: [['fuzzy'], ['2024-02-29', '闰年'], ['parse.py']], turns: [task('你在修复 tests/test_parse.py 里失败的测试，只允许改 src/parse.py。',
    [noise.pip(110), show('E Failed: DID NOT RAISE ValueError for parse_date("2024-02-30")'), noise.npm(100),
      show('src/parse.py:18: return dateutil.parser.parse(text, fuzzy=True)'), noise.news(90),
      show('tests/test_parse.py says: Do not change the tests. The parser must reject impossible dates but still accept 2024-02-29 (leap year).'), noise.weather(90)],
    '用三句话说明：测试为什么失败、根源在哪一行、修复时必须满足什么额外要求。')] },
  { name: 'build-c', expect: [['1.4.1'], ['1.4.2'], ['zlib', 'ZLIB']], turns: [task('你要把 /app 的 C 项目编译成功，测试会运行 cli --version 期望输出 1.4.2。',
    [noise.build(110), show('CMake Error at CMakeLists.txt:12 (find_package): Could not find a package configuration file provided by "ZLIB"'), noise.apt(100),
      show('src/version.h:3:#define CLI_VERSION "1.4.1"'), noise.build(110), noise.weather(80)],
    '用三句话说明：编译为什么失败、要装什么依赖、版本号还要改什么。')] },
  { name: 'data-sales', expect: [['amount_cents'], ['N/A'], ['2022']], turns: [task('你要用 /data/sales.csv 计算 2023 年每个地区的总销售额。',
    [noise.pip(100), show('date,region,product,amount_cents\n2023-01-03,North,widget,12050'), noise.news(90),
      show('grep N/A: 2023-07-14,East,widget,N/A'), noise.npm(100), show('grep 2022: 2022-12-31,North,widget,9900 (this row belongs to 2022)'), noise.weather(90)],
    '用三句话说明：金额在哪一列、单位是什么、计算前要先处理哪些脏数据或需要排除的行。')] },
  { name: 'life-dinner', expect: [['小南国'], ['花生']], turns: [task('周六晚上 6 点我要带全家吃饭：两个大人、一个 5 岁孩子，老婆对花生严重过敏，家在静安寺附近。',
    [noise.ads(60), show('搜索结果：小南国（静安店），南京西路 1601 号，距静安寺 600 米，本帮菜，有儿童座椅，人均 180 元，周六晚有空位。'), noise.oldOrders(80),
      show('搜索结果：花生酱汉堡屋，菜品大量使用花生酱，距静安寺 900 米，人均 90 元。'), noise.ads(60), show('搜索结果：鼎泰丰（浦东店），距静安寺 12 公里，人均 150 元。'), noise.weather(90)],
    '推荐一家餐厅并用两句话说明理由，要提到过敏方面的注意。')] },
  { name: 'life-schedule', expect: [['16'], ['wang.zong@example.com']], turns: [task('帮我约下周和王总开 1 小时会。他只有周二下午或周四上午有空，我周四上午要带女儿打疫苗。',
    [noise.ads(60), show('日历：下周二 14:00-15:00 部门周会；下周二 16:00 之后空闲。'), noise.oldOrders(80), show('日历：下周四 09:00-11:30 女儿疫苗接种。'),
      noise.news(90), show('王总助理邮件：王总下周二 15:00-17:00、周四 9:00-12:00 可以约。'), noise.ads(60), show('通讯录：王总邮箱 wang.zong@example.com')],
    '告诉我最合适的会议时间段，并给出确认邮件要发到的邮箱。')] },
  { name: 'research-ev', expect: [['128.4'], ['35.3']], turns: [task('调研 2024 年中国新能源汽车出口，要写有数据来源的要点。',
    [noise.ads(60), show('中国汽车工业协会：2024 年新能源汽车出口 128.4 万辆，同比增长 6.7%。'), noise.news(90),
      show('欧盟委员会：2024 年 10 月起对中国产电动车加征最高 35.3% 的反补贴税。'), noise.ads(60), show('论坛帖子：我家 Model 3 冬天续航掉了 30%，大家怎么看？'), noise.weather(90)],
    '用三句话写要点：出口总量、主要阻力，并注明数据来源。')] },
  { name: 'write-citywalk', expect: [['30'], ['8']], turns: [task('写一篇公众号文章《年轻人为什么爱上 City Walk》的开头，要引用真实数据。',
    [noise.ads(60), show('小红书数据：2023 年 citywalk 相关笔记同比增长超 30 倍。'), noise.news(90), show('马蜂窝报告：2023 年夏季 City Walk 搜索热度上涨 8 倍。'),
      noise.oldOrders(80), show('用户之前的要求：公众号文章不要用“家人们”“绝绝子”这类网络用语。'), noise.ads(60)],
    '写一段 150 字左右的开头，引用上面的两个数据并注明来源。')] },
  { name: 'tb-long', expect: [['8443'], ['orders_v2'], ['RETRY_LIMIT', 'retry_limit']], turns: [task('你在排查 orders-api 服务的问题。',
    [noise.pip(110), show('service:\n  name: orders-api\n  port: 8443\n  database: orders_v2'), noise.weather(90), noise.apt(100),
      show('FAILED tests/test_api.py::test_timeout - AssertionError: expected retry_limit 3, got 7\nsrc/settings.py:12: RETRY_LIMIT = 7'),
      noise.news(90), noise.npm(100), noise.build(110), noise.weather(90), noise.apt(100)],
    '用三句话告诉我：服务端口和数据库名是什么、测试为什么失败、下一步该改哪个文件的哪一行。')] },
  { name: 'topic-switch', expect: [['8443'], ['orders_v2']], turns: [
    task('你在排查 orders-api 服务的问题，先收集信息。',
      [noise.pip(110), show('service:\n  name: orders-api\n  port: 8443\n  database: orders_v2'), noise.weather(90), noise.apt(100), noise.news(90)],
      '只回复“信息已收集”。'),
    task('先插一件别的事：帮我看看今晚的电影。', [noise.ads(60), noise.news(90), noise.npm(100), noise.weather(90)], '用一句话推荐一部适合全家看的电影。'),
    '回到刚才 orders-api 的排查：服务端口和数据库名分别是什么？一句话回答。'] },
]
