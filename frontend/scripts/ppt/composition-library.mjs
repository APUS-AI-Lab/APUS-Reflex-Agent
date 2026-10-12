/** DSH-authored native compositions. Palettes and typography remain with the licensed parent packs. */
const plans = {
  'dsh-soft-editorial': ['editorial', 'thesis evidence tree trend case timeline matrix storyboard scorecard roadmap'],
  'dsh-editorial-forest': ['report', 'thesis trend bridge evidence matrix journey case architecture scorecard roadmap'],
  'dsh-signal': ['strategy', 'thesis tree trend matrix bridge case journey experiment scorecard roadmap'],
  'dsh-monochrome': ['research', 'thesis evidence journey tree trend matrix experiment case rubric roadmap'],
  'dsh-neo-grid-bold': ['growth', 'thesis funnel trend tree matrix architecture bridge case scorecard roadmap'],
  'dsh-sakura-chroma': ['campaign', 'thesis storyboard journey evidence funnel matrix experiment case timeline roadmap'],
  'dsh-playful': ['creative', 'thesis storyboard tree journey experiment funnel case matrix scorecard roadmap'],
  'dsh-cartesian': ['strategy', 'thesis tree evidence matrix trend experiment bridge case scorecard roadmap'],
  'dsh-engineering-blueprint': ['engineering', 'thesis architecture sequence tree trend matrix experiment case scorecard roadmap'],
  'dsh-course-workshop': ['learning', 'thesis tree storyboard rubric trend journey experiment case timeline roadmap'],
  'dsh-editorial-notebook': ['editorial', 'thesis evidence timeline tree trend matrix case experiment scorecard roadmap'],
  'curated-swiss-signal-grid': ['logistics', 'bridge matrix'],
  'curated-modular-logistics-system': ['logistics', 'network sequence'],
  'curated-nordic-operating-report': ['logistics', 'bridge roadmap'],
};
const topics = {
 editorial: [['A judgment worth revisiting','值得重新审视的判断'],['Observation','观察'],['Meaning','解释'],['Evidence','证据'],['Next action','下一步行动'],['Start with the source. Leave room for a different explanation.','从资料出发\n为不同解释留出空间']],
 report: [['A more resilient operating cycle','更稳健的经营周期'],['Demand','需求'],['Capacity','产能'],['Service','服务'],['Investment','投入'],['Protect service quality while improving the use of existing capacity.','提高现有产能利用率，同时守住服务质量。']],
 strategy: [['Turn uncertainty into a decision','把不确定性变成可执行决策'],['Market','市场'],['Capability','能力'],['Economics','经济性'],['Execution','执行'],['Validate the core assumption before committing the full investment.','在全面投入前，先验证核心假设。']],
 research: [['Understand the moments that matter','理解真正关键的用户时刻'],['Context','情境'],['Behavior','行为'],['Friction','阻力'],['Outcome','结果'],['Observe real tasks and separate participant evidence from interpretation.','观察真实任务，区分用户证据与研究者解释。']],
 growth: [['Find the next repeatable growth loop','找到下一个可复制的增长循环'],['Reach','触达'],['Activation','激活'],['Retention','留存'],['Expansion','扩展'],['Fix the activation bottleneck before increasing acquisition spend.','先修复激活瓶颈，再增加获客投入。']],
 campaign: [['Design a campaign people can follow','设计用户愿意参与的活动'],['Attention','关注'],['Interest','兴趣'],['Participation','参与'],['Return','再次参与'],['Make each touchpoint useful and give people a reason to return.','让每次触达都有价值，让用户有理由再次参与。']],
 creative: [['Make the idea easier to try','让创意更容易被尝试'],['Notice','发现'],['Play','体验'],['Make','创作'],['Share','分享'],['Invite one small action, then let the result inspire the next one.','邀请用户完成一个小行动，再用结果激发下一步。']],
 engineering: [['Make the system easier to reason about','让系统更容易被理解和验证'],['Ingress','接入'],['Processing','处理'],['Storage','存储'],['Telemetry','观测'],['Expose contracts and failure paths before adding another service.','先明确接口和故障路径\n再考虑增加服务']],
 learning: [['From guided practice to independent work','从引导练习走向独立完成'],['Understand','理解'],['Try','尝试'],['Explain','解释'],['Transfer','迁移'],['Use a new example to verify that the learner can apply the method.','用一个新案例，验证学习者能否运用方法。']],
 logistics: [['Connect the plan to the operating network','把计划连接到运营网络'],['Demand','需求'],['Routing','调度'],['Fulfillment','履约'],['Service','服务'],['Make queue time and handoff ownership visible across the network.','让网络中的排队时间和交接责任清晰可见。']],
};
export const compositionPlans = Object.fromEntries(Object.entries(plans).map(([slug,[topic,recipes]])=>[slug,{topic,recipes:recipes.split(' ')}]));

