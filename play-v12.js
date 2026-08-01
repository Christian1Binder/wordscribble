(()=>{
'use strict';

const $ = selector => document.querySelector(selector);
const query = new URLSearchParams(location.search);
const difficulty = ['easy','medium','hard'].includes(query.get('difficulty')) ? query.get('difficulty') : 'medium';
const N = [9,11,13,15].includes(Number(query.get('size'))) ? Number(query.get('size')) : 11;
const forceNew = query.get('new') === '1';
const labels = { easy:'Leicht', medium:'Mittel', hard:'Anspruchsvoll' };
const stateKey = `wordscribble-v012-${difficulty}-${N}`;
const recentKey = 'wordscribble-recent-words-v1';
let puzzle = null;
let selectedEntry = 0;
let selectedCell = 0;
let compose = false;
let inputTimer = null;
let toastTimer = null;
let finishing = false;
let worker = null;
let bankStats = null;

function clean(value){
 return String(value ?? '').toUpperCase().replace(/Ä/g,'AE').replace(/Ö/g,'OE').replace(/Ü/g,'UE').replace(/ẞ|ß/g,'SS').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z]/g,'');
}
function keyOf(point){ return `${point.r},${point.c}`; }
function escapeHtml(value){ return String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function toast(text){ const el=$('#toast'); el.textContent=text; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2800); }
function save(){ if(puzzle) localStorage.setItem(stateKey,JSON.stringify(puzzle)); }
function loadSaved(){ try{return JSON.parse(localStorage.getItem(stateKey));}catch{return null;} }
function entryById(id){ return puzzle?.entries.find(entry=>entry.id===id); }
function ensureHints(){
 if(!puzzle.hints || typeof puzzle.hints!=='object') puzzle.hints={letters:0,words:0,cells:{}};
 if(!puzzle.hints.cells) puzzle.hints.cells={};
 return puzzle.hints;
}
function recentWords(){ try{return JSON.parse(localStorage.getItem(recentKey))||[];}catch{return [];} }
function rememberPuzzleWords(){
 const combined=[...puzzle.entries.map(entry=>entry.word),...recentWords()];
 const unique=[]; const seen=new Set();
 for(const word of combined){ if(!seen.has(word)){seen.add(word);unique.push(word);} if(unique.length>=350)break; }
 localStorage.setItem(recentKey,JSON.stringify(unique));
}

async function loadBank(){
 const all=[];
 const levels=['easy','medium','hard'];
 const results=await Promise.all(levels.map(async level=>{
  const response=await fetch(`./words-${level}.json?v=12`,{cache:'no-store'});
  if(!response.ok) throw new Error(`Wortliste ${level} konnte nicht geladen werden.`);
  return {level,data:await response.json()};
 }));
 for(const {level,data} of results){
  for(const item of data){ if(Array.isArray(item)&&item.length>=2) all.push([item[0],item[1],level]); }
 }
 try{
  const response=await fetch('./wordlist-stats.json?v=12',{cache:'no-store'});
  if(response.ok) bankStats=await response.json();
 }catch{}
 const combinations=bankStats?.combinations || all.length;
 const unique=bankStats?.unique_words || new Set(all.map(item=>clean(item[0]))).size;
 $('#bankMetric').textContent=Number(combinations).toLocaleString('de-DE');
 $('#bankMetricSub').textContent=`${Number(unique).toLocaleString('de-DE')} verschiedene Begriffe`;
 return all;
}

function showBuild(show){ $('#buildOverlay').classList.toggle('visible',show); }
function updateBuild(stage,percent,detail){
 $('#buildStage').textContent=stage;
 $('#buildDetail').textContent=detail||'Das Raster wird optimiert.';
 $('#buildBar').style.width=`${percent}%`;
 $('#buildPercent').textContent=`${Math.round(percent)} %`;
}

function generateWithWorker(rows){
 if(worker) worker.terminate();
 showBuild(true); updateBuild('Wortschatz wird geladen',2,'Die neue Dichte-Engine bereitet Kandidaten vor.');
 return new Promise((resolve,reject)=>{
  worker=new Worker('./generator-v12.js?v=12');
  const timeout=setTimeout(()=>{worker?.terminate(); reject(new Error('Die Rätselerzeugung hat zu lange gedauert.'));},24000);
  worker.onmessage=event=>{
   const message=event.data||{};
   if(message.type==='progress'){ updateBuild(message.stage,message.percent,message.detail); return; }
   if(message.type==='error'){ clearTimeout(timeout); worker.terminate(); worker=null; reject(new Error(message.message)); return; }
   if(message.type==='result'){
    clearTimeout(timeout); worker.terminate(); worker=null; updateBuild('Fertig',100,'Das dichte Rätsel ist bereit.');
    setTimeout(()=>showBuild(false),220); resolve(message.puzzle);
   }
  };
  worker.onerror=event=>{ clearTimeout(timeout); worker?.terminate(); worker=null; reject(new Error(event.message||'Generatorfehler')); };
  worker.postMessage({type:'generate',size:N,difficulty,rows,avoidWords:recentWords(),seed:Date.now()^Math.floor(Math.random()*0x7fffffff)});
 });
}

