(()=>{'use strict';
const $=s=>document.querySelector(s),q=new URLSearchParams(location.search),difficulty=['easy','medium','hard'].includes(q.get('difficulty'))?q.get('difficulty'):'medium',N=[9,11,13,15].includes(+q.get('size'))?+q.get('size'):11,forceNew=q.get('new')==='1';
const labels={easy:'Leicht',medium:'Mittel',hard:'Anspruchsvoll'},stateKey=`wordscribble-swedish-v09-${difficulty}-${N}`;
let bank=[],puzzle=null,selectedEntry=0,selectedCell=0,compose=false,inputTimer=null,toastTimer=null;
function clean(v){return (v||'').toUpperCase().replace(/Ä/g,'AE').replace(/Ö/g,'OE').replace(/Ü/g,'UE').replace(/ß/g,'SS').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z]/g,'')}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),2200)}
function save(){if(puzzle)localStorage.setItem(stateKey,JSON.stringify(puzzle))}
function loadSaved(){try{return JSON.parse(localStorage.getItem(stateKey))}catch{return null}}
async function loadBank(){const levels=difficulty==='easy'?['easy','medium']:difficulty==='medium'?['medium','easy','hard']:['hard','medium','easy'],all=[];for(const level of levels){const r=await fetch(`./words-${level}.json?v=9`,{cache:'no-store'});if(!r.ok)continue;const data=await r.json();for(const item of data){const word=clean(item[0]);if(word.length>=3&&word.length<=N-1)all.push({word,clue:String(item[1]),level})}}const seen=new Set();bank=all.filter(x=>!seen.has(x.word)&&seen.add(x.word));if(bank.length<50)throw new Error('Zu wenige passende Wörter für dieses Raster.');}
function lengthMap(){const m=new Map();for(const x of bank){if(!m.has(x.word.length))m.set(x.word.length,[]);m.get(x.word.length).push(x)}return m}
function partitions(total,lengths,maxParts=3){const out=[];function rec(left,arr){if(arr.length>maxParts)return;if(left===0&&arr.length){out.push(arr.slice());return}for(const n of lengths){const cost=n+1;if(cost<=left)rec(left-cost,[...arr,n])}}rec(total,[]);return out.filter(a=>a.reduce((s,n)=>s+n+1,0)===total)}
function buildLayout(byLen){
 const lengths=[...byLen.keys()].filter(n=>n>=3&&byLen.get(n).length>=4).sort((a,b)=>a-b),parts=partitions(N,lengths,N>=13?3:2);
 if(!parts.length)throw new Error('Keine passende vollständige Rasteraufteilung gefunden.');
 const remaining=new Map([...byLen].map(([len,list])=>[len,list.length])),rows=[];
 for(let r=0;r<N;r++){
  let choices=parts.filter(p=>{
   const need={};for(const n of p)need[n]=(need[n]||0)+1;
   return Object.entries(need).every(([n,k])=>(remaining.get(+n)||0)>=k)
  });
  if(!choices.length)return null;
  choices=choices.filter(p=>p.length>=2).length?choices.filter(p=>p.length>=2):choices;
  choices.sort((a,b)=>b.length-a.length+Math.random()-.5);
  const pick=choices[Math.floor(Math.random()*Math.min(8,choices.length))];rows.push(pick);
  for(const n of pick)remaining.set(n,remaining.get(n)-1)
 }
 const cells=Array.from({length:N},()=>Array.from({length:N},()=>({kind:'answer',entries:[]}))),slots=[];
 rows.forEach((p,r)=>{let c=0;for(const len of p){cells[r][c]={kind:'clue',entries:[]};const clue={r,c},answer=[];for(let i=1;i<=len;i++)answer.push({r,c:c+i});slots.push({dir:'across',clue,answer,length:len});c+=len+1}});
 return{cells,slots}
}
function verticalCandidates(layout,byLen){const out=[];for(let r=0;r<N-3;r++)for(let c=0;c<N;c++){if(layout.cells[r][c].kind!=='clue')continue;let len=0;while(r+1+len<N&&layout.cells[r+1+len][c].kind==='answer')len++;if(len>=3&&byLen.has(len))out.push({dir:'down',clue:{r,c},answer:Array.from({length:len},(_,i)=>({r:r+1+i,c})),length:len})}return shuffle(out)}
function matches(word,answer,cells){for(let i=0;i<answer.length;i++){const p=answer[i],fixed=cells[p.r][p.c].solution;if(fixed&&fixed!==word[i])return false}return true}
function chooseWord(list,slot,cells,used,preferred){const candidates=list.filter(x=>!used.has(x.word)&&matches(x.word,slot.answer,cells));if(!candidates.length)return null;candidates.sort((a,b)=>(a.level===preferred?-3:0)-(b.level===preferred?-3:0)+Math.random()-.5);return candidates[0]}
function applyEntry(layout,slot,obj,id){const entry={id,word:obj.word,clue:obj.clue,dir:slot.dir,clue:slot.clue,answer:slot.answer};layout.cells[slot.clue.r][slot.clue.c].entries.push(id);slot.answer.forEach((p,i)=>{const cell=layout.cells[p.r][p.c];cell.solution=obj.word[i];cell.entries.push(id)});return entry}
function generatePuzzle(){
 const byLen=lengthMap();let best=null,wanted=Math.max(2,Math.round(N*.35));
 for(let verticalTarget=wanted;verticalTarget>=0&&!best;verticalTarget--){
  for(let attempt=0;attempt<18;attempt++){
   const layout=buildLayout(byLen);if(!layout)continue;
   const used=new Set(),entries=[];let failed=false;
   const vertical=verticalCandidates(layout,byLen),chosen=[];
   for(const v of vertical){
    if(chosen.length>=verticalTarget)break;
    if(chosen.some(x=>x.answer.some(a=>v.answer.some(b=>a.r===b.r&&a.c===b.c))))continue;
    chosen.push(v)
   }
   for(const slot of chosen){
    const obj=chooseWord(byLen.get(slot.length)||[],slot,layout.cells,used,difficulty);
    if(!obj){failed=true;break}
    used.add(obj.word);entries.push(applyEntry(layout,slot,obj,entries.length))
   }
   if(failed)continue;
   const horizontal=shuffle(layout.slots.slice()).sort((a,b)=>{
    const af=a.answer.filter(p=>layout.cells[p.r][p.c].solution).length,bf=b.answer.filter(p=>layout.cells[p.r][p.c].solution).length;return bf-af
   });
   for(const slot of horizontal){
    const obj=chooseWord(byLen.get(slot.length)||[],slot,layout.cells,used,difficulty);
    if(!obj){failed=true;break}
    used.add(obj.word);entries.push(applyEntry(layout,slot,obj,entries.length))
   }
   if(failed)continue;
   const crossings=layout.cells.flat().filter(c=>c.kind==='answer'&&c.entries.length>1).length,dual=layout.cells.flat().filter(c=>c.kind==='clue'&&c.entries.length>1).length;
   best={...layout,entries,values:{},checked:false,id:Date.now()+attempt,score:crossings*8+dual*5+entries.length};
   if(verticalTarget>0&&crossings<verticalTarget)best=null
  }
 }
 if(!best)throw new Error('Das vollständige Raster konnte nicht erzeugt werden. Bitte erneut versuchen.');
 return best
}
function entryById(id){return puzzle.entries.find(e=>e.id===id)}
function render(){
 const g=$('#grid');g.style.setProperty('--n',N);g.innerHTML='';
 for(let r=0;r<N;r++)for(let c=0;c<N;c++){
  const cell=puzzle.cells[r][c],el=document.createElement('div');el.className='cell';
  if(cell.kind==='clue'){
   el.classList.add('clue-cell');
   if(cell.entries.length){
    for(const id of cell.entries){
     const e=entryById(id),b=document.createElement('button');
     b.className='clue-item'+(id===selectedEntry?' active':'');b.type='button';b.title=e.clue;
     b.innerHTML=`${escapeHtml(e.clue)}<span class="arrow">${e.dir==='across'?'→':'↓'}</span>`;
     b.onclick=ev=>{ev.stopPropagation();selectEntry(id,0)};el.appendChild(b)
    }
    if(cell.entries.includes(selectedEntry))el.classList.add('active')
   }else el.innerHTML='<div class="empty-clue">•</div>'
  }else{
   el.classList.add('letter-cell');const key=`${r},${c}`,val=puzzle.values[key]||'';el.textContent=val;
   if(cell.entries.includes(selectedEntry))el.classList.add('word');
   const e=entryById(selectedEntry),idx=e?e.answer.findIndex(p=>p.r===r&&p.c===c):-1;
   if(idx===selectedCell)el.classList.add('selected');
   if(puzzle.checked&&val)el.classList.add(val===cell.solution?'good':'bad');
   el.onclick=()=>selectCell(r,c)
  }
  g.appendChild(el)
 }
 updateUI()
}
function escapeHtml(s){return s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function selectEntry(id,index=0){selectedEntry=id;const e=entryById(id);selectedCell=Math.max(0,Math.min(index,e.answer.length-1));render();setTimeout(()=>$('#wordInput').focus({preventScroll:true}),30)}
function selectCell(r,c){const cell=puzzle.cells[r][c];if(!cell.entries.length)return;let id=cell.entries[0];if(cell.entries.length>1&&cell.entries.includes(selectedEntry))id=cell.entries[(cell.entries.indexOf(selectedEntry)+1)%cell.entries.length];else if(cell.entries.includes(selectedEntry))id=selectedEntry;const e=entryById(id),index=e.answer.findIndex(p=>p.r===r&&p.c===c);selectEntry(id,index)}
function updateUI(){
 const e=entryById(selectedEntry);
 if(e){
  $('#currentClue').innerHTML=`<strong>${e.dir==='across'?'Waagerecht':'Senkrecht'}:</strong> ${escapeHtml(e.clue)} <small>(${e.word.length} Buchstaben)</small>`;
  $('#directionBadge').textContent=e.dir==='across'?'→ Waagerecht':'↓ Senkrecht'
 }
 let total=0,filled=0;
 for(let r=0;r<N;r++)for(let c=0;c<N;c++)if(puzzle.cells[r][c].kind==='answer'){total++;if(puzzle.values[`${r},${c}`])filled++}
 const pct=total?Math.round(filled/total*100):0;
 $('#progressBar').style.width=pct+'%';$('#progressText').textContent=pct+' %';
 $('#status').textContent=`${puzzle.entries.length} Fragen · ${total} Buchstabenfelder`;
 $('#title').textContent=`${labels[difficulty]} · ${N} × ${N} · Schwedenrätsel`
}
function setLetter(letter){const e=entryById(selectedEntry);if(!e)return;const p=e.answer[selectedCell];puzzle.values[`${p.r},${p.c}`]=letter;puzzle.checked=false;if(selectedCell<e.answer.length-1)selectedCell++;save();render()}
function fillWord(text){const e=entryById(selectedEntry),letters=clean(text);if(!e||!letters)return;for(let i=0;i<Math.min(e.answer.length,letters.length);i++){const p=e.answer[i];puzzle.values[`${p.r},${p.c}`]=letters[i]}selectedCell=Math.min(e.answer.length-1,letters.length);puzzle.checked=false;save();render();toast(letters.length===e.word.length?'Wort übernommen.':'Eingabe teilweise übernommen.')}
function eraseSelected(){const e=entryById(selectedEntry);if(!e)return;for(const p of e.answer)delete puzzle.values[`${p.r},${p.c}`];selectedCell=0;puzzle.checked=false;save();render()}
function nextEntry(){const i=puzzle.entries.findIndex(e=>e.id===selectedEntry),next=puzzle.entries[(i+1)%puzzle.entries.length];selectEntry(next.id,0)}
function check(){puzzle.checked=true;save();render();let wrong=0,empty=0;for(let r=0;r<N;r++)for(let c=0;c<N;c++){const cell=puzzle.cells[r][c];if(cell.kind!=='answer')continue;const v=puzzle.values[`${r},${c}`];if(!v)empty++;else if(v!==cell.solution)wrong++}if(!wrong&&!empty)$('#winModal').classList.add('show');else toast(empty?`${empty} Felder sind noch leer, ${wrong} falsch.`:`${wrong} Buchstaben sind noch falsch.`)}
function makeKeyboard(){const k=$('#keyboard');for(const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'){const b=document.createElement('button');b.className='key';b.type='button';b.textContent=l;b.onclick=()=>setLetter(l);k.appendChild(b)}const del=document.createElement('button');del.className='key';del.type='button';del.textContent='⌫';del.onclick=()=>{const e=entryById(selectedEntry);if(!e)return;const p=e.answer[selectedCell];delete puzzle.values[`${p.r},${p.c}`];if(selectedCell>0)selectedCell--;save();render()};k.appendChild(del)}
function bind(){makeKeyboard();$('#homeBtn').onclick=()=>location.href='./index.html';$('#newBtn').onclick=()=>{localStorage.removeItem(stateKey);start(true)};$('#clearBtn').onclick=()=>{puzzle.values={};puzzle.checked=false;save();render();toast('Alle Einträge wurden gelöscht.')};$('#checkBtn').onclick=check;$('#eraseWord').onclick=eraseSelected;$('#nextWord').onclick=nextEntry;$('#closeWin').onclick=()=>$('#winModal').classList.remove('show');$('#newAfterWin').onclick=()=>{localStorage.removeItem(stateKey);$('#winModal').classList.remove('show');start(true)};document.addEventListener('keydown',e=>{if(e.target===$('#wordInput'))return;if(/^[a-zA-Z]$/.test(e.key)){e.preventDefault();setLetter(e.key.toUpperCase())}else if(e.key==='Backspace'){e.preventDefault();$('#keyboard .key:last-child').click()}else if(e.key==='Tab'){e.preventDefault();nextEntry()}});const input=$('#wordInput'),state=$('#recognitionState');function commit(){clearTimeout(inputTimer);if(compose)return;const v=clean(input.value);if(!v)return;input.value='';fillWord(v);state.textContent='Apple Kritzeln';setTimeout(()=>input.focus({preventScroll:true}),50)}function schedule(){clearTimeout(inputTimer);const v=clean(input.value);state.textContent=v?'Erkannt: '+v:'Apple Kritzeln';if(v)inputTimer=setTimeout(commit,900)}input.addEventListener('compositionstart',()=>{compose=true;state.textContent='Schrift wird erkannt …'});input.addEventListener('compositionend',()=>{compose=false;schedule()});input.addEventListener('input',()=>{if(!compose)schedule()});input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();commit()}})}
async function start(newOne=false){$('#status').textContent='Vollständiges Raster wird erzeugt …';await loadBank();const saved=!newOne&&!forceNew?loadSaved():null;puzzle=saved&&saved.cells&&saved.entries?saved:generatePuzzle();selectedEntry=puzzle.entries[0].id;selectedCell=0;save();render();setTimeout(()=>$('#wordInput').focus({preventScroll:true}),80)}
bind();start(false).catch(err=>{$('#status').textContent='Fehler: '+err.message;toast(err.message)});
})();
