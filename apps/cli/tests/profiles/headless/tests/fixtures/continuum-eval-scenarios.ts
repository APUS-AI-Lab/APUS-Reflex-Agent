/** Personal-agent memory scenarios for the live Continuum A/B evaluation. */
import { lifePadding } from './continuum-live-conversation.ts'

/** One graded question asked after the history it depends on. */
export interface EvalQuestion {
  readonly ask: string
  /** Every group must match the answer; a group matches when any of its alternatives appears. */
  readonly expect: readonly (readonly string[])[]
  /** Minimum number of groups that must match; defaults to every group. */
  readonly minGroups?: number
  /** Text whose presence in the recall shows the needed memory reached the model; empty for no-recall questions. */
  readonly recallHint?: string
  /** True when the question needs no memory, so recall must stay empty. */
  readonly unrelated?: true
}

/** One scenario: the conversation before the questions, and the questions. */
export interface EvalScenario {
  readonly id: string
  readonly title: string
  /** Summary output budget for both modes; omitted keeps the overlay default of 2048 tokens. */
  readonly summaryTokens?: number
  readonly history: readonly string[]
  readonly questions: readonly EvalQuestion[]
}

let article = 0
const pad = (count: number): string[] => Array.from({ length: count }, () => lifePadding(++article))
const chat = (text: string): string => `${text}（闲聊，随便回一句就行）`