function answerStats(){
 let total=0,filled=0,wrong=0;
 for(let r=0;r<N;r++) for(let c=0;c<N;c++){
  const cell=puzzle.cells[r][c]; if(cell.kind!=='answer')continue;
  total++; const value=puzzle.values[`${r},${c}`]||'';
  if(value)filled++; if(value&&value!==cell.solution)wrong++;
 }
 return {total,filled,wrong,empty:total-filled};
}
function showResultBanner(stats){
 const banner=$('#resultBanner');
 if(!puzzle.checked){banner.hidden=true;banner.className='result-banner';return;}
 banner.hidden=false;
 if(!stats.empty&&!stats.wrong){banner.className='result-banner success';banner.textContent='Alles richtig – das Rätsel ist vollständig gelöst.';}
 else if(stats.wrong){banner.className='result-banner error';banner.textContent=`${stats.wrong} ${stats.wrong===1?'Buchstabe ist':'Buchstaben sind'} falsch und im Raster rot markiert.`;}
 else{banner.className='result-banner info';banner.textContent=`Noch ${stats.empty} ${stats.empty===1?'Feld ist':'Felder sind'} leer.`;}
}

function render(){
 const grid=$('#grid'); grid.style.setProperty('--n',N); grid.innerHTML='';
 for(let r=0;r<N;r++) for(let c=0;c<N;c++){
  const cell=puzzle.cells[r][c]; const el=document.createElement('div'); el.className='cell';
  if(cell.kind==='clue'){
   el.classList.add('clue-cell');
   if(cell.entries.length){
    for(const id of cell.entries){
     const entry=entryById(id); if(!entry)continue;
     const button=document.createElement('button'); button.className='clue-item'+(id===selectedEntry?' active':''); button.type='button'; button.title=entry.clue;
     button.innerHTML=`<span class="clue-text">${escapeHtml(entry.clue)}</span><span class="arrow">${entry.dir==='across'?'→':'↓'}</span>`;
     button.onclick=event=>{event.stopPropagation();selectEntry(id,0);}; el.appendChild(button);
    }
    if(cell.entries.includes(selectedEntry))el.classList.add('active');
   }else el.innerHTML='<div class="empty-clue">◆</div>';
  }else{
   el.classList.add('letter-cell'); const key=`${r},${c}`; const value=puzzle.values[key]||''; el.textContent=value;
   const hintType=puzzle.hints?.cells?.[key]; if(hintType)el.classList.add(hintType==='word'?'hint-word':'hint-letter');
   if(cell.entries.length>1)el.classList.add('crossing-cell');
   if(cell.entries.includes(selectedEntry))el.classList.add('word');
   const entry=entryById(selectedEntry); const index=entry?entry.answer.findIndex(point=>point.r===r&&point.c===c):-1;
   if(index===selectedCell)el.classList.add('selected');
   if(puzzle.checked&&value)el.classList.add(value===cell.solution?'good':'bad');
   el.onclick=()=>selectCell(r,c);
  }
  grid.appendChild(el);
 }
 updateUI();
}