export function createCompositions(meta, lang) {
 const slug=meta.definition.referenceDirectory.split('/').at(-1), plan=compositionPlans[slug];
 if(!plan) return [];
 const p=meta.definition.palette, fonts=meta.definition.fonts;
 const pairs={};
 for(const role of ['title','body']) {
  const serif=/Georgia|Times/i.test(fonts.en[role]), k=serif?'serif':'sans';
  const fallback=fonts.fallbacks.zh;
  pairs[role]={latin:fonts.en[role],mac:fallback.macOS[role]??fallback.macOS[k],win:fallback.Windows[role]??fallback.Windows[k],ea:fallback.Linux[role]??fallback.Linux[k]};
 }
 const topic=topics[plan.topic], tr=(v)=>typeof v==='string'?v:v[lang==='en'?0:1];
 let elements=[],id=0,bg=p.background,ink=p.text,accent=p.accent,surface=p.surface;
 const lum=c=>{const v=c.match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};
 const contrast=c=>lum(c)>.37?'181915':'F8F6EE';
 const blend=(a,b,t=.18)=>a.match(/../g).map((v,i)=>Math.round(parseInt(v,16)*(1-t)+parseInt(b.slice(i*2,i*2+2),16)*t).toString(16).padStart(2,'0')).join('');
 const t=(v,x,y,w,h,size=18,o={})=>{const {display=false,...style}=o;elements.push({elementId:'t'+ ++id,elementType:'text',bounds:[x,y,w,h],content:{text:tr(v),fontFamily:pairs[display?'title':'body'],fontSize:size,lineHeight:1.1,color:'#'+ink,bold:display&&!/Georgia/i.test(fonts.en.title),...style}});};
 const box=(x,y,w,h,fill=surface,stroke,shape='rect')=>elements.push({elementId:'s'+ ++id,elementType:'shape',bounds:[x,y,w,h],shapeName:shape,fill:{type:'solid',color:'#'+fill},border:{width:stroke?.8:0,color:'#'+(stroke??fill)}});
 const line=(x1,y1,x2,y2,c=ink,width=.6)=>{if(c===accent&&(Math.max(lum(c),lum(bg))+.05)/(Math.min(lum(c),lum(bg))+.05)<2.5)c=blend(c,ink,.6);const x=Math.min(x1,x2),y=Math.min(y1,y2),w=Math.max(1,Math.abs(x2-x1)),h=Math.max(1,Math.abs(y2-y1));elements.push({elementId:'l'+ ++id,elementType:'line',bounds:[x,y,w,h],viewBox:[w,h],points:`${x1-x},${y1-y} ${x2-x},${y2-y}`,border:{width,color:'#'+c}});};
 const arrow=(x1,y1,x2,y2,c=accent)=>{line(x1,y1,x2,y2,c,1.2);const a=Math.atan2(y2-y1,x2-x1);for(const d of [-.55,.55])line(x2-7*Math.cos(a+d),y2-7*Math.sin(a+d),x2,y2,c,1.2);};
 const dot=(x,y,r,c=accent)=>box(x-r,y-r,2*r,2*r,c,undefined,'ellipse');
 const label=(v,x,y,w=240)=>t(v,x,y,w,25,13);
 const note=v=>{line(48,465,912,465,blend(bg,ink,.22));t(v,48,475,864,25,13);};
 const unit=(v,x=48,y=152)=>label(v,x,y,850);
 const node=(v,x,y,w=162,h=58,em=false)=>{const fill=em?accent:surface;box(x,y,w,h,fill,slug.includes('blueprint')||slug.includes('modular')?ink:undefined,slug==='dsh-playful'?'roundRect':'rect');t(v,x+12,y+13,w-24,h-19,18,{color:'#'+contrast(fill),align:'center'});};
 const start=(title,k)=>{
  elements=[];id=0;bg=p.background;ink=p.text;accent=p.accent;surface=p.surface;
  if(slug==='dsh-editorial-forest'&&k%4===2){bg='EFE7D4';ink='2E4A2A';surface='DADFCB';accent='785348';}
  if(slug==='dsh-neo-grid-bold'&&k%4===2){bg='151611';ink='F5F4EF';surface='2B2D23';}
  if(slug==='dsh-playful'&&k%4===2){bg='1A1A1A';ink='F0C8A0';accent='F0C8A0';surface='3D3129';}
  if(slug.includes('nordic')&&k%2===0){bg='0B2A3A';ink='F3F0EA';surface='183E4D';}
  if(slug==='dsh-engineering-blueprint') for(let x=48;x<=912;x+=24)line(x,150,x,458,blend(bg,ink,.065),.35);
  if(slug==='dsh-engineering-blueprint') for(let y=150;y<=458;y+=24)line(48,y,912,y,blend(bg,ink,.065),.35);
  if(slug==='curated-swiss-signal-grid'){box(0,0,18,540,'111111');box(48,57,54,3,accent);}
  if(slug.includes('modular')){box(0,0,960,8,accent);box(48,25,18,18,accent);}
  if(slug.includes('nordic'))box(0,0,8,540,accent);
  if(slug==='dsh-sakura-chroma') ['E54489','F09131','547A46'].forEach((c,i)=>box(754+i*53,27,48,13,c));
  if(slug==='dsh-playful'){dot(882,37,14,accent);dot(916,37,8,ink);}
  if(slug==='dsh-neo-grid-bold') for(let r=0;r<3;r++)for(let c=0;c<3;c++)if((r+c)%2===0)box(868+c*10,24+r*10,10,10,accent);
  t(meta.definition.name.toUpperCase(),48+(slug.includes('modular')?28:0),27,665,20,10);
  line(48,59,912,59,blend(bg,ink,.3));
  t(title,48,76,864,64,32,{display:true});
  t(['EXHIBIT '+String(k+1).padStart(2,'0'),'图示 '+String(k+1).padStart(2,'0')],754,46,158,13,9,{align:'right',color:'#'+blend(bg,ink,.7)});
 };
 const recipes={
  thesis:()=>{
   label(['THE WORKING POSITION','当前主张'],48,164,348);
   t(topic[5],48,207,332,177,30,{display:true});
   line(48,403,374,403,blend(bg,ink,.25));
   t(['Start small. Learn before scaling.','小步验证，再扩大投入。'],48,420,330,43,17);
   line(414,167,414,449,blend(bg,ink,.3));
   const status=[['RECORD','记录'],['QUESTION','问题'],['DECISION','决策']];
   [1,2,3].forEach((n,i)=>{const y=170+i*94;
    t('0'+n,441,y-3,50,38,26,{display:true,color:'#'+blend(bg,ink,.55)});
    t(topic[n],514,y,249,32,23,{display:true});
    t(status[i],780,y+6,132,24,10,{align:'right',color:'#'+blend(bg,ink,.7)});
    t([['What does the observed work tell us?','实际工作透露了什么？'],['Which assumption could change the plan?','哪个假设会改变计划？'],['What evidence would justify the next step?','什么证据足以支持下一步？']][i],514,y+41,398,47,18);
    line(441,y+83,912,y+83,blend(bg,ink,.22));
   });
  },
  evidence:()=>{
   box(48,176,277,274,surface);
   t(['FIELD NOTE / 03','现场笔记 / 03'],69,190,235,23,10,{color:'#'+contrast(surface)});
   t(['Clear first step.\nUnclear handoff.','第一步很清楚\n交接时却不确定'],69,238,232,130,28,{display:true,color:'#'+contrast(surface)});
   line(69,390,304,390,blend(surface,contrast(surface),.35));
   t(['Invented interview excerpt','自编访谈示例'],69,410,234,27,12,{color:'#'+contrast(surface)});
   t('3 / 8',362,166,190,68,48,{display:true});
   t(['cases paused at the handoff','个案例在交接时停顿'],555,176,347,48,22,{display:true});
   for(let i=0;i<8;i++)box(364+i*22,241,14,14,i<3?ink:blend(bg,ink,.18));
   t(['SIMULATED OBSERVATIONS','模拟观察'],561,238,351,25,10,{color:'#'+blend(bg,ink,.7)});
   const rows=[['01 / Reading','01 / 解读','The next owner was not visible.','下一位负责人未明确显示。'],['02 / Alternative','02 / 另一种解释','The task itself may be unfamiliar.','也可能是任务本身不够熟悉。'],['03 / Next test','03 / 下一次验证','Name the owner; repeat the same task.','明确负责人，再次执行相同任务。']];
   rows.forEach(([a,b,c,d],i)=>{const y=282+i*57;line(362,y,912,y,blend(bg,ink,.22));t([a,b],362,y+11,175,34,15,{bold:true});t([c,d],556,y+10,352,47,17);});
   note(['Keep the observation, alternative explanation and next test separate.','区分观察、其他可能的解释，以及下一步验证。']);
  },
  tree:()=>{
   unit(['HYPOTHESIS MAP / EACH BRANCH NEEDS EVIDENCE','假设地图 / 每个分支都需要证据']);
   node(topic[0],48,272,219,105,true);
   const tips=plan.topic==='engineering'?[['Retry budget','重试预算'],['Queue depth','队列深度'],['Read latency','读取延迟'],['Write durability','写入持久性'],['Trace coverage','链路覆盖'],['Alert precision','告警准确性']]:plan.topic==='learning'?[['Name the inputs','识别输入'],['Explain the rule','解释规则'],['Apply one step','完成一步'],['Check the result','检查结果'],['Use a new case','使用新案例'],['Explain the transfer','解释迁移']]:[['User evidence','用户证据'],['Observed limits','观察到的限制'],['Available resources','可用资源'],['Missing capability','能力缺口'],['Expected value','预期价值'],['Cost to validate','验证成本']];
   (plan.topic==='engineering'||plan.topic==='learning'?[1,2,4]:[1,2,3]).forEach((n,i)=>{const y=184+i*98;line(287,324,287,y+29);arrow(287,y+29,347,y+29);node(topic[n],350,y,170,58);arrow(520,y+29,566,y+29);for(let j=0;j<2;j++){const yy=y-7+j*42;line(566,y+29,566,yy+15);line(566,yy+15,596,yy+15);t(tips[i*2+j],608,yy,299,34,18);}});line(267,324,287,324,accent,1.2);
   note(['A useful branch can be confirmed or rejected independently.','每个有效分支都应能够被单独确认或否定。']);
  },
  trend:()=>{
   const learning=plan.topic==='learning', vals=learning?[34,42,61,59,76,88]:[100,108,114,112,128,142], max=learning?100:160;
   unit(learning?['A / TASK SCORE · 0–100','A / 任务得分 · 0–100']:['A / WEEKLY INDEX · BASELINE = 100','A / 每周指数 · 基期 = 100']);
   box(328,190,91,236,blend(bg,accent,.10));
   for(let v=0;v<=max;v+=max/4){const y=426-v/max*224;line(87,y,615,y,blend(bg,ink,.15),.5);t(String(v),48,y-10,30,22,11,{align:'right',color:'#'+blend(bg,ink,.7)});}
   // Keep the highlighted observation separate from its explanatory callout.
   const xx=i=>104+i*98, yy=v=>426-v/max*224;
   vals.forEach((v,i)=>{const x=xx(i),y=yy(v);if(i)line(xx(i-1),yy(vals[i-1]),x,y,ink,1.8);dot(x,y,i===3?5:3.2,i===3?accent:ink);t(String(v),x-23,y-30,47,25,15,{align:'center',bold:i===5});t('W'+(i+1),x-16,437,37,24,12,{align:'center'});});
   label(['W4 / PAUSE','W4 / 停顿'],274,186,155);line(365,210,xx(3),yy(vals[3])-10,blend(bg,ink,.5));
   line(652,169,652,450,blend(bg,ink,.3));
   label(['B / WHAT CHANGED','B / 变化解读'],679,163,233);
   t(learning?'+54':'+42%',679,202,233,78,56,{display:true});
   t(learning?['score points over six weeks','六周得分提升']:['growth from the starting index','相对基期的增长'],679,286,229,55,18);
   line(679,354,912,354,blend(bg,ink,.25));
   t(['CHECK NEXT','下一步检查'],679,369,229,22,10,{bold:true});
   t(['Why did progress pause in week four?','第四周为何出现停顿？'],679,404,229,50,20,{display:true});
   note(['Readout: the direction is positive; the week-four pause still needs an explanation.','解读：整体方向向好；第四周的停顿仍需解释。']);
  },
  matrix:()=>{
   unit(['A / PRIORITY MAP · IMPACT INCREASES UPWARD','A / 优先级地图 · 越靠上影响越大']);
   box(89,184,497,252,blend(bg,ink,.035));box(338,184,248,126,blend(bg,accent,.20));line(338,184,338,436,blend(bg,ink,.28));line(89,310,586,310,blend(bg,ink,.28));
   t(['INVESTIGATE','继续研究'],103,194,214,23,10);t(['PRIORITIZE','优先投入'],354,194,214,23,10,{bold:true});t(['MONITOR','持续观察'],103,409,214,23,10);t(['SCHEDULE','安排实施'],354,409,214,23,10);
   [[184,266,'A'],[431,255,'B'],[382,289,'C'],[227,354,'D'],[483,362,'E']].forEach(([x,y,v])=>{dot(x,y,v==='B'?13:7,v==='B'?ink:blend(bg,ink,.48));t(v,x+18,y-12,38,28,15,{bold:v==='B'});});
   t(['Lower confidence','置信度较低'],89,442,238,22,11);t(['Higher confidence','置信度较高'],352,442,234,22,11,{align:'right'});
   label(['B / RECOMMENDED ACTION','B / 建议行动'],632,173,280);
   t(['Validate B first','先验证 B'],632,215,280,62,32,{display:true});
   const rows=[[['Potential','潜力'],['High impact','影响较大']],[['Evidence','证据'],['Stronger signal','信号较强']],[['Commitment','投入'],['A bounded pilot','范围明确的试点']]];
   rows.forEach(([a,b],i)=>{const y=305+i*46;line(632,y-6,912,y-6,blend(bg,ink,.22));t(a,632,y+6,110,31,14);t(b,753,y+6,159,34,16,{bold:true});});
   note(['Decision: test B first; keep the other candidates visible until the evidence changes.','决策：先验证 B；保留其他候选行动，随证据更新重新评估。']);
  },
  journey:()=>{
   const phases=plan.topic==='research'?[['Find','发现'],['Choose','选择'],['Start','开始'],['Return','返回']]:topic.slice(1,5);
   const actions=plan.topic==='learning'?[['Read an example','阅读示例'],['Do one task','完成任务'],['Give a reason','解释理由'],['Try a new case','尝试新案例']]:[['Compare options','比较方案'],['Commit to a step','确定下一步'],['See the result','看到结果'],['Decide what follows','决定后续行动']];
   ['STAGE','ACTION','SIGNAL'].forEach((v,i)=>t([v,['阶段','行动','信号'][i]],48,188+i*94,115,30,12));
   phases.forEach((v,i)=>{const x=183+i*183;node(v,x,174,167,63,i===1);if(i<3)arrow(x+168,207,x+181,207);t(actions[i],x,279,159,62,20);t(['62%','48%','76%','58%'][i],x,368,159,55,35,{display:true});});
   line(48,260,912,260,blend(bg,ink,.25));line(48,353,912,353,blend(bg,ink,.25));
   note(['Independent stage success rates. Inspect the weakest handoff first.','各阶段成功率独立统计，优先检查最薄弱的交接点。']);
  },
  architecture:()=>{
   const names=plan.topic==='engineering'?[['Client','客户端'],['API gateway','接口网关'],['Auth','身份认证'],['Queue','队列'],['Worker','任务执行'],['Storage','存储'],['Logs','日志'],['Metrics','指标'],['Traces','链路']]:[['Signals','信号'],['Planning','计划'],['Allocation','分配'],['Intake','接入'],['Delivery','交付'],['Support','支持'],['Measures','衡量'],['Review','复盘'],['Updates','更新']];
   const layers=plan.topic==='engineering'?[['INTERFACE','接口'],['RUNTIME','运行'],['OBSERVABILITY','观测']]:[['PLAN','计划'],['OPERATE','执行'],['LEARN','学习']];
   for(let r=0;r<3;r++){const y=176+r*98;label(layers[r],48,y+20,126);for(let c=0;c<3;c++){const x=191+c*160;node(names[r*3+c],x,y,143,63,r===1);if(c<2)arrow(x+144,y+31,x+159,y+31);}if(r<2)arrow(423,y+66,423,y+96);}
   line(703,176,703,451,blend(bg,ink,.35));t(['Make each boundary explicit','明确每一层边界'],737,184,172,111,28,{display:true});t(['Owner\nInput / output\nFailure policy','负责人\n输入与输出\n故障处理规则'],737,315,175,123,20);
   note(['Horizontal arrows: handoffs. Vertical arrows: dependencies.','横向箭头表示交接，纵向箭头表示依赖。']);
  },
  sequence:()=>{
   const actors=plan.topic==='engineering'?[['Client','客户端'],['Gateway','网关'],['Worker','执行器'],['Store','存储']]:[['Request','需求方'],['Dispatch','调度'],['Depot','仓库'],['Carrier','承运方']];
   actors.forEach((v,i)=>{const x=70+i*219;node(v,x,164,162,49);line(x+81,217,x+81,427,blend(bg,ink,.3));});
   const msgs=plan.topic==='engineering'?[['Submit + key','提交与幂等键'],['Authorize / enqueue','鉴权并入队'],['Commit once','单次提交'],['Return status','返回状态']]:[['Confirm the order','确认订单'],['Allocate inventory','分配库存'],['Reserve capacity','预留运力'],['Confirm the slot','确认时段']];
   [[151,370,250],[370,589,296],[589,808,342],[808,151,400]].forEach(([a,b,y],i)=>{arrow(a,y,b,y);t(msgs[i],Math.min(a,b)+15,y-30,Math.abs(b-a)-30,27,14,{align:'center'});});
   note(plan.topic==='engineering'?['Retry with the same key; handle timeout and cancellation explicitly.','重试使用相同幂等键；明确处理超时与取消。']:['Confirm inventory and capacity before promising a delivery slot.','承诺配送时段前，先确认库存和运力。']);
  },
  case:()=>{
   t(['THE INTERVENTION','关键改变'],48,168,290,26,12);t(plan.topic==='learning'?['Explain it.\nThen apply it.','先解释\n再应用']:['One visible next step','一个清晰可见的下一步'],48,217,288,121,34,{display:true});t(['A six-week pilot with a matched task definition.','六周模拟试点，采用一致的任务定义。'],48,369,281,78,20);line(376,172,376,453,blend(bg,ink,.3));
   const rows=plan.topic==='engineering'?[['Latency / ms','延迟 / 毫秒',180,72,200],['Error rate / %','错误率 / %',5,2,6]]:plan.topic==='learning'?[['Task score / 100','任务得分 / 100',42,76,100],['Help requests','求助次数',8,3,10]]:[['Wait / minutes','等待 / 分钟',18,7,20],['Completion / %','完成率 / %',46,73,100]];
   rows.forEach(([a,b,v1,v2,max],i)=>{const y=174+i*142;t([a,b],414,y,487,32,20,{display:true});box(415,y+51,324*v1/max,20,blend(bg,ink,.3));box(415,y+81,324*v2/max,20,accent);t(v1+' → '+v2,754,y+55,158,45,23,{display:true});});
   note(['Top bar: before. Bottom: after. Illustrative comparison, not a causal claim.','上方为试点前，下方为试点后。模拟对比不构成因果结论。']);
  },
  roadmap:()=>{
   t(['WORKSTREAM / OWNER','工作流 / 负责人'],48,167,243,23,11);
   ['W1–2','W3–4','W5–6','W7–8'].forEach((v,i)=>t(v,316+i*147,166,132,25,12));
   for(let i=0;i<=4;i++)line(304+i*147,198,304+i*147,440,blend(bg,ink,.16),.5);
   const tasks=plan.topic==='learning'?[['Guided example','引导示例'],['Independent practice','独立练习'],['Peer explanation','同伴讲解'],['Transfer task','迁移任务']]:plan.topic==='engineering'?[['Contract review','契约评审'],['Instrument the path','接入观测'],['Canary rollout','灰度发布'],['Expand / rollback','扩展或回滚']]:[['Baseline & scope','基线与范围'],['Build a small pilot','小规模试点'],['Evaluate evidence','评估证据'],['Decide the next step','确定下一步']];
   const owners=plan.topic==='learning'?[['Instructor','讲师'],['Learner','学习者'],['Peer group','同伴小组'],['Learner','学习者']]:plan.topic==='engineering'?[['Tech lead','技术负责人'],['Platform','平台团队'],['Service owner','服务负责人'],['On-call lead','值班负责人']]:[['Research','研究团队'],['Delivery','交付团队'],['Analytics','分析团队'],['Sponsor','项目负责人']];
   tasks.forEach((v,i)=>{const y=205+i*61;line(48,y-8,912,y-8,blend(bg,ink,.12));t(v,48,y,239,30,18,{display:true});t(owners[i],48,y+30,239,24,11,{color:'#'+blend(bg,ink,.68)});const starts=[0,.7,1.8,2.8],lengths=[.9,1.3,1.1,1.2];const x=305+starts[i]*147,w=lengths[i]*147;box(x,y+12,w,22,i===2?ink:blend(bg,ink,.27));dot(x+w,y+23,3,i===2?ink:blend(bg,ink,.55));});
   line(716,198,716,448,accent,1.2);dot(716,448,4);
   note(['Gate / W6: agree on evidence, owner and rollback conditions before expanding.','W6 决策门槛：扩大投入前，确认验证结果、负责人和回退条件。']);
  },
  scorecard:()=>{
   const engineering=plan.topic==='engineering';
   const names=engineering?[['Latency / ms','延迟 / 毫秒'],['Availability / %','可用性 / %'],['Recovery / min','恢复 / 分钟'],['Coverage / %','覆盖率 / %']]:[['Completion / %','完成率 / %'],['Wait / minutes','等待 / 分钟'],['Return rate / %','回访率 / %'],['Cost / task','单次任务成本']];
   const vals=engineering?[['72','< 100','Hold','保持'],['99.8','> 99.9','Review','复核'],['12','< 15','Hold','保持'],['86','> 90','Review','复核']]:[['73','> 70','Hold','保持'],['7','< 10','Hold','保持'],['58','> 65','Review','复核'],['$8','< $9','Hold','保持']];
   [[48,['MEASURE','指标']],[373,['ACTUAL','实际']],[523,['TARGET','目标']],[692,['RESPONSE','行动']]].forEach(([x,v])=>t(v,x,167,x===48?280:170,24,11));
   vals.forEach(([v,goal,a,b],i)=>{const y=204+i*61;
    if(a==='Review'){box(48,y,864,61,blend(bg,accent,.11));box(48,y,3,61,ink);}
    line(48,y,912,y,blend(bg,ink,.22));
    t(names[i],61,y+17,280,37,18,{display:true});t(v,373,y+10,129,45,28,{display:true});t(goal,523,y+20,145,33,17);
    t(a==='Review'?'↗':'—',692,y+19,27,30,18);t([a,b],735,y+20,158,30,16,{bold:a==='Review'});
   });
   note(['Review rows need a named owner and a next check; passing rows remain on the watch list.','待复核行需明确负责人和复核节点；已达标指标继续观察。']);
  },
  bridge:()=>{
   unit(['A / VALUE BRIDGE · INDEX POINTS','A / 价值桥 · 指数点']);
   const vals=[[0,100],[100,132],[119,132],[112,119],[0,112]], names=[['Baseline','基期'],['Volume','规模'],['Service','服务'],['Launch','启动'],['Result','结果']];
   for(const v of [0,50,100,150]){const y=423-v*1.4;line(88,y,622,y,blend(bg,ink,.12),.5);t(String(v),48,y-9,30,23,10,{align:'right',color:'#'+blend(bg,ink,.66)});}
   vals.forEach(([lo,hi],i)=>{const x=96+i*105,y=423-hi*1.4;box(x,y,60,(hi-lo)*1.4,i===0||i===4?ink:blend(bg,ink,i===1?.52:.25));t(['100','+32','−13','−7','112'][i],x-10,y-33,80,28,20,{align:'center',bold:i===4});t(names[i],x-18,436,99,26,13,{align:'center'});if(i<4){const end=[100,132,119,112][i];line(x+60,423-end*1.4,x+105,423-end*1.4,blend(bg,ink,.45));}});
   line(654,172,654,451,blend(bg,ink,.3));label(['B / NET EFFECT','B / 净影响'],679,166,233);
   t('+12%',679,205,233,77,57,{display:true});t(['net of costs','扣除成本后'],679,289,233,40,18);
   [[['Benefit','收益'],'+32'],[['Costs','成本'],'−20'],[['Net change','净变化'],'+12']].forEach(([label,value],i)=>{const y=344+i*36;line(679,y-7,912,y-7,blend(bg,ink,.22));t(label,679,y,147,30,15,{bold:i===2});t(value,826,y-2,86,31,20,{align:'right',bold:i===2});});
   note(['Readout: 20 of the 32 benefit points are absorbed by service and launch costs.','解读：32 点收益中，有 20 点被服务与启动成本消耗。']);
  },
  storyboard:()=>{
   const stages=plan.topic==='learning'?[['See the example','观察示例'],['Make a prediction','作出预测'],['Explain the result','解释结果']]:[['A useful invitation','有用的邀请'],['A small interaction','轻量的互动'],['A reason to return','再次参与的理由']];
   for(let i=0;i<3;i++){const x=48+i*294;box(x,171,270,150,i===1?accent:surface,slug==='dsh-playful'?ink:undefined);const fg=contrast(i===1?accent:surface);if(i===0){line(x+36,207,x+227,207,fg,2);line(x+36,225,x+180,225,fg,1);box(x+36,253,88,31,fg);}if(i===1){dot(x+134,239,39,fg);t('→',x+111,214,52,58,33,{color:'#'+contrast(fg),align:'center'});}if(i===2){for(let j=0;j<3;j++){dot(x+42,203+j*37,6,fg);line(x+63,203+j*37,x+232-j*18,203+j*37,fg,1.5);}}label('0'+(i+1),x,337,260);t(stages[i],x,376,263,79,26,{display:true});}
   note(['Schematic frames describe content and intent; they are not product screenshots.','示意画框用于说明内容与意图，并非产品截图。']);
  },
  funnel:()=>{
   unit(['CONVERSION / ONE STARTING COHORT OF 1,000','转化 / 同一初始群体，共 1,000 人']);
   const counts=[1000,640,360,216];
   counts.forEach((v,i)=>{const x=48+i*168,y=181+i*48;box(x,y,151,285-i*48,i===2?accent:surface);t(String(v),x+12,y+16,128,56,36,{display:true,color:'#'+contrast(i===2?accent:surface)});t(topic[i+1],x+8,401,135,54,15,{color:'#'+contrast(i===2?accent:surface)});if(i<3)arrow(x+153,y+24,x+166,y+24);});
   line(741,180,741,441,blend(bg,ink,.3));t('21.6%',770,196,144,69,33,{display:true});t(['end-to-end conversion','全流程转化率'],770,292,142,77,20);label(['216 / 1,000','216 / 1,000'],770,405,142);
   note(['Column height follows cohort size only schematically; printed counts are authoritative.','阶梯高度仅示意群体规模；具体数值以标注为准。']);
  },
  experiment:()=>{
   t(['TEST ONE\nASSUMPTION','一次验证\n一个假设'],48,174,275,104,32,{display:true});t(topic[5],48,331,278,117,21);line(365,174,365,450,blend(bg,ink,.3));
   const rows=[['Hypothesis','假设','A clearer next step reduces hesitation.','明确下一步能够减少犹豫。'],['Comparison','比较','Same task; current vs revised guidance.','相同任务；比较现有与修改后的引导。'],['Measure','衡量','Completion, time and help requests.','完成率、耗时与求助次数。'],['Decision','决策','Adopt only if the agreed targets hold.','达到约定目标后再采用。']];
   rows.forEach(([a,b,c,d],i)=>{const y=177+i*71;t([a,b],402,y,141,34,18,{display:true});t([c,d],561,y,350,58,18);line(402,y+62,912,y+62,blend(bg,ink,.25));});
   note(['Set success criteria before collecting results. Record contrary evidence.','收集结果前先定义成功标准，同时记录相反证据。']);
  },
  timeline:()=>{
   const steps=plan.topic==='learning'?[['Read','阅读'],['Practice','练习'],['Explain','解释'],['Transfer','迁移']]:[['Observe','观察'],['Question','提问'],['Test','验证'],['Revise','修正']];
   line(100,290,846,290,blend(bg,ink,.4),1.2);
   steps.forEach((v,i)=>{const x=78+i*214;dot(x+17,290,7);label('0'+(i+1),x+29,298,60);t(v,x,i%2===0?177:330,184,47,27,{display:true});const yy=i%2===0?224:390;t([['A starting record','起始记录'],['An open question','一个待解问题'],['A bounded test','一次范围明确的验证'],['An updated view','更新后的判断']][i],x,yy,182,57,18);});
   note(['Show what changed between milestones, not just when an event happened.','说明里程碑之间发生了什么变化，而不仅是事件时间。']);
  },
  rubric:()=>{
   const heads=[['CRITERION','标准'],['STARTING','起步'],['DEVELOPING','发展中'],['INDEPENDENT','独立完成']];
   const xs=[48,270,483,698],ws=[202,192,193,214];box(686,165,226,282,surface);
   heads.forEach((v,i)=>t(v,xs[i],175,ws[i],36,13));
   const rows=[[['Understanding','理解'],['Name the idea','说出概念'],['Explain a step','解释步骤'],['Explain why','说明原因']],[['Application','应用'],['Follow a model','跟随示例'],['Finish a variation','完成变式'],['Solve a new case','解决新例']],[['Reflection','反思'],['Notice an error','发现错误'],['Describe the cause','描述原因'],['Revise the method','修正方法']]];
   rows.forEach((row,r)=>{const y=242+r*69;line(48,y-15,912,y-15,blend(bg,ink,.3));row.forEach((v,c)=>t(v,xs[c],y,ws[c]-8,57,18,{bold:c===0}));});
   note(['Use observed work as evidence. A rubric is a guide, not a substitute for judgment.','以实际作品作为证据；评价表提供指引，不能替代判断。']);
  },
  network:()=>{
   const nodes=[[48,187,190,['Supplier A','供应方 A']],[48,345,190,['Supplier B','供应方 B']],[357,267,180,['Regional hub','区域中心']],[684,175,226,['Urban route','城市线路']],[684,283,226,['Regional route','区域线路']],[684,391,226,['Returns','退货回收']]];
   arrow(238,216,357,296);arrow(238,374,357,296);arrow(537,296,684,204);arrow(537,296,684,312);arrow(684,420,537,313);
   nodes.forEach(([x,y,w,v],i)=>node(v,x,y,w,58,i===2));
   label(['42 pallets / day','42 托盘 / 天'],248,198,222);label(['28 pallets / day','28 托盘 / 天'],248,388,223);label(['16 hours','16 小时'],552,199,117);label(['24 hours','24 小时'],552,332,121);
   note(['Arrows show physical movement; return flow is separate from forward delivery.','箭头表示实物流动；逆向回收与正向交付分开呈现。']);
  },
 };
 const titles={thesis:topic[0],evidence:['Separate the record from the explanation','把记录与解释分开'],tree:['Trace the question to testable branches','把问题拆成可以验证的分支'],trend:['Read the trend and investigate the pause','阅读趋势，追问停顿的原因'],matrix:['Choose the next move with evidence','根据证据选择下一步'],journey:['Locate the friction along the journey','定位旅程中的阻力'],architecture:['Design around explicit boundaries','围绕明确的边界组织系统'],sequence:['Make the handoff order visible','让交接顺序清晰可见'],case:['A small intervention, a measurable change','小范围改变，可衡量的结果'],roadmap:['Sequence the work around a decision gate','围绕决策门槛安排执行顺序'],scorecard:['Connect each measure to a response','把每项指标连接到后续行动'],bridge:['Reconcile the benefit with the cost','把收益与成本放在同一条桥上'],storyboard:['Give each moment a distinct purpose','让每个时刻承担不同的目的'],funnel:['Follow one cohort through the funnel','沿漏斗追踪同一群体'],experiment:['Design the test before reading the result','看到结果之前，先设计验证方法'],timeline:['Show how the judgment develops','呈现判断如何逐步形成'],rubric:['Define what independent work looks like','定义什么叫独立完成'],network:['Follow the flow across the network','沿运营网络追踪流转关系']};
 const summaries={thesis:'Asymmetric argument with three supporting evidence rows',evidence:'Interview excerpt, observation, competing explanation and next check',tree:'Three-branch hypothesis tree with six testable leaves',trend:'Labeled six-point trend with common scale and a separate interpretation',matrix:'Two-axis decision map with direct labels and a recommended next step',journey:'Four stages aligned across actions and independent outcome measures',architecture:'Three layers, nine native nodes, horizontal handoffs and vertical dependencies',sequence:'Four lifelines with ordered request and response arrows',case:'Intervention narrative beside paired before and after comparisons',roadmap:'Four timed workstreams and a decision gate',scorecard:'Actual, target and response aligned across four measures',bridge:'Sequential contribution waterfall with an explicitly reconciled net change',storyboard:'Three schematic frames with distinct content and intent',funnel:'A single cohort with explicit conversion counts and an overall rate',experiment:'One hypothesis with comparison, measure and a predeclared decision rule',timeline:'Alternating milestone notes around a continuous argument timeline',rubric:'Three criteria across three levels of observable competence',network:'Editable directed network with forward and return flow'};
 const families={thesis:'insights',evidence:'quote',tree:'process',trend:'data',matrix:'comparison',journey:'process',architecture:'process',sequence:'process',case:'comparison',roadmap:'process',scorecard:'table',bridge:'data',storyboard:'grid',funnel:'data',experiment:'comparison',timeline:'process',rubric:'table',network:'process'};
 return plan.recipes.map((recipe,k)=>{start(titles[recipe],k);recipes[recipe]();t(['ILLUSTRATIVE DATA / LAYOUT STUDY','版式示例 / 数据为模拟值'],48,507,783,16,9);t(String(k+2).padStart(2,'0'),871,504,41,22,11);return {name:tr(titles[recipe]),family:families[recipe],recipe,columns:['architecture','storyboard','tree'].includes(recipe)?3:2,density:['thesis','timeline'].includes(recipe)?'medium':'high',summary:summaries[recipe],page:{pageType:'content',background:{type:'solid',color:'#'+bg},notes:'DSH-authored '+recipe+' composition. All new example statements and figures are illustrative, not reported facts. Replace them with user evidence. '+summaries[recipe],elements}};});
}