/** The scenario catalog; each history forces several compactions in the 24K live window. */
export const SCENARIOS: readonly EvalScenario[] = [
  {
    id: 's1-dense',
    title: '信息密集：大量个人事实的精确值',
    history: [
      '记一下家里的信息：我妈生日是 3 月 14 日，我爸生日是 11 月 2 日，我老婆生日是 8 月 27 日。',
      chat('今天地铁好挤'),
      ...pad(2),
      '车的信息：车牌是浙A·7K3M2，保险每年 9 月 5 日到期，周五限行。',
      '女儿小米在育才小学三年级二班，班主任是王丽老师。',
      ...pad(2),
      '家里住址是西溪路 188 号 3 幢 1202 室，宽带账号尾号 4471，WiFi 密码是 Mango2024!',
      '我爸每天早上吃一片氨氯地平降血压，别让他忘了。',
      ...pad(2),
      '我老婆衣服穿 M 码，鞋子 37 码，喜欢白色桔梗。',
      '家里养了一只柯基叫豆包，每天喂两顿狗粮。',
      ...pad(2),
    ],
    questions: [
      { ask: '我妈生日是哪天？一句话回答。', expect: [['3 月 14', '3月14']], recallHint: '3 月 14' },
      { ask: '帮我查一下车牌号和保险到期日，一句话回答。', expect: [['7K3M2'], ['9 月 5', '9月5']], recallHint: '7K3M2' },
      { ask: '家里 WiFi 密码多少？只回答密码。', expect: [['Mango2024!']], recallHint: 'Mango2024!' },
      { ask: '我爸每天要吃什么药？一句话回答。', expect: [['氨氯地平']], recallHint: '氨氯地平' },
      { ask: '想给老婆买双鞋，买多大的？一句话回答。', expect: [['37']], recallHint: '37 码' },
      { ask: '小米的班主任是谁？一句话回答。', expect: [['王丽']], recallHint: '王丽' },
    ],
  },
  {
    id: 's2-corrections',
    title: '多次修改：现在的值与最初的值',
    history: [
      '我现在住在文三路 20 号。',
      '牙医预约在 5 月 6 日下午三点。',
      '这次装修预算先定 10 万。',
      ...pad(2),
      '跟你说下，我搬家了，新地址是古墩路 66 号。',
      '牙医那边改期了，改到 5 月 9 日上午十点。',
      ...pad(2),
      '装修预算调整一下，改成 12 万。',
      '又搬了一次家，现在住在良渚文化村玉鸟路 8 号。',
      ...pad(2),
      '牙医又改了，最终定在 5 月 12 日下午两点。',
      '装修预算最后定为 15 万，不再改了。',
      ...pad(2),
    ],
    questions: [
      { ask: '我现在住哪？一句话回答。', expect: [['玉鸟路']], recallHint: '玉鸟路' },
      { ask: '我最早跟你说的住址是哪里？一句话回答。', expect: [['文三路']], recallHint: '文三路' },
      { ask: '牙医最终约在哪天几点？一句话回答。', expect: [['5 月 12', '5月12'], ['两点', '2 点', '2:00', '2：00', '14']], recallHint: '5 月 12' },
      { ask: '装修预算前后改过哪些数字？最后是多少？', expect: [['10 万', '10万'], ['12 万', '12万'], ['15 万', '15万']], recallHint: '15 万' },
    ],
  },
  {
    id: 's3-verbatim',
    title: '原话：引用与固定格式',
    history: [
      '我跟老板说的原话是：“这个项目我只能做到周五，再晚我就不接了。”帮我记着。',
      '以后帮我写邮件，开头一律用“您好，见字如面”，结尾用“顺颂商祺，阿杰”。',
      ...pad(5),
    ],
    questions: [
      { ask: '我跟老板说的原话是什么？请逐字复述。', expect: [['只能做到周五'], ['再晚我就不接了']], recallHint: '再晚我就不接了' },
      { ask: '帮我写一封很短的请假邮件，明天请一天假。', expect: [['见字如面'], ['顺颂商祺']], recallHint: '见字如面' },
    ],
  },
  {
    id: 's4-composition',
    title: '组合约束：一个请求同时满足多位家人的限制',
    history: [
      '我爸腿脚不好，不能爬山，也走不了太远。',
      chat('今天下雨了'),
      ...pad(2),
      '我妈晕车，坐不了长途大巴。',
      '女儿小米怕狗，见到狗就哭。',
      ...pad(2),
      '儿子乐乐最喜欢恐龙。',
      '老婆不吃辣。这周六全家只有一天空，总预算 3000 元以内。',
      ...pad(2),
    ],
    questions: [
      {
        ask: '帮我安排这周六全家的一日游，四五句话说清楚去哪、怎么去、吃什么。',
        expect: [['爬山', '平地', '走路少', '不用走太远', '腿脚'], ['晕车', '大巴', '自驾', '地铁'], ['狗'], ['恐龙'], ['辣'], ['3000']],
        minGroups: 4,
        recallHint: '晕车',
      },
    ],
  },
  {
    id: 's5-long-horizon',
    title: '远期记忆：十几次压缩之后的早期事实',
    history: [
      '我和老婆的结婚纪念日是 6 月 18 日，今年想给她惊喜。',
      '我是 O 型血，护照 2027 年 3 月到期。',
      chat('最近睡得不太好'),
      ...pad(4),
      chat('周末打算去爬山'),
      ...pad(4),
      chat('刚看完一部电影'),
      ...pad(4),
    ],
    questions: [
      { ask: '我们结婚纪念日是哪天？一句话回答。', expect: [['6 月 18', '6月18']], recallHint: '6 月 18' },
      { ask: '我的护照什么时候到期？一句话回答。', expect: [['2027']], recallHint: '2027' },
      { ask: '我爸是什么血型？如果我没说过就直说不知道。', expect: [['不知道', '没有提到', '没提到', '没说过', '没有说过', '未提及', '不清楚']] },
      { ask: '用一句话说说你最喜欢的季节，不要调用任何工具。', expect: [['春', '夏', '秋', '冬']], unrelated: true },
    ],
  },
  {
    id: 's7-implicit',
    title: '隐含关联：问题与事实没有共同词',
    history: [
      '乐乐特别怕高，上次坐摩天轮吓哭了。他最喜欢恐龙。',
      chat('今天好累'),
      ...pad(2),
      '小米对猫毛过敏，一碰就打喷嚏。',
      '我的车尾号是 5，周五限行。',
      ...pad(3),
    ],
    questions: [
      { ask: '周末带孩子去哪玩比较好？一句话建议。', expect: [['恐龙']], recallHint: '恐龙' },
      { ask: '想给家里添个宠物，你有什么建议？一句话。', expect: [['猫毛', '过敏']], recallHint: '猫毛' },
      { ask: '这周五我能开车去公司吗？一句话。', expect: [['限行']], recallHint: '限行' },
    ],
  },
  {
    id: 's8-casual-dense',
    title: '随口提到的大量事实（摘要预算 384）',
    summaryTokens: 384,
    history: [
      '早上送小米上学，她说下周三学校开运动会，要穿白色运动鞋。对了豆包昨天打了狂犬疫苗，下次是 11 月 20 日。',
      chat('今天天气不错'),
      '中午跟同事老周吃饭，他说他女儿也在育才小学。我顺便把体检预约改到了 10 月 30 号上午八点，在市一医院东院。',
      ...pad(2),
      '晚上我妈打电话说她血压有点高，医生让她把缬沙坦从一片加到一片半。家里燃气费这个月 186 元，记得 25 号前交。',
      '老婆说她想报个瑜伽课，周二周四晚上七点，一次 120 元。乐乐的乐高课换老师了，新老师姓陈。',
      ...pad(2),
      '周末想去舅舅家，他住在滨江区江南大道 1088 号，停车要停 B2。小米最近迷上了画画，最喜欢紫色。',
      '我车的机油上次是 4 月换的，里程 23500 公里，下次 28500 公里要换。乐乐幼儿园班主任是刘老师，电话尾号 6621。',
      ...pad(2),
      '我爸下个月 12 号要去北京开会，住在国贸附近。家里洗衣机保修到明年 3 月。',
      chat('有点困了'),
      ...pad(2),
    ],
    questions: [
      { ask: '豆包下次打疫苗是哪天？一句话。', expect: [['11 月 20', '11月20']], recallHint: '11 月 20' },
      { ask: '我体检约在什么时候、哪家医院？一句话。', expect: [['10 月 30', '10月30'], ['东院']], recallHint: '东院' },
      { ask: '我妈现在缬沙坦吃多少？一句话。', expect: [['一片半', '1.5']], recallHint: '一片半' },
      { ask: '这个月燃气费多少、几号前交？一句话。', expect: [['186'], ['25']], recallHint: '186' },
      { ask: '去舅舅家车停哪一层？一句话。', expect: [['B2']], recallHint: 'B2' },
      { ask: '我的车下次多少公里换机油？一句话。', expect: [['28500']], recallHint: '28500' },
      { ask: '乐乐幼儿园班主任电话尾号是多少？一句话。', expect: [['6621']], recallHint: '6621' },
      { ask: '小米运动会那天要穿什么鞋？一句话。', expect: [['白色']], recallHint: '白色运动鞋' },
    ],
  },
  {
    id: 's9-identifiers',
    title: '精确标识：长串字符（摘要预算 384）',
    summaryTokens: 384,
    history: [
      '我网购的空气净化器快递单号是 SF1428830957263，顺丰的。',
      '下个月去成都的机票：CA4112，座位 32K，订单号 7731-0294-5582。',
      ...pad(2),
      '酒店确认号是 HZ88K2Q7，入住人写的是我老婆。',
      '家里新门锁的临时密码是 905127，记得周日前改掉。',
      ...pad(2),
      '公司报销单号 BX-2026-10-0473，金额 2316.50 元。',
      ...pad(2),
    ],
    questions: [
      { ask: '空气净化器的快递单号是多少？只回答单号。', expect: [['SF1428830957263']], recallHint: 'SF1428830957263' },
      { ask: '去成都的航班号和座位？一句话。', expect: [['CA4112'], ['32K']], recallHint: '32K' },
      { ask: '机票订单号是多少？只回答订单号。', expect: [['7731-0294-5582']], recallHint: '7731-0294-5582' },
      { ask: '酒店确认号是多少？只回答确认号。', expect: [['HZ88K2Q7']], recallHint: 'HZ88K2Q7' },
      { ask: '门锁临时密码是多少？只回答密码。', expect: [['905127']], recallHint: '905127' },
      { ask: '报销单号和金额？一句话。', expect: [['BX-2026-10-0473'], ['2316.5']], recallHint: 'BX-2026-10-0473' },
    ],
  },
  {
    id: 's10-evolving',
    title: '多次演变：跨多次压缩改了四次（摘要预算 384）',
    summaryTokens: 384,
    history: [
      '小米的钢琴课定在每周六上午 9 点。',
      ...pad(2),
      '钢琴课改了，改到周六下午 2 点。',
      ...pad(2),
      '钢琴老师那边又调整了，改到周日上午 10 点。',
      ...pad(2),
      '最后定下来了：钢琴课每周三晚上 7 点，不再改了。',
      ...pad(2),
    ],
    questions: [
      { ask: '小米的钢琴课现在是什么时间？一句话。', expect: [['周三', '星期三'], ['7 点', '7点', '19']], recallHint: '周三晚上 7 点' },
      { ask: '钢琴课时间前后改过哪几次？按顺序列出来。', expect: [['周六上午'], ['周六下午'], ['周日'], ['周三']], recallHint: '周六上午 9 点' },
    ],
  },
]
