/** DSH-authored layout experiments. The parent pack supplies its licensed visual style. */
import {refinementGuidance} from './refinement-guidance.mjs';
export const richLayoutSlugs = new Set(['blue-professional', 'broadside']);

export function richLayoutGuidance(slug) {
  if (!richLayoutSlugs.has(slug)) return '';
  return `## Expanded composition rules\n\nThis pack has twelve layouts. Start with the information relationship, then choose a reference page. Do not default to three equal cards or one chart per slide.\n\n${slug === 'blue-professional'
    ? 'Use evidence-led report compositions: an executive thesis beside supporting evidence, stacked trends with annotations, a contribution bridge, a portfolio matrix, a customer journey, a capability architecture, a case comparison, a dependency roadmap, and a decision table. Keep cream as the field and use cobalt to identify the decision or most important series.'
    : 'Use editorial rhythm: alternate a quiet cream evidence page, a black analytical page and an orange statement page. Combine oversized type with smaller supporting evidence; use a conversion staircase, causal feedback loop, effort/impact map, annotated case results, campaign storyboard, launch schedule and scorecard. Do not apply one recolored grid to every page.'}\n\nFor a deck of six or more content pages, use at least four distinct structural families when the material supports them. Avoid repeating the same family on adjacent slides. A detailed page should have one dominant argument, a supporting chart/diagram/table, and one concise interpretation. Alternate detailed evidence pages with simpler synthesis pages.\n\nAdapt the reference geometry to the real content. Add annotations, units, direct labels, baselines, owners and dependencies where they carry meaning. These examples use invented, explicitly marked sample data: replace every value and conclusion with user evidence; never fabricate data to make a page look fuller. Preserve native editable text and geometry. Do not turn all content into images. Keep body text around 18–22 pt and chart labels around 13–16 pt; reflow or split before shrinking.\n\nReference families: ${slug === 'blue-professional' ? '2 executive synthesis; 3 market segmentation; 4 stacked trend; 5 opportunity matrix; 6 profit bridge; 7 customer journey; 8 service architecture; 9 case study; 10 delivery roadmap; 11 decision table' : '2 editorial thesis; 3 evidence spread; 4 operating model comparison; 5 feedback loop; 6 conversion staircase; 7 priority map; 8 campaign storyboard; 9 case study; 10 launch schedule; 11 performance scorecard'}.\n\n` + refinementGuidance;
}

