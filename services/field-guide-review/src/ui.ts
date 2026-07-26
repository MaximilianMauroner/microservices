import crypto from "node:crypto";
import type { RequestHandler } from "express";

export const reviewConsole: RequestHandler = (_req, res) => {
  const nonce = crypto.randomBytes(18).toString("base64");

  return res
    .set({
      "Cache-Control": "no-store",
      "Content-Security-Policy": [
        "default-src 'none'",
        "style-src 'self'",
        `script-src 'nonce-${nonce}' https://shoo.dev`,
        "connect-src 'self' https://shoo.dev",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join("; "),
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    })
    .type("html")
    .send(renderPage(nonce));
};

function renderPage(nonce: string) {
  return `<!doctype html>
<html lang="en" class="bg-stone-950">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <title>Field guide reviews</title>
    <link rel="stylesheet" href="/review.css">
    <script src="https://shoo.dev/shoo.js" nonce="${nonce}" data-shoo-callback-path="/review/callback" data-shoo-pii="true" data-shoo-auto-callback="false" defer></script>
  </head>
  <body class="min-h-screen bg-stone-950 text-stone-200 antialiased selection:bg-amber-300 selection:text-stone-950">
    <header class="sticky top-0 z-30 border-b border-stone-800 bg-stone-950/95 backdrop-blur">
      <div class="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <a href="/review" class="group flex min-w-0 items-center gap-3" aria-label="Field guide reviews home">
          <span class="grid size-9 shrink-0 place-items-center rounded-md border border-stone-700 bg-stone-900 font-serif text-lg text-amber-300 group-hover:border-stone-600">F</span>
          <span class="min-w-0">
            <span class="block truncate font-serif text-lg leading-none text-stone-100">Field guide</span>
            <span class="mt-1 block text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-stone-500">Review desk</span>
          </span>
        </a>
        <div class="flex items-center gap-2">
          <span id="account-label" class="hidden max-w-48 truncate text-xs text-stone-500 sm:block"></span>
          <button data-sign-in class="button-primary">Sign in</button>
          <button id="sign-out" class="button-quiet hidden">Sign out</button>
        </div>
      </div>
      <nav id="review-nav" class="mx-auto hidden max-w-3xl items-center gap-3 overflow-x-auto px-4 pb-4 sm:px-6" aria-label="Review filters">
        <div class="segmented-control" role="group" aria-label="Field guide scope">
          <button class="segment" data-scope="project" aria-pressed="true">Project</button>
          <button class="segment" data-scope="global" aria-pressed="false">Global</button>
        </div>
        <div class="segmented-control" role="group" aria-label="Review view">
          <button class="segment" data-view="queue" aria-pressed="true">Queue</button>
          <button class="segment" data-view="history" aria-pressed="false">History</button>
        </div>
      </nav>
    </header>

    <main class="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <section id="signed-out" class="mx-auto max-w-xl border-y border-stone-800 py-14 text-center sm:py-20">
        <p class="eyebrow">Private review queue</p>
        <h1 class="mt-4 font-serif text-4xl leading-tight text-stone-100 sm:text-5xl">Decide what your agents remember.</h1>
        <p class="mx-auto mt-5 max-w-md text-sm leading-7 text-stone-400">Candidate lessons stay inactive until you approve them. Sign in with the configured Google account to review project and global guidance.</p>
        <button data-sign-in class="button-primary mt-8 px-5 py-3">Sign in with Google</button>
        <p id="auth-message" class="mt-4 min-h-5 text-sm text-stone-500" role="status" aria-live="polite"></p>
      </section>

      <section id="workspace" class="hidden">
        <div class="mb-8 flex items-end justify-between gap-4 border-b border-stone-800 pb-5">
          <div>
            <p id="view-eyebrow" class="eyebrow">Project field guide</p>
            <h1 id="view-title" class="mt-2 font-serif text-3xl text-stone-100">Pending review</h1>
          </div>
          <p id="summary" class="shrink-0 text-right text-xs leading-5 text-stone-500" aria-live="polite"></p>
        </div>
        <div id="review-list" class="space-y-6" aria-live="polite"></div>
      </section>
    </main>

    <div id="toast" class="pointer-events-none fixed inset-x-4 bottom-4 z-50 hidden sm:left-auto sm:w-96" role="status" aria-live="polite">
      <div class="pointer-events-auto border border-stone-700 bg-stone-900 px-4 py-3 shadow-2xl shadow-black/30">
        <div class="flex items-start gap-3">
          <span id="toast-mark" class="mt-1 size-2 shrink-0 rounded-full bg-amber-300"></span>
          <p id="toast-message" class="min-w-0 flex-1 text-sm leading-6 text-stone-200"></p>
          <button id="toast-close" class="button-quiet -mr-2 -mt-1 px-2" aria-label="Dismiss message">Close</button>
        </div>
      </div>
    </div>

    <script nonce="${nonce}">
const elements={account:document.getElementById('account-label'),authMessage:document.getElementById('auth-message'),nav:document.getElementById('review-nav'),reviewList:document.getElementById('review-list'),signedOut:document.getElementById('signed-out'),signOut:document.getElementById('sign-out'),summary:document.getElementById('summary'),toast:document.getElementById('toast'),toastClose:document.getElementById('toast-close'),toastMark:document.getElementById('toast-mark'),toastMessage:document.getElementById('toast-message'),viewEyebrow:document.getElementById('view-eyebrow'),viewTitle:document.getElementById('view-title'),workspace:document.getElementById('workspace')};
const callbackUrl=location.origin+'/review/callback';
const params=new URLSearchParams(location.search);
const state={scope:params.get('scope')==='global'?'global':'project',view:params.get('view')==='history'?'history':'queue',token:null,identity:null,cursor:null,historyItems:[],loadVersion:0,controller:null,toastTimer:null};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const humanAction={approve:'Approved',reject:'Rejected',defer:'Deferred',confirm_valid:'Confirmed valid',mark_invalid:'Marked invalid'};
const buttonLabel={approve:'Approve',reject:'Reject',defer:'Defer',confirm_valid:'Still valid',mark_invalid:'No longer valid'};
function setHidden(element,hidden){element.classList.toggle('hidden',hidden)}
function showToast(message,type='info',persistent=false){clearTimeout(state.toastTimer);elements.toastMessage.textContent=message;elements.toastMark.className='mt-1 size-2 shrink-0 rounded-full '+(type==='error'?'bg-red-400':type==='success'?'bg-emerald-400':'bg-amber-300');elements.toast.setAttribute('role',type==='error'?'alert':'status');setHidden(elements.toast,false);if(!persistent)state.toastTimer=setTimeout(()=>setHidden(elements.toast,true),4200)}
function showAuthMessage(message,error=false){elements.authMessage.textContent=message;elements.authMessage.classList.toggle('text-red-400',error);elements.authMessage.classList.toggle('text-stone-500',!error)}
function setAuthenticated(authenticated){setHidden(elements.signedOut,authenticated);setHidden(elements.workspace,!authenticated);elements.nav.classList.toggle('hidden',!authenticated);elements.nav.classList.toggle('flex',authenticated);document.querySelectorAll('[data-sign-in]').forEach(button=>button.classList.toggle('hidden',authenticated));setHidden(elements.signOut,!authenticated);setHidden(elements.account,!authenticated)}
function updateNavigation(){document.querySelectorAll('[data-scope]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.scope===state.scope)));document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===state.view)));const query=new URLSearchParams({scope:state.scope,view:state.view});history.replaceState(null,'','/review?'+query.toString());elements.viewEyebrow.textContent=state.scope==='project'?'Project field guide':'Global field guide';elements.viewTitle.textContent=state.view==='queue'?'Pending review':'Decision history'}
function renderSummary(summary){const overdue=summary.overdue>0?' · '+summary.overdue+' overdue':'';elements.summary.textContent=summary.pending+' pending · '+summary.due+' due'+overdue;elements.summary.classList.toggle('text-amber-300',summary.overdue>0);elements.summary.classList.toggle('text-stone-500',summary.overdue===0)}
function renderSkeletons(){elements.reviewList.innerHTML=[0,1].map(()=>'<div class="review-card animate-pulse"><div class="h-3 w-32 bg-stone-800"></div><div class="mt-6 h-7 w-2/3 bg-stone-800"></div><div class="mt-5 h-3 w-full bg-stone-800"></div><div class="mt-2 h-3 w-5/6 bg-stone-800"></div><div class="mt-8 h-10 w-full bg-stone-800"></div></div>').join('')}
function renderEmpty(){const title=state.view==='queue'?'Nothing to review':'No decisions yet',copy=state.view==='queue'?'Every candidate in this scope has been handled.':'Reviewed lessons will appear here as an immutable ledger.';elements.reviewList.innerHTML='<div class="empty-state"><p class="font-serif text-2xl text-stone-200">'+title+'</p><p class="mt-3 text-sm leading-6 text-stone-500">'+copy+'</p></div>'}
function relativeTime(value){const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';const delta=Math.round((date.getTime()-Date.now())/60000),abs=Math.abs(delta),formatter=new Intl.RelativeTimeFormat('en',{numeric:'auto'});if(abs<60)return formatter.format(delta,'minute');if(abs<1440)return formatter.format(Math.round(delta/60),'hour');return formatter.format(Math.round(delta/1440),'day')}
function evidenceMarkup(evidence){return evidence.map(item=>'<div class="evidence-item"><blockquote>'+escapeHtml(item.excerpt)+'</blockquote><div class="mt-3 flex flex-wrap items-center gap-2">'+(item.sessionRef?'<code class="provenance-chip">'+escapeHtml(item.sessionRef)+'</code>':'')+item.commitHashes.map(hash=>'<code class="provenance-chip">'+escapeHtml(hash)+'</code>').join('')+'</div></div>').join('')}
function queueCard(item){const candidate=item.candidate,actions=item.kind==='initial'?['approve','reject','defer']:['confirm_valid','mark_invalid','defer'],project=candidate.projectDisplayName||candidate.projectKey||'Global',timing=item.dueAt?'<span title="'+escapeHtml(item.dueAt)+'">'+escapeHtml(relativeTime(item.dueAt))+'</span>':'',actionButtons=actions.map(action=>action==='defer'?'<button class="button-quiet" data-show-defer>'+buttonLabel[action]+'</button>':'<button class="'+(action==='approve'||action==='confirm_valid'?'button-verdict-positive':'button-verdict-negative')+'" data-verdict="'+action+'">'+buttonLabel[action]+'</button>').join('');return '<article class="review-card '+(item.status==='overdue'?'review-card-overdue':item.status==='due'?'review-card-due':'')+'" data-id="'+escapeHtml(candidate.candidateId)+'" data-round="'+item.round+'"><div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500"><span class="scope-label">'+escapeHtml(project)+'</span><span aria-hidden="true">·</span><span class="status-label">'+escapeHtml(item.kind==='initial'?'New candidate':'Revalidation')+'</span><span aria-hidden="true">·</span><span>Round '+item.round+'</span>'+(timing?'<span aria-hidden="true">·</span>'+timing:'')+'</div><h2 class="lesson-title">'+escapeHtml(candidate.title)+'</h2><div class="lesson-body">'+escapeHtml(candidate.body)+'</div><div class="rationale"><span class="eyebrow">Why remember this</span><p class="mt-2">'+escapeHtml(candidate.rationale)+'</p></div><details class="evidence group"><summary><span class="evidence-chevron" aria-hidden="true">›</span> Evidence <span class="text-stone-600">('+candidate.evidence.length+')</span></summary><div class="mt-4 space-y-4">'+evidenceMarkup(candidate.evidence)+'</div></details><div class="verdict-bar">'+actionButtons+'</div><div class="defer-panel hidden" data-defer-panel><div class="flex-1"><label class="field-label">Review again after</label><input class="date-field" type="datetime-local" data-defer-date></div><div class="flex flex-wrap gap-2"><button class="button-quiet" data-preset-days="7">1 week</button><button class="button-quiet" data-preset-days="30">1 month</button><button class="button-primary" data-confirm-defer>Confirm defer</button></div></div></article>'}
function historyRow(decision){const project=decision.projectDisplayName||decision.projectKey||'Global';return '<article class="history-row"><div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500"><span class="scope-label">'+escapeHtml(project)+'</span><span aria-hidden="true">·</span><span>'+escapeHtml(humanAction[decision.action]||decision.action)+'</span><span aria-hidden="true">·</span><span title="'+escapeHtml(decision.reviewedAt)+'">'+escapeHtml(relativeTime(decision.reviewedAt))+'</span></div><h2 class="mt-3 font-serif text-xl text-stone-200">'+escapeHtml(decision.title)+'</h2><p class="mt-2 text-xs text-stone-500">Round '+decision.round+' · reviewed by '+escapeHtml(decision.reviewer)+'</p><details class="evidence group mt-4"><summary><span class="evidence-chevron" aria-hidden="true">›</span> Review evidence <span class="text-stone-600">('+decision.evidence.length+')</span></summary><div class="mt-4 space-y-4">'+evidenceMarkup(decision.evidence)+'</div></details></article>'}
function renderQueue(items){if(items.length===0){renderEmpty();return}elements.reviewList.innerHTML=items.map(queueCard).join('');bindQueueControls()}
function renderHistory(decisions,hasMore,append){state.historyItems=append?state.historyItems.concat(decisions):decisions;if(state.historyItems.length===0){renderEmpty();return}elements.reviewList.innerHTML=state.historyItems.map(historyRow).join('')+(hasMore?'<button id="load-more" class="button-secondary mx-auto flex">Load older decisions</button>':'<p class="py-3 text-center text-xs text-stone-600">End of history</p>');const loadMore=document.getElementById('load-more');if(loadMore)loadMore.addEventListener('click',()=>loadReviews(true))}
async function api(path,options={}){const response=await fetch(path,{...options,signal:options.signal,headers:{Authorization:'Bearer '+state.token,'Content-Type':'application/json'}}),text=await response.text();let payload={};try{payload=text?JSON.parse(text):{}}catch{payload={message:'The service returned an unreadable response.'}}if(!response.ok){const error=new Error(payload.message||('Request failed with status '+response.status+'.'));error.status=response.status;error.code=payload.error;throw error}return payload}
function friendlyError(error){if(error.name==='AbortError')return null;if(error.status===401)return 'Your session expired. Sign in again to continue.';if(error.code==='origin_forbidden')return 'This deployment origin does not match PUBLIC_BASE_URL.';if(error.status===409)return 'A verdict was already recorded for this review. The queue has been refreshed.';return error.message||'Something went wrong. Please try again.'}
async function loadReviews(append=false){if(!state.token)return;const version=++state.loadVersion;if(!append){state.controller?.abort();state.controller=new AbortController();renderSkeletons()}updateNavigation();try{const cursor=append&&state.cursor?'&cursor='+encodeURIComponent(state.cursor):'',data=await api('/api/review/'+state.view+'?scope='+state.scope+cursor,{signal:state.controller?.signal});if(version!==state.loadVersion)return;renderSummary(data.summary);if(state.view==='history'){state.cursor=data.nextCursor||null;renderHistory(data.decisions,data.hasMore,append)}else{state.cursor=null;state.historyItems=[];renderQueue(data.items)}}catch(error){const message=friendlyError(error);if(!message)return;if(error.status===401){state.token=null;state.identity=null;setAuthenticated(false);showAuthMessage(message,true)}else{showToast(message,'error',true);if(!append&&elements.reviewList.children.length===0)renderEmpty()}}}
function setDeferDate(input,days){const date=new Date(Date.now()+days*86400000);input.value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function setCardBusy(card,busy){card.setAttribute('aria-busy',String(busy));card.classList.toggle('is-busy',busy);card.querySelectorAll('button,input').forEach(control=>control.disabled=busy)}
async function submitVerdict(card,action,deferUntil){setCardBusy(card,true);showToast('Saving review…','info',true);try{await api('/api/review/candidates/'+encodeURIComponent(card.dataset.id)+'/rounds/'+encodeURIComponent(card.dataset.round)+'/verdict',{method:'POST',body:JSON.stringify({action,...(deferUntil?{deferUntil}: {})})});card.remove();showToast('Review saved.','success');await loadReviews(false)}catch(error){setCardBusy(card,false);const message=friendlyError(error);if(message)showToast(message,'error',true);if(error.status===409)await loadReviews(false)}}
function bindQueueControls(){document.querySelectorAll('[data-show-defer]').forEach(button=>button.addEventListener('click',()=>{const card=button.closest('article'),panel=card.querySelector('[data-defer-panel]'),input=card.querySelector('[data-defer-date]');panel.classList.toggle('hidden');if(!panel.classList.contains('hidden')){if(!input.value)setDeferDate(input,7);input.focus()}}));document.querySelectorAll('[data-preset-days]').forEach(button=>button.addEventListener('click',()=>setDeferDate(button.closest('article').querySelector('[data-defer-date]'),Number(button.dataset.presetDays))));document.querySelectorAll('[data-verdict]').forEach(button=>button.addEventListener('click',()=>submitVerdict(button.closest('article'),button.dataset.verdict)));document.querySelectorAll('[data-confirm-defer]').forEach(button=>button.addEventListener('click',()=>{const card=button.closest('article'),input=card.querySelector('[data-defer-date]'),date=new Date(input.value);if(!input.value||!Number.isFinite(date.getTime())||date.getTime()<=Date.now()){showToast('Choose a future date before deferring.','error',true);input.focus();return}submitVerdict(card,'defer',date.toISOString())}))}
async function startSignIn(){if(!window.Shoo){showAuthMessage('Google sign-in is unavailable. Refresh and try again.',true);return}try{showAuthMessage('Opening secure sign-in…');await window.Shoo.startSignIn({redirectUri:callbackUrl,requestPii:true})}catch(error){showAuthMessage(error.message||'Sign in failed.',true)}}
async function boot(){setAuthenticated(false);if(!window.Shoo){showAuthMessage('Google sign-in could not load. Refresh and try again.',true);return}try{const callback=window.Shoo.parseCallback();if(callback){await window.Shoo.handleCallback({redirectUri:callbackUrl,redirectTo:'/review'});return}updateNavigation();const identity=window.Shoo.getIdentity();if(!identity.userId||!identity.token){showAuthMessage('Sign in to review lessons.');return}state.identity=identity;state.token=identity.token;elements.account.textContent='Reviewer';setAuthenticated(true);await loadReviews(false)}catch(error){showAuthMessage(error.message||'Authentication failed.',true)}}
document.querySelectorAll('[data-sign-in]').forEach(button=>button.addEventListener('click',startSignIn));elements.signOut.addEventListener('click',()=>{if(window.Shoo)window.Shoo.clearIdentity();location.assign('/review')});elements.toastClose.addEventListener('click',()=>setHidden(elements.toast,true));document.querySelectorAll('[data-scope]').forEach(button=>button.addEventListener('click',()=>{if(!state.token)return;state.scope=button.dataset.scope;state.cursor=null;state.historyItems=[];loadReviews(false)}));document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{if(!state.token)return;state.view=button.dataset.view;state.cursor=null;state.historyItems=[];loadReviews(false)}));addEventListener('load',boot);
    </script>
  </body>
</html>`;
}
