(()=>{'use strict';
const $=s=>document.querySelector(s);
const q=new URLSearchParams(location.search);
const difficulty=['easy','medium','hard'].includes(q.get('difficulty'))?q.get('difficulty'):'medium';
const N=[9,11,13,15].includes(+q.get('size'))?+q.get('size'):11;
const forceNew=q.get('new')==='1';
const labels={easy:'Leicht',medium:'Mittel',hard:'Anspruchsvoll'};
const stateKey=`wordscribble-swedish-v010-${difficulty}-${N}`;
let bank=[],puzzle=null,selectedEntry=0,selectedCell=0,compose=false,inputTimer=null,toastTimer=null,finishing=false;

function clean(v){return String(v??'').toUpperCase().replace(/Ä/g,'AE').replace(/Ö/g,'OE').replace(/Ü/g,'UE').replace(/ß/g,'SS').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z]/g,'')}
function keyOf(p){return `${p.r},${p.c}`}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),2600)}
function save(){if(puzzle)localStorage.setItem(stateKey,JSON.stringify(puzzle))}
function loadSaved(){try{return JSON.parse(localStorage.getItem(stateKey))}catch{return null}}

async function loadBank(){
 const levels=difficulty==='easy'?['easy','medium']:difficulty==='medium'?['medium','easy','hard']:['hard','medium','easy'];
 const all=[];
 for(const level of levels){
  const r=await fetch(`./words-${level}.json?v=10`,{cache:'no-store'});
  if(!r.ok)continue;
  const data=await r.json();
  for(const item of data){
   const word=clean(item[0]);
   if(word.length>=3&&word.length<=N-1)all.push({word,clue:String(item[1]??''),level});
  }
 }
 const seen=new Set();
 bank=all.filter(x=>!seen.has(x.word)&&seen.add(x.word));
 if(bank.length<50)throw new Error('Zu wenige passende Wörter für dieses Raster.');
}
function lengthMap(){const m=new Map();for(const x of bank){if(!m.has(x.word.length))m.set(x.word.length,[]);m.get(x.word.length).push(x)}return m}
function partitions(total,lengths,maxParts=3){
 const out=[];
 function rec(left,arr){
  if(arr.length>maxParts)return;
  if(left===0&&arr.length){out.push(arr.slice());return}
  for(const n of lengths){const cost=n+1;if(cost<=left)rec(left-cost,[...arr,n])}
 }
 rec(total,[]);
 return out.filter(a=>a.reduce((s,n)=>s+n+1,0)===total);
}
function buildLayout(byLen){
 const lengths=[...byLen.keys()].filter(n=>n>=3&&byLen.get(n).length>=Math.max(5,Math.ceil(N/2))).sort((a,b)=>a-b);
 const parts=partitions(N,lengths,N>=13?3:2);
 if(!parts.length)throw new Error('Keine passende vollständige Rasteraufteilung gefunden.');
 const remaining=new Map([...byLen].map(([len,list])=>[len,list.length]));
 const rows=[];
 for(let r=0;r<N;r++){
  let choices=parts.filter(p=>{
   const need={};for(const n of p)need[n]=(need[n]||0)+1;
   return Object.entries(need).every(([n,k])=>(remaining.get(+n)||0)>=k);
  });
  if(!choices.length)return null;
  const multi=choices.filter(p=>p.length>=2);if(multi.length)choices=multi;
  choices.sort((a,b)=>{const diversity=(new Set(b)).size-(new Set(a)).size;return diversity||Math.random()-.5});
  const pick=choices[Math.floor(Math.random()*Math.min(10,choices.length))];
  rows.push(pick);for(const n of pick)remaining.set(n,remaining.get(n)-1);
 }
 const cells=Array.from({length:N},()=>Array.from({length:N},()=>({kind:'answer',entries:[],solution:'',fillCount:0})));
 const slots=[];
 rows.forEach((partsForRow,r)=>{let c=0;for(const len of partsForRow){cells[r][c]={kind:'clue',entries:[]};const clueCell={r,c},answer=[];for(let i=1;i<=len;i++)answer.push({r,c:c+i});slots.push({dir:'across',clueCell,answer,length:len});c+=len+1}});
 return{cells,slots};
}
function verticalCandidates(layout,byLen){
 const out=[];
 for(let r=0;r<N-3;r++)for(let c=0;c<N;c++){
  if(layout.cells[r][c].kind!=='clue')continue;
  let len=0;while(r+1+len<N&&layout.cells[r+1+len][c].kind==='answer')len++;
  if(len>=3&&byLen.has(len)&&byLen.get(len).length>=4)out.push({dir:'down',clueCell:{r,c},answer:Array.from({length:len},(_,i)=>({r:r+1+i,c})),length:len});
 }
 return out;
}
function chooseVerticalSlots(layout,byLen,target){
 const candidates=verticalCandidates(layout,byLen),cellToAcross=new Map();
 layout.slots.forEach((s,i)=>s.answer.forEach(p=>cellToAcross.set(keyOf(p),i)));
 const acrossHits=Array(layout.slots.length).fill(0),occupied=new Set(),chosen=[],maxHits=difficulty==='hard'?3:2;
 while(chosen.length<target){
  let best=null;
  for(const slot of candidates){
   if(chosen.includes(slot)||slot.answer.some(p=>occupied.has(keyOf(p))))continue;
   const affected=[...new Set(slot.answer.map(p=>cellToAcross.get(keyOf(p))).filter(i=>i!==undefined))];
   if(affected.length<3||affected.some(i=>acrossHits[i]>=maxHits))continue;
   const fresh=affected.filter(i=>acrossHits[i]===0).length,balanced=affected.filter(i=>acrossHits[i]===1).length,edge=Math.abs(slot.clueCell.c-(N-1)/2)*.35;
   const score=fresh*9+balanced*3+slot.length*2-edge+Math.random()*5;
   if(!best||score>best.score)best={slot,affected,score};
  }
  if(!best)break;
  chosen.push(best.slot);best.slot.answer.forEach(p=>occupied.add(keyOf(p)));best.affected.forEach(i=>acrossHits[i]++);
 }
 return chosen;
}
function prepareIntersections(slots){
 const membership=new Map();
 slots.forEach((slot,si)=>slot.answer.forEach((p,pi)=>{const k=keyOf(p);if(!membership.has(k))membership.set(k,[]);membership.get(k).push({si,pi})}));
 slots.forEach(slot=>{slot.degree=slot.answer.reduce((sum,p)=>sum+Math.max(0,(membership.get(keyOf(p))||[]).length-1),0);slot.crossPositions=new Set();slot.answer.forEach((p,pi)=>{if((membership.get(keyOf(p))||[]).length>1)slot.crossPositions.add(pi)})});
 return membership;
}
function solveLayout(layout,verticalSlots,byLen,timeLimitMs=1100){
 const slots=[...layout.slots,...verticalSlots].map((s,i)=>({...s,slotId:i}));prepareIntersections(slots);
 for(const row of layout.cells)for(const cell of row)if(cell.kind==='answer'){cell.solution='';cell.fillCount=0;cell.entries=[]}else cell.entries=[];
 const used=new Set(),assignments=new Map(),start=performance.now();let steps=0;
 function matches(obj,slot){for(let i=0;i<slot.answer.length;i++){const p=slot.answer[i],fixed=layout.cells[p.r][p.c].solution;if(fixed&&fixed!==obj.word[i])return false}return true}
 function candidatesFor(slot){
  const list=(byLen.get(slot.length)||[]).filter(obj=>!used.has(obj.word)&&matches(obj,slot));
  list.sort((a,b)=>{const levelA=a.level===difficulty?0:1,levelB=b.level===difficulty?0:1;if(levelA!==levelB)return levelA-levelB;let scoreA=0,scoreB=0;for(const pos of slot.crossPositions){if(!layout.cells[slot.answer[pos].r][slot.answer[pos].c].solution){scoreA+='ETAOINRS'.includes(a.word[pos])?1:0;scoreB+='ETAOINRS'.includes(b.word[pos])?1:0}}return scoreB-scoreA+Math.random()-.5});
  return list.slice(0,45);
 }
 function assign(slot,obj){slot.answer.forEach((p,i)=>{const cell=layout.cells[p.r][p.c];if(!cell.solution)cell.solution=obj.word[i];cell.fillCount++});used.add(obj.word);assignments.set(slot.slotId,obj)}
 function undo(slot,obj){slot.answer.forEach(p=>{const cell=layout.cells[p.r][p.c];cell.fillCount--;if(cell.fillCount===0)cell.solution=''});used.delete(obj.word);assignments.delete(slot.slotId)}
 function recurse(){
  steps++;if(steps>90000||performance.now()-start>timeLimitMs)return false;if(assignments.size===slots.length)return true;
  let bestSlot=null,bestCandidates=null,bestMetric=Infinity;
  for(const slot of slots){if(assignments.has(slot.slotId))continue;const list=candidatesFor(slot);if(!list.length)return false;const fixed=slot.answer.filter(p=>layout.cells[p.r][p.c].solution).length,metric=list.length*100-fixed*8-slot.degree;if(metric<bestMetric){bestMetric=metric;bestSlot=slot;bestCandidates=list;if(list.length===1)break}}
  for(const obj of bestCandidates){assign(bestSlot,obj);if(recurse())return true;undo(bestSlot,obj)}return false;
 }
 if(!recurse())return null;
 const entries=[];
 slots.forEach((slot,id)=>{const obj=assignments.get(slot.slotId),entry={id,word:obj.word,clue:obj.clue,dir:slot.dir,clueCell:slot.clueCell,answer:slot.answer};entries.push(entry);layout.cells[slot.clueCell.r][slot.clueCell.c].entries.push(id);slot.answer.forEach(p=>layout.cells[p.r][p.c].entries.push(id))});
 return{...layout,entries,values:{},checked:false,id:Date.now(),crossings:layout.cells.flat().filter(c=>c.kind==='answer'&&c.entries.length>1).length};
}
function generatePuzzle(){
 const byLen=lengthMap();let winner=null,winnerScore=-Infinity;const desired=Math.max(5,Math.round(N*.9));
 for(let target=desired;target>=Math.max(3,Math.round(N*.5));target--){
  const attempts=N>=15?18:24;
  for(let attempt=0;attempt<attempts;attempt++){
   const layout=buildLayout(byLen);if(!layout)continue;const vertical=chooseVerticalSlots(layout,byLen,target);if(vertical.length<Math.min(target,3))continue;
   const solved=solveLayout(layout,vertical,byLen,N>=15?1450:1050);if(!solved)continue;
   const answerCells=solved.cells.flat().filter(c=>c.kind==='answer').length,crossingRate=answerCells?solved.crossings/answerCells:0,dualClues=solved.cells.flat().filter(c=>c.kind==='clue'&&c.entries.length>1).length,score=solved.crossings*12+dualClues*5+solved.entries.length+crossingRate*100;
   if(score>winnerScore){winner=solved;winnerScore=score}if(crossingRate>=.42&&vertical.length>=target-1)return winner;
  }
  if(winner&&winner.crossings>=Math.round(N*1.8))break;
 }
 if(!winner)throw new Error('Das stark vernetzte Raster konnte nicht erzeugt werden. Bitte erneut versuchen.');return winner;
}
function entryById(id){return puzzle.entries.find(e=>e.id===id)}
function answerStats(){let total=0,filled=0,wrong=0;for(let r=0;r<N;r++)for(let c=0;c<N;c++){const cell=puzzle.cells[r][c];if(cell.kind!=='answer')continue;total++;const value=puzzle.values[`${r},${c}`]||'';if(value)filled++;if(value&&value!==cell.solution)wrong++}return{total,filled,wrong,empty:total-filled}}
function showResultBanner(stats){const banner=$('#resultBanner');if(!banner)return;if(!puzzle.checked){banner.hidden=true;banner.className='result-banner';return}banner.hidden=false;if(!stats.empty&&!stats.wrong){banner.className='result-banner success';banner.textContent='Alles richtig – das Rätsel ist vollständig gelöst.'}else if(stats.wrong){banner.className='result-banner error';banner.textContent=`${stats.wrong} ${stats.wrong===1?'Buchstabe ist':'Buchstaben sind'} falsch und im Raster rot markiert.`}else{banner.className='result-banner info';banner.textContent=`Noch ${stats.empty} ${stats.empty===1?'Feld ist':'Felder sind'} leer.`}}
function render(){
 const g=$('#grid');g.style.setProperty('--n',N);g.innerHTML='';
 for(let r=0;r<N;r++)for(let c=0;c<N;c++){
  const cell=puzzle.cells[r][c],el=document.createElement('div');el.className='cell';
  if(cell.kind==='clue'){
   el.classList.add('clue-cell');if(cell.entries.length){for(const id of cell.entries){const e=entryById(id),b=document.createElement('button');b.className='clue-item'+(id===selectedEntry?' active':'');b.type='button';b.title=e.clue;b.innerHTML=`${escapeHtml(e.clue)}<span class="arrow">${e.dir==='across'?'→':'↓'}</span>`;b.onclick=ev=>{ev.stopPropagation();selectEntry(id,0)};el.appendChild(b)}if(cell.entries.includes(selectedEntry))el.classList.add('active')}else el.innerHTML='<div class="empty-clue">•</div>';
  }else{
   el.classList.add('letter-cell');const key=`${r},${c}`,val=puzzle.values[key]||'';el.textContent=val;if(cell.entries.includes(selectedEntry))el.classList.add('word');const e=entryById(selectedEntry),idx=e?e.answer.findIndex(p=>p.r===r&&p.c===c):-1;if(idx===selectedCell)el.classList.add('selected');if(puzzle.checked&&val)el.classList.add(val===cell.solution?'good':'bad');el.onclick=()=>selectCell(r,c);
  }
  g.appendChild(el);
 }
 updateUI();
}
function selectEntry(id,index=0){selectedEntry=id;const e=entryById(id);selectedCell=Math.max(0,Math.min(index,e.answer.length-1));render();setTimeout(()=>$('#wordInput').focus({preventScroll:true}),30)}
function selectCell(r,c){const cell=puzzle.cells[r][c];if(!cell.entries.length)return;let id=cell.entries[0];if(cell.entries.length>1&&cell.entries.includes(selectedEntry))id=cell.entries[(cell.entries.indexOf(selectedEntry)+1)%cell.entries.length];else if(cell.entries.includes(selectedEntry))id=selectedEntry;const e=entryById(id),index=e.answer.findIndex(p=>p.r===r&&p.c===c);selectEntry(id,index)}
function updateUI(){
 const e=entryById(selectedEntry);if(e){$('#currentClue').innerHTML=`<strong>${e.dir==='across'?'Waagerecht':'Senkrecht'}:</strong> ${escapeHtml(e.clue)} <small>(${e.word.length} Buchstaben)</small>`;$('#directionBadge').textContent=e.dir==='across'?'→ Waagerecht':'↓ Senkrecht'}
 const stats=answerStats(),pct=stats.total?Math.round(stats.filled/stats.total*100):0;$('#progressBar').style.width=pct+'%';$('#progressText').textContent=pct+' %';const crossRate=stats.total?Math.round((puzzle.crossings||0)/stats.total*100):0;$('#status').textContent=`${puzzle.entries.length} Fragen · ${puzzle.crossings||0} Kreuzungen · ${crossRate} % der Lösungsfelder gekreuzt`;$('#title').textContent=`${labels[difficulty]} · ${N} × ${N} · Schwedenrätsel`;const density=$('#densityBadge');if(density)density.textContent=`${crossRate} % gekreuzt`;showResultBanner(stats);
}
function evaluate({automatic=false}={}){const stats=answerStats();puzzle.checked=true;save();render();if(!stats.empty&&!stats.wrong){$('#winModal').classList.add('show');toast('Alles richtig – Rätsel gelöst!')}else if(stats.wrong){toast(`${stats.wrong} ${stats.wrong===1?'falscher Buchstabe wurde':'falsche Buchstaben wurden'} rot markiert.`)}else if(!automatic){toast(`${stats.empty} Felder sind noch leer.`)}return stats}
function maybeEvaluate(){if(finishing)return;const stats=answerStats();if(stats.total&&stats.filled===stats.total){finishing=true;setTimeout(()=>{evaluate({automatic:true});finishing=false},180)}}
function setLetter(letter){const e=entryById(selectedEntry);if(!e)return;const p=e.answer[selectedCell];puzzle.values[keyOf(p)]=letter;puzzle.checked=false;if(selectedCell<e.answer.length-1)selectedCell++;save();render();maybeEvaluate()}
function fillWord(text){const e=entryById(selectedEntry),letters=clean(text);if(!e||!letters)return;for(let i=0;i<Math.min(e.answer.length,letters.length);i++)puzzle.values[keyOf(e.answer[i])]=letters[i];selectedCell=Math.min(e.answer.length-1,Math.max(0,letters.length-1));puzzle.checked=false;save();render();toast(letters.length===e.word.length?'Wort übernommen.':'Eingabe teilweise übernommen.');maybeEvaluate()}
function eraseSelected(){const e=entryById(selectedEntry);if(!e)return;for(const p of e.answer)delete puzzle.values[keyOf(p)];selectedCell=0;puzzle.checked=false;save();render()}
function nextEntry(){const i=puzzle.entries.findIndex(e=>e.id===selectedEntry),next=puzzle.entries[(i+1)%puzzle.entries.length];selectEntry(next.id,0)}
function makeKeyboard(){const k=$('#keyboard');for(const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'){const b=document.createElement('button');b.className='key';b.type='button';b.textContent=l;b.onclick=()=>setLetter(l);k.appendChild(b)}const del=document.createElement('button');del.className='key';del.type='button';del.textContent='⌫';del.onclick=()=>{const e=entryById(selectedEntry);if(!e)return;const p=e.answer[selectedCell];delete puzzle.values[keyOf(p)];if(selectedCell>0)selectedCell--;puzzle.checked=false;save();render()};k.appendChild(del)}
function bind(){
 makeKeyboard();$('#homeBtn').onclick=()=>location.href='./index.html';$('#newBtn').onclick=()=>{localStorage.removeItem(stateKey);start(true)};$('#clearBtn').onclick=()=>{puzzle.values={};puzzle.checked=false;save();render();toast('Alle Einträge wurden gelöscht.')};$('#checkBtn').onclick=()=>evaluate({automatic:false});$('#eraseWord').onclick=eraseSelected;$('#nextWord').onclick=nextEntry;$('#closeWin').onclick=()=>$('#winModal').classList.remove('show');$('#newAfterWin').onclick=()=>{localStorage.removeItem(stateKey);$('#winModal').classList.remove('show');start(true)};
 document.addEventListener('keydown',e=>{if(e.target===$('#wordInput'))return;if(/^[a-zA-Z]$/.test(e.key)){e.preventDefault();setLetter(e.key.toUpperCase())}else if(e.key==='Backspace'){e.preventDefault();$('#keyboard .key:last-child').click()}else if(e.key==='Tab'){e.preventDefault();nextEntry()}});
 const input=$('#wordInput'),state=$('#recognitionState');function commit(){clearTimeout(inputTimer);if(compose)return;const v=clean(input.value);if(!v)return;input.value='';fillWord(v);state.textContent='Apple Kritzeln';setTimeout(()=>input.focus({preventScroll:true}),50)}function schedule(){clearTimeout(inputTimer);const v=clean(input.value);state.textContent=v?'Erkannt: '+v:'Apple Kritzeln';if(v)inputTimer=setTimeout(commit,900)}input.addEventListener('compositionstart',()=>{compose=true;state.textContent='Schrift wird erkannt …'});input.addEventListener('compositionend',()=>{compose=false;schedule()});input.addEventListener('input',()=>{if(!compose)schedule()});input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();commit()}})
}
async function start(newOne=false){$('#status').textContent='Stark vernetztes Raster wird erzeugt …';await loadBank();const saved=!newOne&&!forceNew?loadSaved():null;puzzle=saved&&saved.cells&&saved.entries&&typeof saved.crossings==='number'?saved:generatePuzzle();selectedEntry=puzzle.entries[0].id;selectedCell=0;save();render();setTimeout(()=>$('#wordInput').focus({preventScroll:true}),80)}
bind();start(false).catch(err=>{$('#status').textContent='Fehler: '+err.message;toast(err.message)});
})();
