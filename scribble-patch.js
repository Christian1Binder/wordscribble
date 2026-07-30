(()=>{
  'use strict';

  function init(attempt=0){
    const panel=document.querySelector('.entry-panel');
    const body=panel?.querySelector('.panel-body');
    const canvasWrap=document.querySelector('#canvasWrap');
    const canvasActions=panel?.querySelector('.canvas-actions');
    const recognitionBox=document.querySelector('#recognitionBox');
    const learnNote=panel?.querySelector('.learn-note');
    const subtitle=panel?.querySelector('.panel-subtitle');
    const badge=panel?.querySelector('.badge');

    if(!panel||!body||!canvasWrap||!canvasActions||!recognitionBox){
      if(attempt<40)setTimeout(()=>init(attempt+1),100);
      return;
    }
    if(document.querySelector('#wsScribbleInput'))return;

    const style=document.createElement('style');
    style.textContent=`
      .ws-mode-switch{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:5px;background:#eef1f7;border-radius:13px;margin:0 0 12px}
      .ws-mode-btn{border:0;border-radius:9px;min-height:42px;background:transparent;color:#677089;font-weight:750}
      .ws-mode-btn.active{background:#fff;color:#3157d5;box-shadow:0 2px 9px rgba(28,39,70,.1)}
      .ws-scribble-panel{margin-bottom:12px}
      .ws-scribble-wrap{border:2px solid #3157d5;border-radius:15px;background:#fff;min-height:220px;display:grid;place-items:center;padding:16px;overflow:hidden}
      .ws-scribble-wrap:focus-within{box-shadow:0 0 0 4px rgba(49,87,213,.14)}
      #wsScribbleInput{width:100%;height:175px;border:0;outline:0;background:transparent;text-align:center;text-transform:uppercase;font-size:clamp(64px,13vw,104px);font-weight:760;letter-spacing:.08em;color:#182033;caret-color:#3157d5;padding:10px}
      #wsScribbleInput::placeholder{font-size:clamp(16px,2.6vw,23px);font-weight:600;letter-spacing:0;text-transform:none;color:#a0a7b5}
      .ws-help{margin:9px 2px 0;color:#677089;font-size:.84rem;line-height:1.4}
      .ws-help strong{color:#182033}
      .ws-hidden{display:none!important}
    `;
    document.head.appendChild(style);

    const mode=document.createElement('div');
    mode.className='ws-mode-switch';
    mode.innerHTML='<button class="ws-mode-btn active" id="wsScribbleBtn" type="button">Apple Kritzeln</button><button class="ws-mode-btn" id="wsDrawBtn" type="button">Zeichnen (Test)</button>';

    const scribble=document.createElement('div');
    scribble.className='ws-scribble-panel';
    scribble.innerHTML=`<div class="ws-scribble-wrap"><input id="wsScribbleInput" type="text" inputmode="text" enterkeyhint="next" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" maxlength="4" aria-label="Buchstabe mit Apple Pencil schreiben" placeholder="Hier mit dem Apple Pencil schreiben"></div><div class="ws-help"><strong>Apple-Kritzeln:</strong> Unter „Einstellungen → Apple Pencil“ muss „Kritzeln“ aktiviert sein. Schreibe jeweils nur einen Buchstaben.</div>`;

    canvasWrap.before(mode,scribble);

    const scribbleBtn=document.querySelector('#wsScribbleBtn');
    const drawBtn=document.querySelector('#wsDrawBtn');
    const input=document.querySelector('#wsScribbleInput');
    let timer;

    function setMode(next){
      const useScribble=next!=='draw';
      scribble.classList.toggle('ws-hidden',!useScribble);
      canvasWrap.classList.toggle('ws-hidden',useScribble);
      canvasActions.classList.toggle('ws-hidden',useScribble);
      recognitionBox.classList.toggle('ws-hidden',useScribble);
      if(learnNote)learnNote.classList.toggle('ws-hidden',useScribble);
      scribbleBtn.classList.toggle('active',useScribble);
      drawBtn.classList.toggle('active',!useScribble);
      if(subtitle)subtitle.textContent=useScribble?'Mit dem Apple Pencil direkt als Text schreiben':'Experimenteller alter Formvergleich';
      if(badge)badge.textContent=useScribble?'Apple Kritzeln':'Zeichen-Test';
      localStorage.setItem('wordscribble-input-mode-v3',useScribble?'scribble':'draw');
      if(useScribble)setTimeout(()=>input.focus({preventScroll:true}),80);
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
      },90);
    }

    input.addEventListener('input',submit);
    input.addEventListener('compositionend',submit);
    input.addEventListener('pointerdown',e=>{if(badge)badge.textContent=e.pointerType==='pen'?'Apple Pencil · Kritzeln':'Texteingabe'});
    scribbleBtn.addEventListener('click',()=>setMode('scribble'));
    drawBtn.addEventListener('click',()=>setMode('draw'));

    setMode(localStorage.getItem('wordscribble-input-mode-v3')||'scribble');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init());
  else init();
})();