function selectEntry(id,index=0){
 selectedEntry=id; const entry=entryById(id); if(!entry)return;
 selectedCell=Math.max(0,Math.min(index,entry.answer.length-1)); render();
 setTimeout(()=>$('#wordInput').focus({preventScroll:true}),30);
}
function selectCell(r,c){
 const cell=puzzle.cells[r][c]; if(!cell.entries.length)return;
 let id=cell.entries[0];
 if(cell.entries.length>1&&cell.entries.includes(selectedEntry))id=cell.entries[(cell.entries.indexOf(selectedEntry)+1)%cell.entries.length];
 else if(cell.entries.includes(selectedEntry))id=selectedEntry;
 const entry=entryById(id); const index=entry.answer.findIndex(point=>point.r===r&&point.c===c); selectEntry(id,index);
}
function updateUI(){
 const entry=entryById(selectedEntry);
 if(entry){
  $('#currentClue').innerHTML=`<span class="current-label">${entry.dir==='across'?'Waagerecht':'Senkrecht'}</span><strong>${escapeHtml(entry.clue)}</strong><small>${entry.word.length} Buchstaben</small>`;
  $('#directionBadge').textContent=entry.dir==='across'?'→ Waagerecht':'↓ Senkrecht';
 }
 const stats=answerStats(); const percent=stats.total?Math.round(stats.filled/stats.total*100):0;
 $('#progressBar').style.width=`${percent}%`; $('#progressText').textContent=`${percent} %`;
 const crossingRate=Math.round((puzzle.crossingRate ?? (puzzle.crossings/(puzzle.answerCells||stats.total))) *100);
 $('#status').textContent=`${puzzle.entries.length} Fragen · ${puzzle.crossings} Kreuzungsfelder · ${puzzle.verticalCount} senkrechte Wörter`;
 $('#title').textContent=`${labels[difficulty]} · ${N} × ${N} · Dichtes Schwedenrätsel`;
 $('#densityBadge').textContent=`${crossingRate} % gekreuzt`;
 $('#crossMetric').textContent=`${crossingRate} %`;
 $('#crossMetricSub').textContent=`${puzzle.crossings} von ${puzzle.answerCells||stats.total} Lösungsfeldern`;
 $('#verticalMetric').textContent=String(puzzle.verticalCount||0);
 $('#verticalMetricSub').textContent='senkrechte Lösungen';
 showResultBanner(stats);
}

function evaluate({automatic=false}={}){
 const stats=answerStats(); puzzle.checked=true; save(); render();
 if(!stats.empty&&!stats.wrong){$('#winModal').classList.add('show');toast('Alles richtig – Rätsel gelöst!');}
 else if(stats.wrong)toast(`${stats.wrong} ${stats.wrong===1?'falscher Buchstabe wurde':'falsche Buchstaben wurden'} rot markiert.`);
 else if(!automatic)toast(`${stats.empty} Felder sind noch leer.`);
 return stats;
}
function maybeEvaluate(){
 if(finishing)return; const stats=answerStats();
 if(stats.total&&stats.filled===stats.total){finishing=true;setTimeout(()=>{evaluate({automatic:true});finishing=false;},180);}
}
function setLetter(letter){
 const entry=entryById(selectedEntry); if(!entry)return; const point=entry.answer[selectedCell]; const key=keyOf(point);
 puzzle.values[key]=letter; if(puzzle.hints?.cells)delete puzzle.hints.cells[key]; puzzle.checked=false;
 if(selectedCell<entry.answer.length-1)selectedCell++; save(); render(); maybeEvaluate();
}
function fillWord(text){
 const entry=entryById(selectedEntry); const letters=clean(text); if(!entry||!letters)return;
 for(let i=0;i<Math.min(entry.answer.length,letters.length);i++){
  const key=keyOf(entry.answer[i]); puzzle.values[key]=letters[i]; if(puzzle.hints?.cells)delete puzzle.hints.cells[key];
 }
 selectedCell=Math.min(entry.answer.length-1,Math.max(0,letters.length-1)); puzzle.checked=false; save(); render();
 toast(letters.length===entry.word.length?'Wort übernommen.':'Eingabe teilweise übernommen.'); maybeEvaluate();
}
function eraseSelected(){
 const entry=entryById(selectedEntry); if(!entry)return;
 for(const point of entry.answer){const key=keyOf(point);delete puzzle.values[key];if(puzzle.hints?.cells)delete puzzle.hints.cells[key];}
 selectedCell=0;puzzle.checked=false;save();render();
}
function nextEntry(){
 const index=puzzle.entries.findIndex(entry=>entry.id===selectedEntry); const next=puzzle.entries[(index+1)%puzzle.entries.length]; selectEntry(next.id,0);
}
function revealLetter(){
 const entry=entryById(selectedEntry); if(!entry)return;
 const unresolved=entry.answer.map((point,index)=>({point,index,key:keyOf(point),value:puzzle.values[keyOf(point)]||'',solution:puzzle.cells[point.r][point.c].solution})).filter(item=>item.value!==item.solution);
 if(!unresolved.length){toast('Dieses Wort ist bereits vollständig richtig.');return;}
 const choice=unresolved.find(item=>item.index===selectedCell)||unresolved.find(item=>!item.value)||unresolved[0]; const hints=ensureHints();
 puzzle.values[choice.key]=choice.solution; hints.cells[choice.key]='letter'; hints.letters=(hints.letters||0)+1; selectedCell=choice.index; puzzle.checked=false; save(); render(); toast('Ein Buchstabe wurde aufgedeckt.'); maybeEvaluate();
}
function revealWord(){
 const entry=entryById(selectedEntry); if(!entry)return;
 const already=entry.answer.every((point,index)=>(puzzle.values[keyOf(point)]||'')===entry.word[index]);
 if(already){toast('Dieses Wort ist bereits vollständig richtig.');return;}
 if(!window.confirm('Soll das komplette Lösungswort für diese Frage eingetragen werden?'))return;
 const hints=ensureHints();
 entry.answer.forEach((point,index)=>{const key=keyOf(point);puzzle.values[key]=entry.word[index];hints.cells[key]='word';});
 hints.words=(hints.words||0)+1;selectedCell=entry.answer.length-1;puzzle.checked=false;save();render();toast('Das vollständige Wort wurde eingesetzt.');maybeEvaluate();
}