export function createRichLayouts(s, lang, pairs, basicPages) {
  if (!richLayoutSlugs.has(s.slug)) return basicPages;
  const isBlue = s.slug === 'blue-professional';
  const tr = (en, zh) => lang === 'en' ? en : zh;
  const pages = [basicPages[0]];
  let elements = [], serial = 0, bg = s.bg, ink = s.ink;
  const text = (en, zh, x, y, w, h, size = 18, opt = {}) => {
    const { display = false, ...style } = opt;
    elements.push({ elementId: `t${++serial}`, elementType: 'text', bounds: [x,y,w,h], content: {
      text: tr(en,zh), fontFamily: display ? pairs.title : pairs.body,
      fontSize: size, color: '#' + ink, lineHeight: 1.12, bold: display, ...style
    }});
  };
  const rect = (x,y,w,h,fill=s.surface,stroke,shape='rect') => elements.push({
    elementId: `s${++serial}`, elementType:'shape', bounds:[x,y,w,h], shapeName:shape,
    fill:{type:'solid',color:'#'+fill}, border:{width:stroke ? .7 : 0,color:'#'+(stroke || fill)}
  });
  const line = (x1,y1,x2,y2,color=ink,width=.7) => {
    const x=Math.min(x1,x2), y=Math.min(y1,y2), w=Math.max(1,Math.abs(x2-x1)), h=Math.max(1,Math.abs(y2-y1));
    elements.push({elementId:`l${++serial}`,elementType:'line',bounds:[x,y,w,h],viewBox:[w,h],points:`${x1-x},${y1-y} ${x2-x},${y2-y}`,border:{width,color:'#'+color}});
  };
  const arrow = (x1,y1,x2,y2,color=s.accent) => {
    line(x1,y1,x2,y2,color,1.5);
    if (y1===y2) { const k=x2>x1?-6:6;line(x2+k,y2-4,x2,y2,color,1.5);line(x2+k,y2+4,x2,y2,color,1.5); }
    else { const k=y2>y1?-6:6;line(x2-4,y2+k,x2,y2,color,1.5);line(x2+4,y2+k,x2,y2,color,1.5); }
  };
  const start = (en,zh,section,sectionZh,background=s.bg,foreground=s.ink) => {
    elements=[];serial=0;bg=background;ink=foreground;
    text(section,sectionZh,48,26,820,20,11,{color:'#'+(isBlue?s.accent:ink)});
    line(48,57,912,57,isBlue?'C9C8BC':ink,.5);
    text(en,zh,48,78,864,68,isBlue?34:37,{display:true});
  };
  const save = (name,zh,family,summary,columns=2) => {
    text('ILLUSTRATIVE DATA / LAYOUT STUDY','版式示例 / 数据为模拟值',48,507,760,16,9);
    text(String(pages.length+1).padStart(2,'0'),String(pages.length+1).padStart(2,'0'),870,504,42,22,11);
    pages.push({name:tr(name,zh),family,columns,density:'high',summary,
      page:{pageType:'content',background:{type:'solid',color:'#'+bg},notes:'DSH-authored composition experiment using the parent pack palette and typography. All figures are fictional demonstration data; replace with actual evidence.',elements}});
  };
  const note = (en,zh,y=475) => {line(48,y-10,912,y-10,isBlue?'C9C8BC':ink,.4);text(en,zh,48,y,864,25,13);};
  const dot = (x,y,r,fill=s.accent) => rect(x-r,y-r,r*2,r*2,fill,undefined,'ellipse');

  if (isBlue) {
    start('A focused route to profitable growth','聚焦可盈利的增长路径','01 / EXECUTIVE BRIEF','01 / 管理层摘要');
    text('Prioritize the\nregional core','优先做深\n区域核心市场',48,171,328,134,38,{display:true});
    text('+18%','+18%',48,330,300,87,68,{color:'#'+s.accent});
    text('Revenue in the sample plan','示例方案中的营收增幅',50,420,320,35,17);
    line(407,171,407,458,'B7B8B2');
    [['Demand','需求','Repeat buyers drive 62% of revenue.','复购客户贡献 62% 的营收。'],['Delivery','交付','Two regional hubs cut handling time.','两座区域中心缩短处理时间。'],['Investment','投入','Fund routing before adding capacity.','先改善调度，再增加运力。']].forEach(([a,b,c,d],i)=>{
      const y=173+i*96;text('0'+(i+1),'0'+(i+1),438,y,45,25,15,{color:'#'+s.accent});text(a,b,500,y-3,392,35,23,{display:true});text(c,d,500,y+40,392,44,18);line(438,y+82,912,y+82,'C9C8BC');
    });
    save('Executive synthesis','管理层综合判断','insights','Asymmetric thesis, one dominant metric and three evidence rows');

    start('Where the addressable demand sits','可服务需求的分布','02 / MARKET SEGMENTATION','02 / 市场分层');
    const segments=[['Enterprise','大客户',48,'1E2BFA'],['Mid-market','中型客户',32,'737BF5'],['Small business','小型客户',20,'C8CBFA']];
    let x=48;segments.forEach(([a,b,v,c])=>{const w=558*v/100;rect(x,191,w,113,c);text(v+'%',v+'%',x+16,209,w-25,48,34,{color:'#'+(v===48?'FFFFFF':'111111')});x+=w;});
    segments.forEach(([a,b,v,c],i)=>{dot(54,334+i*43,5,c);text(a,b,73,322+i*43,226,32,18);text(v+'%',v+'%',490,322+i*43,116,32,18,{align:'right'});});
    line(641,169,641,448,'C9C8BC');
    text('$240m','$240m',674,185,238,78,49,{color:'#'+s.accent});text('Serviceable market','可服务市场规模',674,277,238,45,20,{display:true});
    text('Focus on repeat freight in two dense regional corridors.','聚焦两条高密度区域走廊的重复货运需求。',674,350,238,103,20);
    note('Segmentation basis: annual customer spend; all shares use the same denominator.','分层依据：客户年度支出；所有占比采用同一分母。');
    save('Market segmentation','市场分层','data','Proportional market bar, direct legend and opportunity sizing');

    start('Recurring demand carries the expansion','持续性需求支撑业务扩张','03 / REVENUE MIX','03 / 收入结构');
    const base=[42,48,53,61,65,72],newBiz=[18,20,23,25,29,33];
    text('A / REVENUE MIX · $m','A / 收入结构 · 百万美元',48,153,516,24,11);
    rect(108,177,9,9,s.accent);text('Recurring','持续性收入',124,172,157,23,11);rect(300,177,9,9,'A1A7FA');text('New business','新增业务',316,172,210,23,11);
    for(let v=0;v<=120;v+=40){const y=407-v*1.52;line(92,y,604,y,'D1D1C5',.5);text(String(v),String(v),48,y-10,35,22,11,{align:'right'});}
    for(let i=0;i<6;i++){const x=111+i*82,scale=1.52;rect(x,407-base[i]*scale,43,base[i]*scale,s.accent);rect(x,407-(base[i]+newBiz[i])*scale,43,newBiz[i]*scale,'A1A7FA');text(String(base[i]+newBiz[i]),String(base[i]+newBiz[i]),x-5,379-(base[i]+newBiz[i])*scale,60,25,14,{align:'center'});text('Q'+(i+1),'Q'+(i+1),x-2,417,56,25,12);}
    text('60 → 105','60 → 105',93,448,151,27,17,{display:true,color:'#'+s.accent});text('Total revenue over six quarters','六个季度的总收入变化',246,448,365,27,14);
    line(642,169,642,450,'C9C8BC');text('B / GROWTH CONTRIBUTION','B / 增长贡献',674,155,238,28,11);
    text('67%','67%',674,204,238,74,57,{color:'#'+s.accent});text('from recurring demand','来自持续性需求',674,285,238,51,20,{display:true});
    [['Recurring','持续性收入','+30'],['New business','新增业务','+15'],['Total change','合计增长','+45']].forEach(([a,b,v],i)=>{const y=344+i*36;line(674,y-7,912,y-7,'C9C8BC',.5);text(a,b,674,y,165,28,14,{display:i===2});text(v,v,839,y-1,73,29,19,{align:'right',color:'#'+s.accent});});
    note('Readout: recurring revenue contributes 30 of the $45m revenue growth; protect the installed base.','解读：持续性收入贡献 4,500 万美元增长中的 3,000 万，应重视存量客户。');
    save('Stacked trend and interpretation','堆叠趋势与解读','data','Stacked columns on a common scale with a derived contribution callout');

    start('Choose markets by return and readiness','按回报与准备度选择市场','04 / OPPORTUNITY MAP','04 / 机会地图');
    rect(90,175,502,270,'F1EEDB');rect(341,175,251,135,'E2E3F8');
    line(90,310,592,310,'A7AAA6');line(341,175,341,445,'A7AAA6');
    text('BUILD CAPABILITY','补齐能力',107,184,217,24,11);text('PRIORITIZE','优先投入',358,184,210,24,11,{color:'#'+s.accent});text('MONITOR','持续观察',107,412,216,24,11);text('SELECTIVELY SERVE','择优服务',358,412,223,24,11);
    [[202,272,13,'West','西区'],[461,246,20,'Core','核心'],[383,281,12,'North','北区'],[267,368,9,'New','新区'],[487,372,14,'East','东区']].forEach(([x,y,r,a,b])=>{dot(x,y,r);text(a,b,x+23,y-12,93,27,14);});
    text('LOW','低',90,455,60,28,12);text('Operational readiness','运营准备度',180,455,318,28,12,{align:'center'});text('HIGH','高',531,455,61,28,12,{align:'right'});
    text('Return potential: higher toward the top','越靠上：潜在回报越高',90,146,525,22,12);
    text('Fund the core first','优先投入核心市场',650,189,258,69,28,{display:true});text('High readiness makes the near-term plan easier to execute.','准备度较高，使近期计划更容易落地。',650,282,258,95,21);text('Bubble area = market size','圆面积代表市场规模',650,410,258,40,14);
    save('Opportunity matrix','机会矩阵','comparison','Two-axis market map, sized markers and a separate decision rationale');

    start('The margin bridge makes the tradeoffs visible','用利润桥呈现增长的代价','05 / ECONOMICS','05 / 经营测算');
    text('A / OPERATING PROFIT · $m','A / 经营利润 · 百万美元',48,153,579,23,11);
    const bridge=[['Base','基期',0,12],['Volume','规模',12,18],['Service','服务',15,18],['Launch','启动',13,15],['Plan','计划',0,13]];
    for(const v of [0,5,10,15,20]){const y=427-v*10;line(91,y,625,y,'D1D1C5',.5);text(String(v),String(v),48,y-9,31,23,11,{align:'right'});}
    bridge.forEach(([a,b,lo,hi],i)=>{const x=100+i*106,y=427-hi*10;rect(x,y,61,(hi-lo)*10,i===0||i===4?s.accent:i===1?'929AFF':'BCBEB9');text(['12','+6','−3','−2','13'][i],['12','+6','−3','−2','13'][i],x-5,y-31,71,28,20,{align:'center'});text(a,b,x-17,439,95,27,13,{align:'center'});if(i<4){const end=[12,18,15,13][i];line(x+61,427-end*10,x+106,427-end*10,'A0A09A');}});
    line(652,169,652,451,'C9C8BC');text('B / THE NET RESULT','B / 净结果',679,160,233,25,11);
    text('+8.3%','+8.3%',679,205,233,85,54,{color:'#'+s.accent});text('profit growth after costs','扣除成本后的利润增长',679,294,233,49,19,{display:true});
    [['Scale benefit','规模收益','+6'],['Service + launch','服务与启动','−5'],['Net profit change','利润净变化','+1']].forEach(([a,b,v],i)=>{const y=351+i*35;line(679,y-7,912,y-7,'C9C8BC',.5);text(a,b,679,y,171,27,14,{display:i===2});text(v,v,850,y-2,62,30,19,{align:'right',color:'#'+s.accent});});
    note('Decision: test service and launch costs first; they absorb five-sixths of the scale benefit.','决策：先验证服务与启动成本，两者消耗了规模收益的六分之五。');
    save('Profit bridge','利润桥','data','Editable waterfall with sequential baselines and a reconciled net change');

    start('Find the friction between intent and delivery','定位意图到交付之间的阻力','06 / CUSTOMER JOURNEY','06 / 客户旅程');
    const stages=[['Discover','发现','Compare options','比较方案','Search / referral','搜索 / 推荐','84%'],['Book','下单','Confirm a quote','确认报价','Quote desk','报价团队','56%'],['Track','跟踪','Check the status','查询状态','Tracking link','运单链接','91%'],['Repeat','复购','Book again','再次下单','Account owner','客户负责人','68%']];
    stages.forEach(([a,b,c,d,e,f,v],i)=>{const x=48+i*220;text('0'+(i+1),'0'+(i+1),x,164,196,24,13,{color:'#'+s.accent});text(a,b,x,200,196,46,27,{display:true});if(i<3)arrow(x+162,222,x+207,222);line(x,267,x+196,267,'BFBFB5');text(c,d,x,289,196,58,19);text(e,f,x,369,196,51,16);text(v,v,x,429,196,43,30,{color:'#'+s.accent});});
    rect(268,268,196,5,s.accent);text('Independent stage success rates / improve quoting first','各阶段成功率独立统计 / 优先改善报价',48,474,864,24,15,{color:'#'+s.accent});
    save('Customer journey','客户旅程','process','Sequential journey with action, touchpoint and per-stage success measure',4);

    start('A service system with clear handoffs','明确交接关系的服务系统','07 / OPERATING MODEL','07 / 运营模型');
    const rows=[['PLAN','计划',['Demand forecast','需求预测'],['Capacity plan','运力计划'],['Route design','线路设计']],['EXECUTE','执行',['Order intake','订单接入'],['Dispatch','调度'],['Delivery','配送']],['LEARN','学习',['Service data','服务数据'],['Issue review','问题复盘'],['Route updates','线路更新']]];
    rows.forEach(([a,b,...nodes],i)=>{const y=173+i*104;text(a,b,48,y+22,104,32,15,{color:'#'+s.accent});nodes.forEach(([c,d],j)=>{const x=170+j*172;rect(x,y,150,69,i===1?s.accent:'E9E8E0');text(c,d,x+12,y+17,126,49,18,{color:'#'+(i===1?'FFFFFF':s.ink),align:'center'});if(j<2)arrow(x+151,y+35,x+170,y+35,isBlue?s.accent:ink);});if(i<2)arrow(417,y+71,417,y+102);});
    line(708,173,708,454,'C9C8BC');text('One owner\nat each handoff','每次交接\n都有负责人',741,190,168,98,28,{display:true});text('Measure waiting time, not only team output.','衡量团队产出\n及交接等待时间',741,329,168,117,19);
    save('Service architecture','服务架构','process','Three operating layers with horizontal handoffs and vertical feedback',3);

    start('A regional pilot: lower waiting, higher repeat','区域试点：等待减少，复购提升','08 / CASE STUDY','08 / 案例拆解');
    text('THE CHANGE','关键改变',48,169,280,28,12,{color:'#'+s.accent});text('One queue.\nOne accountable owner.','统一队列。\n责任到人。',48,220,285,122,32,{display:true});text('Eight-week pilot across two regional depots.','在两个区域仓开展为期八周的试点。',48,371,282,78,20);
    line(371,170,371,455,'C9C8BC');
    [['Quote wait / hours','报价等待 / 小时',18,7,20,'18 → 7'],['Repeat booking / %','复购率 / %',42,61,70,'42 → 61']].forEach(([a,b,v1,v2,max,label],i)=>{const y=173+i*148;text(a,b,413,y,493,28,18,{display:true});rect(413,y+49,332*v1/max,23,'C1C2B7');rect(413,y+81,332*v2/max,23,s.accent);text(label,label,763,y+50,149,45,25,{color:'#'+s.accent});});
    note('Comparison: before / after pilot. Sample observations do not establish causality.','比较口径：试点前 / 后。模拟观察值不构成因果结论。');
    save('Annotated case comparison','带注释的案例对比','comparison','Asymmetric intervention narrative with paired before/after evidence');

    start('The first 90 days of implementation','实施计划的前 90 天','09 / DELIVERY ROADMAP','09 / 交付路线图');
    ['MONTH 1','MONTH 2','MONTH 3'].forEach((a,i)=>text(a,['第 1 月','第 2 月','第 3 月'][i],298+i*189,164,175,24,13,{color:'#'+s.accent}));
    for(let i=0;i<=3;i++)line(286+i*189,196,286+i*189,422,'CACBBF',.6);
    [['Baseline & owners','基线与责任人',0,1.05,'Operations','运营'],['Routing pilot','调度试点',.6,1.2,'Product','产品'],['Scale decision','扩展决策',1.8,1.2,'Leadership','管理层']].forEach(([a,b,start,len,owner,ownerZh],i)=>{const y=204+i*75;text(a,b,48,y,218,32,20,{display:true});text(owner,ownerZh,48,y+34,218,22,13);rect(287+start*189,y+9,len*189,29,i===1?s.accent:'9EA5F4');});
    dot(626,441,6);text('Gate: expand only after pilot targets are met','决策门槛：达到试点目标后再扩展',48,462,864,31,18);line(626,196,626,441,s.accent,1);
    save('Dependency roadmap','依赖关系路线图','process','Timed workstreams, named owners and a decision gate',3);

    start('A decision with explicit evaluation criteria','按明确标准作出决策','10 / INVESTMENT CHOICE','10 / 投入选择');
    const cols=[48,366,550,734];
    rect(350,175,178,282,'E1E3FA');
    [['CRITERION','评估标准'],['Routing first','先做调度'],['Capacity first','先扩运力'],['No change','维持现状']].forEach(([a,b],i)=>text(a,b,cols[i],183,i?167:274,54,i?20:12,{display:i>0,color:'#'+(i===1?s.accent:ink)}));
    [['Investment','投入','$0.8m','$2.4m','$0'],['Payback','回收周期','9 months','18 months','—'],['Service uplift','服务提升','High','Medium','Low'],['Execution risk','执行风险','Medium','High','Low']].forEach(([a,b,...v],i)=>{const y=254+i*49;line(48,y-8,912,y-8,'C3C4BA');text(a,b,48,y,280,33,17);v.forEach((a,j)=>text(a,({'9 months':'9 个月','18 months':'18 个月','High':'高','Medium':'中','Low':'低'})[a]||a,cols[j+1],y,165,35,17));});
    note('Recommendation: validate routing in the pilot, then revisit capacity investment.','建议：先在试点验证调度改善，再评估运力投入。');
    save('Decision table','决策表','comparison','Four criteria across three options, highlighted recommendation and next gate',4);
  } else {
    start('own the next move','把下一步握在手里','01 / THE POSITION','01 / 核心立场');
    text('01','01',48,155,300,177,142,{display:true,color:'#'+s.accent});
    text('Fewer handoffs.\nMore ownership.','减少交接。\n明确责任。',392,179,520,113,39,{display:true});
    line(392,321,912,321,'5D5D55');text('Give one team the complete journey, from first request to a repeat order.','让一个团队负责从首次需求到再次下单的完整旅程。',392,351,500,112,25);
    text('THE OPERATING BET','这次运营试验的选择',48,382,288,53,16,{color:'#'+s.accent});
    save('Editorial thesis','编辑式主张','insights','Oversized chapter numeral against a compact operating thesis');

    start('where requests get stuck','需求卡在哪里','02 / THE FRICTION','02 / 阻力所在','F0ECE5','111111');
    text('42%','42%',48,165,447,164,125,{display:true});text('wait for another team','等待另一团队',54,335,426,47,25,{display:true});
    text('A / REQUESTS WITH A SECOND-TEAM WAIT','A / 需要等待第二团队的需求',54,410,427,32,10);
    line(521,169,521,451,'A7A69D');text('B / DELAY REASONS · SHARE OF DELAYS','B / 等待原因 · 占所有等待的比例',555,153,357,26,10);
    [['Quote review','报价复核',42],['Scheduling','排期',33],['Other','其他',25]].forEach(([a,b,v],i)=>{const y=193+i*67;text(a,b,555,y,285,27,17,{display:true});rect(555,y+32,274*v/42,13,i===0?s.accent:'ABADA3');text(v+'%',v+'%',850,y+18,62,31,20);});
    line(555,401,912,401,'A7A69D');text('FIRST MOVE','先做什么',555,416,98,25,10,{display:true});text('Name the quote owner.','明确报价责任人。',664,411,248,48,18,{display:true});
    note('Two measures: 42% of requests wait; quote review accounts for 42% of those delays.','两个口径：42% 的需求发生等待；报价复核占这些等待的 42%。');
    save('Evidence spread','证据跨栏','data','One editorial statistic and a ranked breakdown on a cream field');

    start('change who owns the outcome','改变结果的归属方式','03 / THE OPERATING SHIFT','03 / 运营方式变化');
    line(480,176,480,460,'66665F');text('BEFORE','原来',48,173,390,32,15,{color:'#'+s.accent});text('AFTER','现在',520,173,390,32,15,{color:'#'+s.accent});
    text('5','5',48,215,370,122,93,{display:true});text('1','1',520,215,370,122,93,{display:true,color:'#'+s.accent});
    text('handoffs per request','每次需求的交接次数',48,355,390,47,25,{display:true});text('accountable team','全程负责的团队',520,355,390,47,25,{display:true});
    text('Separate queues. Local targets.','独立队列，各自考核。',48,421,390,40,18);text('One queue. A shared service goal.','统一队列，共同服务目标。',520,421,390,40,18);
    save('Operating model contrast','运营模型对照','comparison','Big numerical contrast with aligned ownership and workflow differences');

    start('build a loop that learns','建立能持续学习的回路','04 / THE MECHANISM','04 / 作用机制');
    const nodes=[[69,185,'LISTEN','倾听'],[358,185,'TRY','试验'],[358,376,'MEASURE','衡量'],[69,376,'ADJUST','调整']];
    arrow(245,214,355,214);arrow(437,249,437,370);arrow(356,407,251,407);arrow(150,375,150,252);
    nodes.forEach(([x,y,a,b],i)=>{line(x,y,x+171,y,s.accent,2);text(a,b,x,y+14,185,45,24,{display:true});});
    text('7 days','7 天',189,281,247,55,39,{display:true,color:'#'+s.accent});text('one complete cycle','完成一次完整循环',190,336,245,32,17);
    line(606,177,606,453,'5B5B53');text('CLOSE\nTHE LOOP','让反馈\n形成闭环',649,198,260,114,35,{display:true});text('Every test ends with a decision and a named owner.','每次试验都以一项决策和一名负责人收尾。',649,350,260,103,22);
    save('Learning feedback loop','学习反馈回路','process','Four-step closed loop with cycle time and an ownership annotation');

    start('where the journey loses people','用户在哪一步离开','05 / CONVERSION','05 / 转化');
    const funnel=[['VISIT','访问',100,188],['START','开始',68,259],['FINISH','完成',41,330],['RETURN','返回',29,401]];
    text('A / COHORT INDEX · FIRST STAGE = 100','A / 群体指数 · 首阶段 = 100',48,153,556,23,11);
    funnel.forEach(([a,b,v,y],i)=>{const w=470*v/100;rect(48,y,w,42,i===0?s.accent:i===1?'C9653E':i===2?'995E46':'6F5144');text(a,b,61,y+9,180,28,16,{display:true,color:'#'+(i===0?'111111':'F0ECE5')});text(String(v),String(v),554,y+2,79,39,27,{display:true});if(i<3){const next=[68,41,29][i],conversion=Math.round(next/v*100);text(conversion+'% continue',conversion+'% 继续',48,y+46,243,25,11,{color:'#B4B4A9'});}});
    line(675,182,675,450,'5E5E56');text('B / THE BOTTLENECK','B / 瓶颈',706,166,206,27,11);
    text('27','27',706,208,206,92,70,{display:true,color:'#'+s.accent});text('points lost before completion','完成前流失的百分点',706,309,206,88,23);
    line(706,411,912,411,'5E5E56');text('68 − 41 = 27','68 − 41 = 27',706,427,206,28,16);
    note('Only 60% of starters finish. Improve this handoff before increasing traffic.','开始后完成的比例约为 60%；增加流量前，先改善这一环节。');
    save('Conversion staircase','转化阶梯','data','Proportional descending bars, direct counts and a quantified bottleneck');

    start('do the high-impact work first','优先做高影响的事','06 / PRIORITY MAP','06 / 优先级地图','F0ECE5','111111');
    rect(75,174,503,273,'E4DFD5');rect(75,174,251,136,'EFC3B1');line(326,174,326,447,'96958B');line(75,310,578,310,'96958B');
    text('DO NOW','马上做',92,186,212,26,14,{display:true});text('PLAN NEXT','排期做',345,186,210,26,14,{display:true});
    [[164,247,'A'],[238,278,'B'],[445,256,'C'],[390,372,'D']].forEach(([x,y,a])=>{dot(x,y,17,s.accent);text(a,a,x-12,y-13,24,30,18,{display:true,align:'center',color:'#111111'});});
    text('Effort: low → high','投入：低 → 高',75,455,501,27,14);text('Impact increases upward','越靠上：影响越大',75,147,501,22,12);
    [['A','Fix the first reply','改善首次回复'],['B','Name the owner','明确负责人'],['C','Rebuild routing','重建调度'],['D','Add reporting','增加报表']].forEach(([a,b,c],i)=>{const y=181+i*68;text(a,a,624,y,44,30,20,{display:true,color:'#B34016'});text(b,c,681,y,231,51,20);line(624,y+53,912,y+53,'B2B0A6');});
    save('Effort and impact map','投入与影响地图','comparison','Prioritization scatter linked by letters to an action register');

    start('give the campaign a sequence','让活动按节奏推进','07 / CAMPAIGN STORY','07 / 活动叙事');
    const story=[['01','THE QUESTION','提出问题','Why does a simple order need five handoffs?','为什么一个简单订单需要五次交接？','Hook / awareness','切入点 / 认知'],['02','THE PROOF','展示证据','Show one request moving through the new flow.','展示一个需求如何通过新的流程。','Demo / consideration','演示 / 评估'],['03','THE ASK','给出行动','Invite one team to run the next pilot.','邀请一个团队参与下一轮试点。','Pilot / action','试点 / 行动']];
    story.forEach(([num,a,b,c,d,e,f],i)=>{const x=48+i*296;text(num,num,x,159,261,95,72,{display:true,color:'#'+s.accent});line(x,271,x+261,271,'6C6C64');text(a,b,x,291,261,42,20,{display:true});text(c,d,x,351,261,84,21);text(e,f,x,455,261,26,13);});
    save('Campaign storyboard','活动故事板','agenda','Three narrative beats with oversized sequence numbers and a specific audience action',3);

    start('show the change, not just the claim','把改变摆出来','08 / PILOT RESULTS','08 / 试点结果','E85D26','111111');
    text('54 → 82','54 → 82',48,176,864,142,96,{display:true});text('completed requests / 100 starts','每 100 次开始中完成的需求数',52,326,839,42,26,{display:true});
    line(48,399,912,399,'111111');
    [['8 weeks','8 周','Pilot length','试点周期'],['2 teams','2 个团队','Shared queue','共用队列'],['+28 pts','+28 点','Completion lift','完成率提升']].forEach(([a,b,c,d],i)=>{const x=48+i*296;text(a,b,x,418,268,38,25,{display:true});text(c,d,x,464,268,23,14);});
    save('Case results poster','案例成果海报','comparison','Single dominant before/after result with trial scope and duration',3);

    start('a launch plan with a decision gate','带决策门槛的启动计划','09 / THE FIRST SIX WEEKS','09 / 前六周计划');
    for(let i=0;i<6;i++){const x=263+i*106;text('W'+(i+1),'第'+(i+1)+'周',x,167,96,26,13);line(x,204,x,431,'46463F');}
    [['FRAME','定义',0,2,'Choose one flow','选定一条流程'],['BUILD','搭建',1,3,'Make it usable','做到可用'],['RUN','运行',3,2,'Observe real work','观察实际使用'],['DECIDE','决策',5,1,'Expand or revise','扩展或调整']].forEach(([a,b,start,len,c,d],i)=>{const y=210+i*60;text(a,b,48,y,187,28,18,{display:true});rect(264+start*106,y,len*106-10,30,i===3?s.accent:'707068');});
    text('Gate / Week 6','门槛 / 第六周',48,458,203,27,16,{color:'#'+s.accent});text('Expand only if completion improves without longer waits.','仅在完成率提高且等待未变长时扩展。',263,456,649,36,18);
    save('Launch schedule','启动排期','process','Staggered six-week timeline with a conditional expansion gate',4);

    start('keep the score visible','让结果持续可见','10 / THE SCORECARD','10 / 指标看板');
    const metrics=[['Completion','完成率','82%','75%',82,75],['Repeat use','重复使用','61%','60%',61,60],['Same-day reply','当日回复','90%','95%',90,95],['Owner assigned','责任已分配','96%','100%',96,100]];
    text('METRIC','指标',48,170,287,26,12);text('ACTUAL','实际',339,170,154,26,12);text('TARGET','目标',515,170,157,26,12);text('PROGRESS / 0–100%','进度 / 0–100%',693,170,219,26,11);
    metrics.forEach(([a,b,v,t,n,goal],i)=>{const y=221+i*61;line(48,y-11,912,y-11,'53534C');text(a,b,48,y,263,34,20,{display:true});text(v,v,339,y,154,34,23,{color:'#'+s.accent});text(t,t,515,y,151,34,20);rect(694,y+8,201,15,'34342E');rect(694,y+8,201*n/100,15,s.accent);line(694+201*goal/100,y+2,694+201*goal/100,y+29,'F0ECE5',1.5);});
    note('A white tick marks the target. Investigate the reply gap before expanding.','白色刻线表示目标。扩展前先调查回复时效差距。');
    save('Performance scorecard','业绩计分表','data','Aligned metric table with actual/target values and native bullet bars',4);
  }
  // Preserve the quiet original ending, but use the new slide number.
  const closing=structuredClone(basicPages.at(-1));
  const pageNo=closing.page.elements.find(e=>e.elementType==='text' && e.bounds[0]===870);
  if(pageNo)pageNo.content.text='12';
  pages.push(closing);
  if(pages.length!==12)throw new Error(`Expected twelve experimental layouts for ${s.slug}`);
  return pages;
}
