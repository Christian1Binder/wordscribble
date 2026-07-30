(()=>{
  'use strict';
  const $=s=>document.querySelector(s);
  const card=$('.write-card');
  const canvas=$('.canvas-wrap');
  const actions=$('.write-actions');
  const recognition=$('.recognition');
  if(!card||!canvas||!actions||!recognition)return;

  const style=document.createElement('style');
  style.textContent=`
    .ws-mode-switch{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:5px;background:#eef1f7;border-radius:13px;margin-bottom:10px}
    .ws-mode-btn{border:0;border-radius:9px;min-height:39px;background:transparent;color:var(--muted);font-weight:750}
    .ws-mode-btn.active{background:#fff;color:var(--accent);box-shadow:0 2px 9px rgba(28,39,70,.1)}
    .ws-scribble-wrap{position:relative;border:2px solid var(--accent);border-radius:15px;background:#fff;overflow:hidden;min-height:190px;display:grid;place-items:center;padding:16px}
    .ws-scribble-wrap:focus-within{box-shadow:0 0 0 4px rgba(49,87,213,.14)}
    #wsScribbleInput{width:100%;height:150px;border:0;outline:0;background:transparent;text-align:center;text-transform:uppercase;font-size:clamp(58px,13vw,92px);font-weight:760;letter-spacing:.08em;color:var(--ink);caret-color:var(--accent);padding:10px}
    #wsScribbleInput::placeholder{font-size:clamp(16px,3vw,22px);font-weight:600;letter-spacing:0;text-transform:none;color:#a0a7b5}
    .ws-scribble-help{margin:8px 2px 0;color:var(--muted);font-size:.8rem;line-height:1.35}.ws-scribble-help strong{color:var(--ink)}
    .ws-draw-panel[hidden],.ws-scribble-panel[hidden]{display:none!important}
    .ws-draw-note{margin:0 0 8px;padding:8px 10px;border-radius:10px;background:#fff4e5;border:1px solid #f0d5aa;color:#765320;font-size:.8rem}
  `;
  document.head.appendChild(style);

  const mode=document.createElement('div');
  mode.className='ws-mode-switch';
  mode.innerHTML='<button class="ws-mode-btn active" id="wsScribbleBtn" type="button">Apple Kritzeln</button><button class="ws-mode-btn" id="wsDrawBtn" type="button">Zeichnen (Test)</button>';

  const scribblePanel=document.createElement('div');
  scribblePanel.className='ws-scribble-panel';
  scribblePanel.innerHTML=`<div class="ws-scribble-wrap"><input id="wsScribbleInput" type="text" inputmode="text" enterkeyhint="next" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" maxlength="4" aria-label="Buchstabe mit Apple Pencil schreiben" placeholder="Hier mit Apple Pencil schreiben"></div><div class="ws-scribble-help"><strong>Für beste Erkennung:</strong> Auf dem iPad unter „Einstellungen → Apple Pencil“ die Funktion „Kritzeln“ aktivieren. Schreibe jeweils nur einen Großbuchstaben.</div>`;

  const drawPanel=document.createElement('div');
  drawPanel.className='ws-draw-panel';
  const note=document.createElement('div');
  note.className='ws-draw-note';
  note.textContent='Experimenteller alter Formvergleich – nur noch zum Gegencheck.';
  drawPanel.append(note,canvas,actions,recognition);

  const clue=$('.current-clue');
  clue.after(mode,scribblePanel,drawPanel);

  const hint=$('.puzzle-hint');
  if(hint)hint.textContent='Tipp: Ein Feld antippen und rechts im großen Textfeld mit dem Apple Pencil schreiben. Apples „Kritzeln“ übernimmt die Erkennung und springt danach zum nächsten Kästchen. Ein erneutes Tippen auf ein Kreuzungsfeld wechselt die Richtung.';

  const badge=$('#deviceBadge');
  const input=$('#wsScribbleInput');
  const scribbleBtn=$('#wsScribbleBtn');
  const drawBtn=$('#wsDrawBtn');
  let timer;

  function setMode(next,remember=true){
    const scribble=next!=='draw';
    scribblePanel.hidden=!scribble;
    drawPanel.hidden=scribble;
    scribbleBtn.classList.toggle('active',scribble);
    drawBtn.classList.toggle('active',!scribble);
    if(badge)badge.textContent=scribble?'Apple-Kritzeln bereit':'Zeichen-Test aktiv';
    if(remember)localStorage.setItem('wordscribble-input-mode-v2',scribble?'scribble':'draw');
    if(scribble)setTimeout(()=>input.focus({preventScroll:true}),60);
  }

  function submit(){
    const letters=input.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().match(/[A-Z]/g);
    if(!letters?.length)return;
    clearTimeout(timer);
    timer=setTimeout(()=>{
      const letter=letters[letters.length-1];
      input.value='';
      window.dispatchEvent(new KeyboardEvent('keydown',{key:letter,bubbles:true,cancelable:true}));
      setTimeout(()=>input.focus({preventScroll:true}),80);
    },70);
  }

  input.addEventListener('input',submit);
  input.addEventListener('compositionend',submit);
  input.addEventListener('pointerdown',e=>{if(badge)badge.textContent=e.pointerType==='pen'?'Apple Pencil · Kritzeln':'Texteingabe aktiv'});
  input.addEventListener('focus',()=>{if(!scribblePanel.hidden&&badge)badge.textContent='In das Feld schreiben'});
  scribbleBtn.addEventListener('click',()=>setMode('scribble'));
  drawBtn.addEventListener('click',()=>setMode('draw'));
  setMode(localStorage.getItem('wordscribble-input-mode-v2')||'scribble',false);
})();