function makeKeyboard(){
 const keyboard=$('#keyboard'); keyboard.innerHTML='';
 for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'){
  const button=document.createElement('button');button.className='key';button.type='button';button.textContent=letter;button.onclick=()=>setLetter(letter);keyboard.appendChild(button);
 }
 const del=document.createElement('button');del.className='key delete';del.type='button';del.textContent='⌫';del.onclick=()=>{
  const entry=entryById(selectedEntry);if(!entry)return;const point=entry.answer[selectedCell];const key=keyOf(point);delete puzzle.values[key];if(puzzle.hints?.cells)delete puzzle.hints.cells[key];if(selectedCell>0)selectedCell--;puzzle.checked=false;save();render();
 };keyboard.appendChild(del);
}

function bind(){
 makeKeyboard();
 $('#homeBtn').onclick=()=>location.href='./index.html';
 $('#newBtn').onclick=()=>start(true);
 $('#clearBtn').onclick=()=>{puzzle.values={};puzzle.hints={letters:0,words:0,cells:{}};puzzle.checked=false;save();render();toast('Alle Einträge wurden gelöscht.');};
 $('#checkBtn').onclick=()=>evaluate({automatic:false});
 $('#eraseWord').onclick=eraseSelected; $('#nextWord').onclick=nextEntry; $('#hintLetter').onclick=revealLetter; $('#hintWord').onclick=revealWord;
 $('#closeWin').onclick=()=>$('#winModal').classList.remove('show');
 $('#newAfterWin').onclick=()=>{$('#winModal').classList.remove('show');start(true);};
 document.addEventListener('keydown',event=>{
  if(event.target===$('#wordInput'))return;
  if(/^[a-zA-Z]$/.test(event.key)){event.preventDefault();setLetter(event.key.toUpperCase());}
  else if(event.key==='Backspace'){event.preventDefault();$('#keyboard .key:last-child').click();}
  else if(event.key==='Tab'){event.preventDefault();nextEntry();}
 });
 const input=$('#wordInput'); const state=$('#recognitionState');
 function commit(){clearTimeout(inputTimer);if(compose)return;const value=clean(input.value);if(!value)return;input.value='';fillWord(value);state.textContent='Apple Kritzeln';setTimeout(()=>input.focus({preventScroll:true}),50);}
 function schedule(){clearTimeout(inputTimer);const value=clean(input.value);state.textContent=value?`Erkannt: ${value}`:'Apple Kritzeln';if(value)inputTimer=setTimeout(commit,900);}
 input.addEventListener('compositionstart',()=>{compose=true;state.textContent='Schrift wird erkannt …';});
 input.addEventListener('compositionend',()=>{compose=false;schedule();});
 input.addEventListener('input',()=>{if(!compose)schedule();});
 input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commit();}});
}

async function start(newOne=false){
 try{
  if(worker){worker.postMessage({type:'cancel'});worker.terminate();worker=null;}
  $('#status').textContent='15.000 Fragen werden geladen …';
  const saved=!newOne&&!forceNew?loadSaved():null;
  if(saved&&saved.cells&&saved.entries&&saved.generatorVersion===12){puzzle=saved;showBuild(false);}
  else{
   localStorage.removeItem(stateKey);
   const rows=await loadBank();
   puzzle=await generateWithWorker(rows); rememberPuzzleWords(); save();
  }
  selectedEntry=puzzle.entries[0].id;selectedCell=0;render();setTimeout(()=>$('#wordInput').focus({preventScroll:true}),80);
 }catch(error){
  showBuild(false);$('#status').textContent=`Fehler: ${error.message||error}`;toast(error.message||String(error));console.error(error);
 }
}

bind();
start(false);
})();
