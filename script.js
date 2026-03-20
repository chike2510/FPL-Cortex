/**
 * script.js — FPL CORTEX
 * All 15 features implemented:
 * 1. GW History Chart      2. Price Change Tracker  3. Chip Planner
 * 4. Differential Picks    5. Player Comparison     6. FDR Calendar
 * 7. Blank/Double GW       8. Auto Squad Builder    9. Wildcard Planner
 * 10. Points Predictor     11. H2H Tracker          12. Rank Tracker
 * 13. PWA Install          14. Push Notifications   15. Dark/Light Theme
 */
'use strict';

/* ══════════════════════════════════════════════════════════════
   PROXIES
══════════════════════════════════════════════════════════════ */
const FPL = 'https://fantasy.premierleague.com/api';
const PROXIES = [
  p => `/api/proxy?path=${encodeURIComponent(p)}`,
  p => `https://corsproxy.io/?${encodeURIComponent(`${FPL}${p}`)}`,
  p => `https://api.allorigins.win/raw?url=${encodeURIComponent(`${FPL}${p}`)}`,
  p => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(`${FPL}${p}`)}`,
];
async function fplFetch(path) {
  let err;
  for (const mk of PROXIES) {
    try { const r = await fetch(mk(path)); if (r.ok) return r; err = new Error(`HTTP ${r.status}`); }
    catch (e) { err = e; }
  }
  throw err || new Error('All proxies failed');
}
const CACHE_TTL = 5*60*1000;
function cGet(k){try{const r=sessionStorage.getItem(k);if(!r)return null;const{d,t}=JSON.parse(r);if(Date.now()-t>CACHE_TTL){sessionStorage.removeItem(k);return null;}return d;}catch{return null;}}
function cSet(k,d){try{sessionStorage.setItem(k,JSON.stringify({d,t:Date.now()}));}catch{}}

/* ══════════════════════════════════════════════════════════════
   TEAM COLOURS
══════════════════════════════════════════════════════════════ */
const TC={ARS:{p:'#EF0107',s:'#FFFFFF'},AVL:{p:'#670E36',s:'#95BFE5'},BOU:{p:'#DA291C',s:'#000000'},BRE:{p:'#E30613',s:'#FFFFFF'},BHA:{p:'#0057B8',s:'#FFFFFF'},CHE:{p:'#034694',s:'#FFFFFF'},CRY:{p:'#1B458F',s:'#C4122E'},EVE:{p:'#003399',s:'#FFFFFF'},FUL:{p:'#CCCCCC',s:'#231F20'},IPS:{p:'#0044A9',s:'#FFFFFF'},LEI:{p:'#003090',s:'#FDBE11'},LIV:{p:'#C8102E',s:'#00B2A9'},MCI:{p:'#6CABDD',s:'#FFFFFF'},MUN:{p:'#DA291C',s:'#FBE122'},NEW:{p:'#241F20',s:'#FFFFFF'},NFO:{p:'#DD0000',s:'#FFFFFF'},SOU:{p:'#D71920',s:'#FFFFFF'},TOT:{p:'#F0F0F0',s:'#132257'},WHU:{p:'#7A263A',s:'#1BB1E7'},WOL:{p:'#FDB913',s:'#231F20'}};
function tc(sh){return TC[sh]||{p:'#334155',s:'#64748b'};}

/* ══════════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════ */
const S={
  bootstrap:null,allFixtures:[],liveData:null,
  players:[],teams:{},positions:{},
  currentGW:null,nextGW:null,
  myTeam:[],captainId:null,vcaptainId:null,
  pickOrder:{},starterIds:[],
  page:1,pageSize:20,filteredPlayers:[],
  fplEntryId:null,fplPlayer:null,myLeagues:{classic:[],h2h:[]},
  gwHistory:null,    // GW-by-GW history
  currentLeagueId:null,currentLeagueType:'classic',
  actionPid:null,
  deferredInstall:null, // PWA install prompt
  notifEnabled:false,
  theme:'dark',
};

/* ══════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════ */
async function init() {
  loadStorage();
  applyTheme(S.theme);
  registerSW();
  attachListeners();
  setupPWA();
  setLoadingProgress(10,'FETCHING DATA...');

  let bd=cGet('bootstrap'), fd=cGet('fixtures');
  if (bd && fd) {
    setLoadingProgress(55,'LOADING FROM CACHE...');
    S.allFixtures=fd; sortFixtures();
    processBootstrap(bd);
  } else {
    try {
      const [bR,fR]=await Promise.all([fplFetch('/bootstrap-static/'),fplFetch('/fixtures/')]);
      setLoadingProgress(62,'PROCESSING...');
      bd=await bR.json(); fd=fR.ok?await fR.json():[];
      cSet('bootstrap',bd); cSet('fixtures',fd);
      S.allFixtures=fd; sortFixtures();
      if(!processBootstrap(bd))return;
    } catch(err) {
      console.error('Init:',err);
      setLoadingProgress(100,'ERROR');
      setTimeout(()=>showLoadingError(`Could not reach FPL API.<br>Check your internet and retry.<br><small style="color:var(--text-sub)">${err.message}</small>`),300);
      return;
    }
  }

  setLoadingProgress(88,'BUILDING...');
  renderAll();
  setLoadingProgress(100,'READY');
  const ld=el('liveDot');if(ld){ld.classList.add('active');ld.textContent='LIVE';}
  setTimeout(()=>{const ls=el('loadingScreen');if(!ls)return;ls.style.opacity='0';ls.style.transition='opacity .35s ease';setTimeout(()=>ls.remove(),360);},180);
  if(S.fplEntryId){updateAccountUI();fetchGWHistory();}
  fetchLive();
  checkPriceChanges();
}

/* ══════════════════════════════════════════════════════════════
   STORAGE
══════════════════════════════════════════════════════════════ */
function loadStorage(){
  try{
    const g=k=>localStorage.getItem(k);
    const t=g('fpl_myteam'),c=g('fpl_captain'),v=g('fpl_vcaptain');
    const po=g('fpl_pickorder'),ei=g('fpl_entry_id');
    const pl=g('fpl_player'),lg=g('fpl_leagues'),th=g('fpl_theme');
    if(t)S.myTeam=JSON.parse(t);if(c)S.captainId=parseInt(c);if(v)S.vcaptainId=parseInt(v);
    if(po)S.pickOrder=JSON.parse(po);if(ei)S.fplEntryId=parseInt(ei);
    if(pl)S.fplPlayer=JSON.parse(pl);if(lg)S.myLeagues=JSON.parse(lg);
    if(th)S.theme=th;
  }catch{}
}
function saveTeam(){
  localStorage.setItem('fpl_myteam',JSON.stringify(S.myTeam));
  S.captainId?localStorage.setItem('fpl_captain',S.captainId):localStorage.removeItem('fpl_captain');
  S.vcaptainId?localStorage.setItem('fpl_vcaptain',S.vcaptainId):localStorage.removeItem('fpl_vcaptain');
  if(Object.keys(S.pickOrder).length)localStorage.setItem('fpl_pickorder',JSON.stringify(S.pickOrder));
}

/* ══════════════════════════════════════════════════════════════
   PWA & SERVICE WORKER
══════════════════════════════════════════════════════════════ */
function registerSW(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js').catch(e=>console.warn('SW:',e));
  }
}
function setupPWA(){
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault(); S.deferredInstall=e;
    const btn=el('installBtn'); if(btn)btn.style.display='flex';
  });
  window.addEventListener('appinstalled',()=>{
    const btn=el('installBtn'); if(btn)btn.style.display='none';
    S.deferredInstall=null;
  });
}
async function installPWA(){
  if(!S.deferredInstall)return;
  S.deferredInstall.prompt();
  const{outcome}=await S.deferredInstall.userChoice;
  if(outcome==='accepted')S.deferredInstall=null;
}

/* ══════════════════════════════════════════════════════════════
   THEME TOGGLE (#15)
══════════════════════════════════════════════════════════════ */
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme',theme);
  S.theme=theme;
  localStorage.setItem('fpl_theme',theme);
  const btn=el('themeBtn');
  if(btn)btn.textContent=theme==='dark'?'☀️':'🌙';
}
function toggleTheme(){applyTheme(S.theme==='dark'?'light':'dark');}

/* ══════════════════════════════════════════════════════════════
   NOTIFICATIONS (#14)
══════════════════════════════════════════════════════════════ */
async function toggleNotifications(){
  if(!('Notification' in window)){alert('Notifications not supported on this browser.');return;}
  if(Notification.permission==='granted'){
    S.notifEnabled=!S.notifEnabled;
    el('notifBtn').textContent=S.notifEnabled?'🔔':'🔕';
    return;
  }
  const perm=await Notification.requestPermission();
  if(perm==='granted'){
    S.notifEnabled=true;
    el('notifBtn').textContent='🔔';
    new Notification('FPL Cortex 🏆',{body:'Price change alerts enabled! You\'ll be notified when your players change price.',icon:'/manifest.json'});
  }
}
function checkPriceChanges(){
  // Check price changes for squad players and notify if enabled
  if(!S.notifEnabled||!Notification||Notification.permission!=='granted')return;
  const mp=myPlayers();
  const risers=mp.filter(p=>p.cost_change_event>0);
  const fallers=mp.filter(p=>p.cost_change_event<0);
  if(risers.length){
    new Notification('💹 FPL Price Rise',{body:`${risers.map(p=>p.web_name).join(', ')} ${risers.length>1?'have':'has'} risen in price!`,tag:'price-rise'});
  }
  if(fallers.length){
    new Notification('📉 FPL Price Fall',{body:`${fallers.map(p=>p.web_name).join(', ')} ${fallers.length>1?'have':'has'} fallen in price!`,tag:'price-fall'});
  }
}

/* ══════════════════════════════════════════════════════════════
   LISTENERS
══════════════════════════════════════════════════════════════ */
function attachListeners(){
  document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  el('accountBtn')?.addEventListener('click',handleAccountBtn);
  el('themeBtn')?.addEventListener('click',toggleTheme);
  el('notifBtn')?.addEventListener('click',toggleNotifications);
  el('installBtn')?.addEventListener('click',installPWA);
  el('loginModalClose')?.addEventListener('click',closeModal);
  el('loginSkipBtn')?.addEventListener('click',closeModal);
  el('loginSubmitBtn')?.addEventListener('click',submitTeamId);
  el('loginTeamId')?.addEventListener('keydown',e=>{if(e.key==='Enter')submitTeamId();});
  el('managerSearchBtn')?.addEventListener('click',searchManager);
  el('managerSearchInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')searchManager();});
  el('captainBtn')?.addEventListener('click',autoPickCaptain);
  el('dashImportBtn')?.addEventListener('click',importFplTeam);
  el('dashLogoutBtn')?.addEventListener('click',logout);
  el('refreshBtn')?.addEventListener('click',refreshData);
  el('playerSearch')?.addEventListener('input',filterPlayers);
  el('posFilter')?.addEventListener('change',filterPlayers);
  el('teamFilter')?.addEventListener('change',filterPlayers);
  el('sortSelect')?.addEventListener('change',filterPlayers);
  el('clearTeamBtn')?.addEventListener('click',clearTeam);
  el('addPlayersBtn')?.addEventListener('click',()=>switchTab('players'));
  el('importFplTeamBtn')?.addEventListener('click',importFplTeam);
  el('actionSetCaptain')?.addEventListener('click',()=>{if(S.actionPid){setCaptain(S.actionPid,0);closeActionSheet();}});
  el('actionSetVC')?.addEventListener('click',()=>{if(S.actionPid){setCaptain(S.actionPid,1);closeActionSheet();}});
  el('actionRemovePlayer')?.addEventListener('click',()=>{if(S.actionPid){removeFromTeam(S.actionPid);closeActionSheet();}});
  el('actionCancel')?.addEventListener('click',closeActionSheet);
  el('actionSheetBackdrop')?.addEventListener('click',e=>{if(e.target===el('actionSheetBackdrop'))closeActionSheet();});
  el('liveRefreshBtn')?.addEventListener('click',fetchLive);
  el('fixtureGwSelect')?.addEventListener('change',renderFixtures);
  el('fdrGwCount')?.addEventListener('change',renderFDRCalendar);
  el('leaguesLoginBtn')?.addEventListener('click',openModal);
  el('standingsBackBtn')?.addEventListener('click',hideStandings);
  el('classicLeaguesList')?.addEventListener('click',e=>{const i=e.target.closest('.league-item');if(i)loadStandings(+i.dataset.lid,'classic',i.dataset.name);});
  el('h2hLeaguesList')?.addEventListener('click',e=>{const i=e.target.closest('.league-item');if(i)loadStandings(+i.dataset.lid,'h2h',i.dataset.name);});
  el('standingsPagination')?.addEventListener('click',e=>{const b=e.target.closest('.page-btn');if(b)loadStandings(S.currentLeagueId,S.currentLeagueType,null,+b.dataset.page);});
  // Scout tab
  el('diffPosFilter')?.addEventListener('change',renderDifferentials);
  el('diffSortFilter')?.addEventListener('change',renderDifferentials);
  el('compareBtn')?.addEventListener('click',renderComparison);
  // Tools tab
  el('autoBuilderBtn')?.addEventListener('click',runAutoBuilder);
  el('wildcardBtn')?.addEventListener('click',runWildcard);
  el('predictorBtn')?.addEventListener('click',renderPredictor);
  // Chart toggles
  el('chartTogglePts')?.addEventListener('click',()=>showHistoryChart('points'));
  el('chartToggleRank')?.addEventListener('click',()=>showHistoryChart('rank'));
  // Global
  document.addEventListener('click',handleGlobalClick);
}

function handleGlobalClick(e){
  const addBtn=e.target.closest('.add-btn');
  if(addBtn&&!addBtn.disabled){const pid=parseInt(addBtn.dataset.pid);if(!isNaN(pid)){togglePlayer(pid);return;}}
  const removeBtn=e.target.closest('.remove-btn');
  if(removeBtn){const pid=parseInt(removeBtn.dataset.pid);if(!isNaN(pid)){removeFromTeam(pid);return;}}
  const pitchCard=e.target.closest('.pitch-card[data-pid]');
  if(pitchCard){const pid=parseInt(pitchCard.dataset.pid);if(!isNaN(pid)){openActionSheet(pid);return;}}
  const capCard=e.target.closest('.captain-card[data-pid]');
  if(capCard){setCaptain(parseInt(capCard.dataset.pid),parseInt(capCard.dataset.rank));return;}
  const srBtn=e.target.closest('.sr-select');
  if(srBtn){connectEntry(parseInt(srBtn.dataset.eid));return;}
}

/* ══════════════════════════════════════════════════════════════
   LOADING
══════════════════════════════════════════════════════════════ */
function setLoadingProgress(pct,msg){const b=el('loadingBar'),t=el('loadingMsg');if(b)b.style.width=pct+'%';if(t)t.textContent=msg;}
function showLoadingError(msg){
  const ls=el('loadingScreen');if(!ls)return;
  ls.innerHTML=`<div class="loading-logo">FPL <span>CORTEX</span></div><div style="color:var(--red);font-family:var(--font-data);font-size:.78rem;margin-top:1rem;text-align:center;max-width:300px;line-height:1.8">${msg}</div><button id="retryBtn" class="btn btn-green btn-sm" style="margin-top:1.5rem">↻ RETRY</button>`;
  el('retryBtn')?.addEventListener('click',()=>location.reload());
}

/* ══════════════════════════════════════════════════════════════
   DATA PROCESSING
══════════════════════════════════════════════════════════════ */
function sortFixtures(){S.allFixtures.sort((a,b)=>{const ea=a.event||99,eb=b.event||99;return ea!==eb?ea-eb:(a.finished?1:0)-(b.finished?1:0);});}

function processBootstrap(data){
  try{
    S.bootstrap=data;
    data.teams.forEach(t=>{S.teams[t.id]=t;});
    data.element_types.forEach(et=>{S.positions[et.id]={short:et.singular_name_short,full:et.singular_name};});
    S.players=data.elements.map(processPlayer);
    const cur=data.events.find(e=>e.is_current),nxt=data.events.find(e=>e.is_next);
    S.currentGW=cur?cur.id:(nxt?nxt.id-1:null);
    S.nextGW=nxt?nxt.id:null;
    setText('gwBadge',S.currentGW?`GW ${S.currentGW}`:'GW —');
    if(cur){setText('liveGwAvg',cur.average_entry_score||'—');setText('liveGwHighest',cur.highest_score||'—');setText('dashGwAvg',cur.average_entry_score||'—');}
    return true;
  }catch(err){console.error('processBootstrap:',err);return false;}
}

function processPlayer(p){
  const team=S.teams[p.team]||{},pos=S.positions[p.element_type]||{};
  const uf=getUpcomingFixtures(p.team,3);
  const avgFDR=uf.length?uf.reduce((s,f)=>s+f.difficulty,0)/uf.length:3;
  const form=parseFloat(p.form)||0,fdrMul=fdrMult(avgFDR);
  const avgMins=p.minutes/Math.max(1,S.currentGW||1);
  const minFac=0.5+0.5*Math.min(1,avgMins/90);
  let proj=form*fdrMul*minFac;
  const ict=parseFloat(p.ict_index)||0;
  if(p.element_type===3||p.element_type===4)proj+=(ict/100)*0.8;
  if(p.element_type===1||p.element_type===2){const cs=avgFDR<=2?0.5:avgFDR<=3?0.35:0.2;proj+=cs*(p.element_type===1?6:4);}
  const ep=parseFloat(p.ep_next)||0;
  if(ep>0)proj=proj*0.4+ep*0.6;
  return{...p,teamName:team.name||'—',teamShort:team.short_name||'—',posShort:pos.short||'—',price:p.now_cost/10,formVal:form,projectedPts:Math.round(proj*10)/10,avgFDR,upcomingFixtures:uf};
}

function fdrMult(fdr){return fdr<=1.5?1.5:fdr<=2.5?1.25:fdr<=3.5?1.0:fdr<=4.5?0.75:0.55;}

function getUpcomingFixtures(teamId,count=3){
  const startGW=S.nextGW||(S.currentGW?S.currentGW+1:1);
  const res=[];
  for(const f of S.allFixtures){
    if(res.length>=count)break;
    if(!f.event||f.event<startGW||f.finished)continue;
    if(f.team_h===teamId)res.push({opponent:S.teams[f.team_a]?.short_name||'?',home:true,difficulty:f.team_h_difficulty,gw:f.event});
    else if(f.team_a===teamId)res.push({opponent:S.teams[f.team_h]?.short_name||'?',home:false,difficulty:f.team_a_difficulty,gw:f.event});
  }
  return res;
}

async function fetchLive(){
  const btn=el('liveRefreshBtn');if(btn)btn.classList.add('spinning');
  const gw=S.currentGW||S.nextGW;
  if(!gw){if(btn){btn.classList.remove('spinning');btn.textContent='↻ REFRESH';}return;}
  try{
    const res=await fplFetch(`/event/${gw}/live/`);if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const raw=await res.json();const map={};
    for(const e of(raw.elements||[]))map[e.id]=e;
    S.liveData=map;
    renderLivePanel();renderMyTeam();
    const badge=el('liveUpdateBadge');if(badge){const n=new Date();badge.textContent=`${pad(n.getHours())}:${pad(n.getMinutes())}`;}
  }catch(err){console.warn('Live:',err.message);setHTML('livePlayerList',emptyState('◎','NO LIVE DATA','Active during live gameweeks.'));}
  if(btn){btn.classList.remove('spinning');btn.textContent='↻ REFRESH';}
}

async function refreshData(){
  sessionStorage.removeItem('bootstrap');sessionStorage.removeItem('fixtures');
  const btn=el('refreshBtn');if(btn)btn.classList.add('spinning');
  try{
    const [bR,fR]=await Promise.all([fplFetch('/bootstrap-static/'),fplFetch('/fixtures/')]);
    const bd=await bR.json(),fd=fR.ok?await fR.json():[];
    cSet('bootstrap',bd);cSet('fixtures',fd);
    S.allFixtures=fd;sortFixtures();processBootstrap(bd);renderAll();
    renderFDRCalendar();renderBlankDouble();
  }catch(err){console.error('Refresh:',err);}
  if(btn){btn.classList.remove('spinning');btn.textContent='↻ REFRESH';}
}

function renderAll(){renderDashboard();renderPlayerTable();renderMyTeam();renderTransfers();renderFixtureGwSelect();renderFixtures();renderPriceChanges();renderDifferentials();}

/* ══════════════════════════════════════════════════════════════
   TAB NAVIGATION
══════════════════════════════════════════════════════════════ */
function switchTab(name){
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===`tab-${name}`));
  if(name==='myteam')renderMyTeam();
  if(name==='transfers')renderTransfers();
  if(name==='fixtures'){renderFixtures();renderFDRCalendar();renderBlankDouble();}
  if(name==='scout'){renderPriceChanges();renderDifferentials();}
  if(name==='tools')renderChipPlanner();
  if(name==='live')renderLivePanel();
  if(name==='dashboard')renderDashboard();
  if(name==='leagues')renderLeaguesTab();
}

/* ══════════════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════════════ */
function renderDashboard(){
  const{starters}=getSquadGroups();
  const mp=myPlayers();
  const cap=starters.find(p=>p.id===S.captainId);
  let proj=starters.reduce((s,p)=>s+p.projectedPts,0);
  if(cap)proj+=cap.projectedPts;
  setText('dashProjected',Math.round(proj*10)/10);
  setText('dashCaptainPts',cap?Math.round(cap.projectedPts*2*10)/10:'—');
  setText('dashCaptainName',cap?cap.web_name:'No Captain');
  setText('dashValue',`£${mp.reduce((s,p)=>s+p.price,0).toFixed(1)}m`);
  setText('dashPlayerCount',`${mp.length} / 15`);
  const bar=el('fplAccountBar');
  if(bar){
    if(S.fplPlayer){bar.style.display='flex';setText('fplManagerName',`${S.fplPlayer.first_name} ${S.fplPlayer.last_name}`);setText('fplTeamMeta',`${S.fplPlayer.teamName||''} · ${S.fplPlayer.summary_overall_points||'—'} pts · Rank ${S.fplPlayer.summary_overall_rank?.toLocaleString()||'—'}`);}
    else bar.style.display='none';
  }
  renderCaptainSuggestions(starters.length?starters:mp);
  renderRiskAnalysis(mp);
  if(S.gwHistory)updateSeasonStats();
}

/* ══════════════════════════════════════════════════════════════
   GW HISTORY + RANK TRACKER (#1, #12)
══════════════════════════════════════════════════════════════ */
async function fetchGWHistory(){
  if(!S.fplEntryId)return;
  try{
    const res=await fplFetch(`/entry/${S.fplEntryId}/history/`);
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    S.gwHistory=data;
    updateSeasonStats();
    el('seasonStatsSection').style.display='block';
    el('historyChartSection').style.display='block';
    showHistoryChart('points');
  }catch(err){console.warn('History:',err.message);}
}

function updateSeasonStats(){
  if(!S.gwHistory)return;
  const current=S.gwHistory.current||[];
  if(!current.length)return;
  const total=current.reduce((s,g)=>s+g.points,0);
  const best=current.reduce((b,g)=>g.points>b.points?g:b,current[0]);
  const latestRank=current[current.length-1]?.overall_rank;
  const chips=S.gwHistory.chips||[];
  const allChips=['wildcard','freehit','bboost','3xc'];
  const usedChips=chips.map(c=>c.name);
  const remaining=allChips.filter(c=>!usedChips.includes(c)).length;
  setText('statSeasonTotal',total);
  setText('statBestGW',best.points);
  setText('statBestGWNum',`GW ${best.event}`);
  setText('statOverallRank',latestRank?.toLocaleString()||'—');
  setText('statChipsLeft',`${remaining}/4`);
  el('seasonStatsSection').style.display='block';
}

function showHistoryChart(type){
  // Update toggle buttons
  el('chartTogglePts')?.classList.toggle('active',type==='points');
  el('chartToggleRank')?.classList.toggle('active',type==='rank');
  const area=el('historyChartArea');if(!area)return;
  const current=S.gwHistory?.current||[];
  if(!current.length){area.innerHTML='<div style="color:var(--text-sub);text-align:center;padding:1rem;font-size:.8rem">No history data</div>';return;}
  const data=current.map(g=>type==='rank'?g.overall_rank:g.points);
  const labels=current.map(g=>`GW${g.event}`);
  const color=type==='rank'?'var(--blue)':'var(--green)';
  // For rank, lower is better — invert display
  const displayData=type==='rank'?data.map(r=>-r):data;
  const chart=svgLineChart(displayData,labels,color,100);
  const statsRow=type==='points'?`
    <div style="display:flex;justify-content:space-between;margin-top:.5rem;flex-wrap:wrap;gap:.25rem">
      ${current.slice(-5).map(g=>`<div style="text-align:center;font-family:var(--font-data);font-size:.6rem"><div style="color:${g.points>=60?'var(--green)':g.points>=40?'var(--amber)':'var(--text-sub)'};font-weight:700">${g.points}</div><div style="color:var(--text-dim)">GW${g.event}</div></div>`).join('')}
    </div>`:'';
  area.innerHTML=`<div class="history-chart-wrap">${chart}</div>${statsRow}`;
}

function svgLineChart(data,labels,color='var(--green)',height=100){
  if(!data||data.length<2)return '<div style="color:var(--text-sub);text-align:center;padding:1rem;font-size:.8rem">Not enough data</div>';
  const w=280,pad=10;
  const min=Math.min(...data),max=Math.max(...data),range=(max-min)||1;
  const n=data.length;
  const xScale=i=>(i/(n-1))*(w-pad*2)+pad;
  const yScale=v=>height-(((v-min)/range)*(height-pad*2))-pad;
  const pts=data.map((v,i)=>`${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ');
  const area=data.map((v,i)=>`${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ')+` ${xScale(n-1).toFixed(1)},${height} ${xScale(0).toFixed(1)},${height}`;
  const dots=data.map((v,i)=>`<circle cx="${xScale(i).toFixed(1)}" cy="${yScale(v).toFixed(1)}" r="3" fill="${color}" stroke="var(--void)" stroke-width="1.5"/>`).join('');
  // Show a few labels
  const step=Math.max(1,Math.floor(n/5));
  const lbls=data.map((v,i)=>i%step===0?`<text x="${xScale(i).toFixed(1)}" y="${height+12}" text-anchor="middle" font-family="'Space Mono'" font-size="8" fill="var(--text-sub)">${labels[i]||''}</text>`:'').join('');
  return `<svg viewBox="0 0 ${w} ${height+16}" style="width:100%;overflow:visible">
    <defs><linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".2"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${area}" fill="url(#chartGrad)"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    ${dots}${lbls}
  </svg>`;
}

/* ══════════════════════════════════════════════════════════════
   SQUAD GROUPING
══════════════════════════════════════════════════════════════ */
function getSquadGroups(){
  const mp=myPlayers();
  if(!mp.length)return{starters:[],bench:[],formation:'—',byPos:{GKP:[],DEF:[],MID:[],FWD:[]}};
  const sorted=[...mp].sort((a,b)=>(S.pickOrder[a.id]||99)-(S.pickOrder[b.id]||99));
  const hasOrder=Object.keys(S.pickOrder).length>0;
  let starters,bench;
  if(hasOrder){starters=sorted.filter(p=>(S.pickOrder[p.id]||99)<=11);bench=sorted.filter(p=>(S.pickOrder[p.id]||99)>11);}
  else{const gkps=sorted.filter(p=>p.posShort==='GKP');const out=sorted.filter(p=>p.posShort!=='GKP').sort((a,b)=>b.projectedPts-a.projectedPts);starters=[...gkps.slice(0,1),...out.slice(0,10)];bench=[...gkps.slice(1),...out.slice(10)];}
  const byPos={GKP:[],DEF:[],MID:[],FWD:[]};
  starters.forEach(p=>{if(byPos[p.posShort])byPos[p.posShort].push(p);});
  const formation=starters.length>=10?`${byPos.DEF.length}-${byPos.MID.length}-${byPos.FWD.length}`:'—';
  S.starterIds=starters.map(p=>p.id);
  return{starters,bench,formation,byPos};
}

/* ══════════════════════════════════════════════════════════════
   CAPTAIN AI
══════════════════════════════════════════════════════════════ */
function capScore(p){return(p.formVal*3+(parseFloat(p.ict_index)||0)/20+p.projectedPts)*fdrMult(p.avgFDR);}

function renderCaptainSuggestions(pool){
  if(!pool.length){setHTML('captainArea',emptyState('🎖','NO SQUAD','Import or add players first.'));return;}
  const ranked=[...pool].sort((a,b)=>capScore(b)-capScore(a)).slice(0,3);
  setHTML('captainArea',`<div class="captain-cards">${ranked.map((p,i)=>{
    const fix=p.upcomingFixtures[0];
    const fixStr=fix?`${fix.home?'':'@'}${fix.opponent} GW${fix.gw} <span class="fdr fdr-${fix.difficulty}">${fix.difficulty}</span>`:'No fixture';
    return `<div class="captain-card ${i===0?'rank-1':''}" data-pid="${p.id}" data-rank="${i}">
      <div class="cc-name">${p.web_name}</div><div class="cc-team">${p.teamShort}·${p.posShort}</div>
      <div class="cc-ep">${Math.round(p.projectedPts*(i===0?2:1)*10)/10}</div>
      <div class="cc-score">Next: ${fixStr}</div>
      <div style="margin-top:5px;font-family:var(--font-data);font-size:.58rem;color:var(--text-sub)">Form ${p.form}·£${p.price}m·${p.selected_by_percent}% own</div>
      ${i===0&&p.id===S.captainId?'<div class="card-badge badge-amber" style="margin-top:5px;display:inline-block">★ SET</div>':''}
      ${i===1&&p.id===S.vcaptainId?'<div class="card-badge badge-blue" style="margin-top:5px;display:inline-block">V SET</div>':''}
    </div>`;
  }).join('')}</div>`);
}

function setCaptain(pid,rank){
  if(rank===0){S.captainId=S.captainId===pid?null:pid;S.captainId!==null?localStorage.setItem('fpl_captain',pid):localStorage.removeItem('fpl_captain');}
  if(rank===1){S.vcaptainId=S.vcaptainId===pid?null:pid;S.vcaptainId!==null?localStorage.setItem('fpl_vcaptain',pid):localStorage.removeItem('fpl_vcaptain');}
  const{starters}=getSquadGroups();renderCaptainSuggestions(starters.length?starters:myPlayers());renderMyTeam();renderDashboard();
}

function autoPickCaptain(){
  const{starters}=getSquadGroups();const pool=starters.length?starters:myPlayers();if(!pool.length)return;
  const r=[...pool].sort((a,b)=>capScore(b)-capScore(a));
  S.captainId=r[0]?.id||null;S.vcaptainId=r[1]?.id||null;
  saveTeam();renderCaptainSuggestions(pool);renderMyTeam();renderDashboard();
}

/* ══════════════════════════════════════════════════════════════
   RISK
══════════════════════════════════════════════════════════════ */
function getRisk(p){
  const risks=[],avgMins=p.minutes/Math.max(1,S.currentGW||1);
  if(p.chance_of_playing_next_round!==null&&p.chance_of_playing_next_round<75)risks.push({level:'high',reason:`${p.chance_of_playing_next_round}% chance — ${p.news||'injury doubt'}`});
  else if(p.chance_of_playing_next_round!==null&&p.chance_of_playing_next_round<100)risks.push({level:'medium',reason:`Slight doubt — ${p.news||'monitor'}`});
  if(p.formVal===0&&p.total_points>0)risks.push({level:'high',reason:'Zero form recently'});
  else if(p.formVal<2&&p.total_points>0)risks.push({level:'medium',reason:`Poor form: ${p.form} pts/gm`});
  if(p.avgFDR>=4.5)risks.push({level:'high',reason:`Brutal fixtures FDR ${p.avgFDR.toFixed(1)}`});
  else if(p.avgFDR>=3.8)risks.push({level:'medium',reason:`Tough fixtures FDR ${p.avgFDR.toFixed(1)}`});
  if(avgMins<45)risks.push({level:'medium',reason:`Rotation risk avg ${Math.round(avgMins)} mins`});
  return risks;
}

function renderRiskAnalysis(mp){
  if(!mp.length){setHTML('riskArea',`<div class="card">${emptyState('🛡','NO SQUAD DATA','Build your team.')}</div>`);return;}
  const flagged=mp.map(p=>({p,r:getRisk(p)})).filter(x=>x.r.length).sort((a,b)=>(b.r[0].level==='high'?2:1)-(a.r[0].level==='high'?2:1));
  if(!flagged.length){setHTML('riskArea',`<div class="card">${emptyState('✅','ALL CLEAR','No risk flags.')}</div>`);return;}
  setHTML('riskArea',`<div class="card">${flagged.map(({p,r})=>`<div class="risk-item"><div class="risk-bar ${r[0].level==='high'?'risk-high':'risk-medium'}"></div><div><div style="font-weight:700">${p.web_name} <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div>${r.map(x=>`<div class="risk-reason">⚠ ${x.reason}</div>`).join('')}</div><div style="margin-left:auto;text-align:right"><div class="stat-label" style="font-size:.56rem">FORM</div><div style="font-family:var(--font-data);font-size:.88rem;color:${r[0].level==='high'?'var(--red)':'var(--amber)'}">${p.form}</div></div></div>`).join('')}</div>`);
}

/* ══════════════════════════════════════════════════════════════
   PLAYER TABLE
══════════════════════════════════════════════════════════════ */
function filterPlayers(){S.page=1;renderPlayerTable();}
function renderPlayerTable(){
  if(!S.players.length)return;
  const search=(el('playerSearch')?.value||'').toLowerCase();
  const posF=el('posFilter')?.value||'';const teamF=el('teamFilter')?.value||'';const sortKey=el('sortSelect')?.value||'total_points';
  const tf=el('teamFilter');
  if(tf&&tf.options.length===1){Object.values(S.teams).sort((a,b)=>a.name.localeCompare(b.name)).forEach(t=>{const o=document.createElement('option');o.value=t.name;o.textContent=t.name;tf.appendChild(o);});}
  let list=S.players.filter(p=>{const nm=`${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase();return(!search||nm.includes(search)||p.teamName.toLowerCase().includes(search))&&(!posF||p.posShort===posF)&&(!teamF||p.teamName===teamF);}).sort((a,b)=>(parseFloat(b[sortKey])||0)-(parseFloat(a[sortKey])||0));
  S.filteredPlayers=list;const total=list.length,pages=Math.ceil(total/S.pageSize);
  const slice=list.slice((S.page-1)*S.pageSize,S.page*S.pageSize);
  setText('squadIndicator',S.myTeam.length);
  const tbody=el('playerTableBody');if(!tbody)return;
  tbody.innerHTML=!slice.length?`<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-sub)">No players match.</td></tr>`:slice.map(p=>{
    const inTeam=S.myTeam.includes(p.id),full=!inTeam&&S.myTeam.length>=15;
    const formCls=p.formVal>=6?'form-hi':p.formVal>=3?'form-mid':'form-lo';
    const risks=getRisk(p);const flag=risks.length?`<span title="${risks[0].reason}" style="cursor:help">${risks[0].level==='high'?'🔴':'🟡'}</span>`:'';
    const avail=(p.chance_of_playing_next_round!==null&&p.chance_of_playing_next_round<100)?`<div class="news-banner">⚠ ${p.news||p.chance_of_playing_next_round+'%'}</div>`:'';
    const priceChg=p.cost_change_event>0?`<span style="color:var(--green);font-size:.6rem">▲</span>`:p.cost_change_event<0?`<span style="color:var(--red);font-size:.6rem">▼</span>`:'';
    return `<tr><td><div class="player-name">${p.web_name} ${flag}${priceChg}</div><div class="player-sub">${p.teamShort}</div>${avail}</td><td><span class="pos-chip pos-${p.posShort}">${p.posShort}</span></td><td><span class="price-val">£${p.price.toFixed(1)}</span></td><td><span class="form-val ${formCls}">${p.form}</span></td><td><span class="pts-val">${p.total_points}</span></td><td><span class="ep-val">${p.ep_next||'—'}</span></td><td><span class="sel-pct">${parseFloat(p.selected_by_percent).toFixed(1)}%</span></td><td><button class="add-btn ${inTeam?'in-team':''}" data-pid="${p.id}" ${full?'disabled':''}>${inTeam?'✓':'＋'}</button></td></tr>`;
  }).join('');
  const pag=el('playerPagination');if(!pag)return;
  if(pages<=1){pag.innerHTML='';return;}
  let ph='';
  if(S.page>1)ph+=`<button class="page-btn" data-p="${S.page-1}">‹</button>`;
  for(let i=Math.max(1,S.page-2);i<=Math.min(pages,S.page+2);i++)ph+=`<button class="page-btn ${i===S.page?'active':''}" data-p="${i}">${i}</button>`;
  if(S.page<pages)ph+=`<button class="page-btn" data-p="${S.page+1}">›</button>`;
  ph+=`<span style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub);margin-left:.4rem">${total} players</span>`;
  pag.innerHTML=ph;
  pag.querySelectorAll('.page-btn').forEach(b=>b.addEventListener('click',()=>{S.page=parseInt(b.dataset.p);renderPlayerTable();el('playerTable')?.scrollIntoView({behavior:'smooth',block:'start'});}));
}

/* ══════════════════════════════════════════════════════════════
   MY TEAM
══════════════════════════════════════════════════════════════ */
function togglePlayer(pid){
  const idx=S.myTeam.indexOf(pid);
  if(idx===-1){if(S.myTeam.length>=15)return;S.myTeam.push(pid);}
  else{S.myTeam.splice(idx,1);if(S.captainId===pid)S.captainId=null;if(S.vcaptainId===pid)S.vcaptainId=null;delete S.pickOrder[pid];}
  saveTeam();renderPlayerTable();renderMyTeam();renderDashboard();
}
function removeFromTeam(pid){
  const idx=S.myTeam.indexOf(pid);
  if(idx!==-1){S.myTeam.splice(idx,1);if(S.captainId===pid){S.captainId=null;localStorage.removeItem('fpl_captain');}if(S.vcaptainId===pid){S.vcaptainId=null;localStorage.removeItem('fpl_vcaptain');}delete S.pickOrder[pid];saveTeam();renderMyTeam();renderPlayerTable();renderDashboard();}
}
function clearTeam(){
  if(!confirm('Clear entire squad?'))return;
  S.myTeam=[];S.captainId=null;S.vcaptainId=null;S.pickOrder={};
  ['fpl_myteam','fpl_captain','fpl_vcaptain','fpl_pickorder'].forEach(k=>localStorage.removeItem(k));
  renderMyTeam();renderDashboard();renderPlayerTable();
}

function renderMyTeam(){
  const mp=myPlayers();const{starters,bench,formation,byPos}=getSquadGroups();
  setText('squadCount',mp.length);setText('squadValue',`£${mp.reduce((s,p)=>s+p.price,0).toFixed(1)}m`);setText('formationDisplay',mp.length>=11?formation:'—');
  let proj=starters.reduce((s,p)=>s+p.projectedPts,0);const cap=starters.find(p=>p.id===S.captainId);if(cap)proj+=cap.projectedPts;
  setText('squadProjPts',Math.round(proj*10)/10);
  const impBtn=el('importFplTeamBtn');if(impBtn)impBtn.style.display=S.fplEntryId?'inline-flex':'none';
  [{id:'pitchFWD',players:byPos.FWD||[]},{id:'pitchMID',players:byPos.MID||[]},{id:'pitchDEF',players:byPos.DEF||[]},{id:'pitchGKP',players:byPos.GKP||[]}].forEach(({id,players})=>{
    const row=el(id);if(!row)return;
    row.innerHTML=players.length?players.map(p=>pitchCardHTML(p)).join(''):`<div class="pitch-empty">+</div>`;
  });
  const benchEl=el('pitchBench');if(benchEl)benchEl.innerHTML=bench.length?bench.map(p=>pitchCardHTML(p,true)).join(''):`<div class="pitch-empty" style="width:52px">—</div>`;
  if(!mp.length){setHTML('teamListArea',emptyState('👕','SQUAD IS EMPTY','Tap "+ Players" or LOGIN to import.'));return;}
  const ordered=[...starters,...bench];
  setHTML('teamListArea',ordered.map((p,i)=>{
    const isC=p.id===S.captainId,isV=p.id===S.vcaptainId;
    const isBench=!S.starterIds.includes(p.id);
    const risks=getRisk(p);const fix=p.upcomingFixtures[0];
    const fixStr=fix?`${fix.home?'':'@'}${fix.opponent} GW${fix.gw} <span class="fdr fdr-${fix.difficulty}">${fix.difficulty}</span>`:'No fixture';
    const col=tc(p.teamShort);const live=S.liveData?.[p.id]?.stats;const livePts=live?live.total_points:null;
    const breakdown=live?buildPtsBreakdown(S.liveData[p.id]):'';
    const sep=isBench&&i===starters.length?`<div style="font-family:var(--font-data);font-size:.58rem;color:var(--text-sub);letter-spacing:2px;padding:.5rem 0 .25rem;border-top:1px dashed var(--border);margin-top:.25rem">BENCH (NOT COUNTED)</div>`:'';
    return `${sep}<div class="team-list-row" style="${isBench?'opacity:.65':''}">
      <div class="team-color-bar" style="background:${col.p}"></div>
      <div style="flex:1;min-width:0"><div style="font-weight:700;display:flex;align-items:center;gap:5px;flex-wrap:wrap">${p.web_name}${isC?'<span class="card-badge badge-amber">C</span>':''}${isV?'<span class="card-badge badge-blue">V</span>':''}<span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div><div style="font-size:.7rem;color:var(--text-sub)">${p.teamShort}·Next: ${fixStr}</div>${risks.length?`<div style="font-size:.68rem;color:var(--amber);margin-top:1px">⚠ ${risks[0].reason}</div>`:''}${breakdown?`<div class="pts-breakdown">${breakdown}</div>`:''}</div>
      <div style="text-align:right;flex-shrink:0"><div class="tl-pts ${livePts!==null?'live-pts':'proj-pts'}">${livePts!==null?livePts:p.projectedPts}</div><div style="font-family:var(--font-data);font-size:.56rem;color:var(--text-sub)">${livePts!==null?'pts':'xP'}</div><div style="font-family:var(--font-data);font-size:.58rem;color:var(--text-sub)">£${p.price.toFixed(1)}m</div></div>
      <button class="remove-btn" data-pid="${p.id}" style="padding:5px 9px;font-size:.75rem">✕</button>
    </div>`;
  }).join(''));
}

function pitchCardHTML(p,isBench=false){
  const isC=p.id===S.captainId,isV=p.id===S.vcaptainId;
  const live=S.liveData?.[p.id]?.stats;const pts=live?live.total_points:null;
  const ptsDisplay=pts!==null?pts+'pts':p.projectedPts+'xP';
  const col=tc(p.teamShort);
  return `<div class="pitch-card" data-pid="${p.id}">${isC?'<div class="cap-badge">C</div>':''}${isV?'<div class="vc-badge">V</div>':''}<div class="jersey" style="background:${col.p};--sleeve-color:${col.s}"><span class="jersey-text">${p.teamShort}</span></div><div class="pitch-name">${p.web_name}</div><div class="pitch-pts ${pts!==null?'live-pts':''}">${ptsDisplay}</div></div>`;
}

function buildPtsBreakdown(liveEl){
  if(!liveEl)return'';
  const LABELS={minutes:'mins',goals_scored:'⚽',assists:'🅰',clean_sheets:'CS',goals_conceded:'GC',own_goals:'OG',penalties_saved:'pen sav',penalties_missed:'pen miss',yellow_cards:'🟨',red_cards:'🟥',saves:'saves',bonus:'★bonus'};
  const stats=liveEl.explain?.flatMap(e=>e.stats||[])||[];
  if(!stats.length){const s=liveEl.stats||{},chips=[];if(s.minutes>=60)chips.push(`<span class="pts-chip pos">${s.minutes}' +2</span>`);else if(s.minutes>0)chips.push(`<span class="pts-chip pos">${s.minutes}' +1</span>`);if(s.goals_scored>0)chips.push(`<span class="pts-chip pos">⚽×${s.goals_scored}</span>`);if(s.assists>0)chips.push(`<span class="pts-chip pos">🅰×${s.assists}</span>`);if(s.clean_sheets>0)chips.push(`<span class="pts-chip pos">CS</span>`);if(s.bonus>0)chips.push(`<span class="pts-chip bonus">★${s.bonus}</span>`);if(s.yellow_cards>0)chips.push(`<span class="pts-chip neg">🟨</span>`);if(s.red_cards>0)chips.push(`<span class="pts-chip neg">🟥</span>`);return chips.join('');}
  return stats.filter(s=>s.points!==0).map(s=>{const cls=s.identifier==='bonus'?'bonus':s.points>0?'pos':'neg';const lbl=LABELS[s.identifier]||s.identifier.replace(/_/g,' ');return `<span class="pts-chip ${cls}">${lbl} ${s.points>0?'+':''}${s.points}</span>`;}).join('');
}

/* ══════════════════════════════════════════════════════════════
   ACTION SHEET
══════════════════════════════════════════════════════════════ */
function openActionSheet(pid){
  S.actionPid=pid;const p=S.players.find(x=>x.id===pid);if(!p)return;
  setText('actionPlayerName',p.web_name);setText('actionPlayerSub',`${p.posShort}·${p.teamShort}·£${p.price.toFixed(1)}m`);
  const capBtn=el('actionSetCaptain');const vcBtn=el('actionSetVC');
  if(capBtn)capBtn.textContent=S.captainId===pid?'⭐ Remove Captain':'⭐ Set as Captain';
  if(vcBtn)vcBtn.textContent=S.vcaptainId===pid?'🔵 Remove VC':'🔵 Set as Vice Captain';
  const sheet=el('actionSheetBackdrop');if(sheet)sheet.style.display='flex';
}
function closeActionSheet(){S.actionPid=null;const s=el('actionSheetBackdrop');if(s)s.style.display='none';}

/* ══════════════════════════════════════════════════════════════
   PRICE CHANGES (#2)
══════════════════════════════════════════════════════════════ */
function renderPriceChanges(){
  const risers=S.players.filter(p=>p.cost_change_event>0).sort((a,b)=>b.cost_change_event-a.cost_change_event).slice(0,8);
  const fallers=S.players.filter(p=>p.cost_change_event<0).sort((a,b)=>a.cost_change_event-b.cost_change_event).slice(0,8);
  const row=(p,dir)=>`<div class="price-row"><div><div style="font-weight:700;font-size:.85rem">${p.web_name}</div><div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">${p.teamShort}·${p.posShort}·${p.selected_by_percent}% own</div></div><span class="price-change ${dir>0?'price-up':'price-down'}">${dir>0?'▲':'▼'} £${Math.abs(p.cost_change_event/10).toFixed(1)}m</span></div>`;
  const noChg='<div style="padding:.75rem;color:var(--text-sub);font-size:.78rem;text-align:center">No price changes today</div>';
  setHTML('priceRisingList',risers.length?risers.map(p=>row(p,1)).join(''):noChg);
  setHTML('priceFallingList',fallers.length?fallers.map(p=>row(p,-1)).join(''):noChg);
  // Player table banner
  const banner=el('priceChangeBanner');
  if(banner&&(risers.length||fallers.length)){
    banner.style.display='block';
    banner.innerHTML=`<div style="background:var(--green-glow);border:1px solid var(--green-dim);border-radius:var(--radius);padding:.55rem .85rem;font-size:.78rem;display:flex;align-items:center;gap:.5rem"><span>💰</span><span>Today: <strong style="color:var(--green)">${risers.length} rising</strong>, <strong style="color:var(--red)">${fallers.length} falling</strong> — check Scout tab for details</span></div>`;
  }
}

/* ══════════════════════════════════════════════════════════════
   DIFFERENTIAL PICKS (#4)
══════════════════════════════════════════════════════════════ */
function renderDifferentials(){
  const posF=el('diffPosFilter')?.value||'';
  const sortKey=el('diffSortFilter')?.value||'form';
  let diffs=S.players.filter(p=>parseFloat(p.selected_by_percent)<15&&p.formVal>=3&&p.minutes>0);
  if(posF)diffs=diffs.filter(p=>p.posShort===posF);
  diffs.sort((a,b)=>(parseFloat(b[sortKey])||0)-(parseFloat(a[sortKey])||0));
  const top=diffs.slice(0,20);
  const tbody=el('diffTableBody');if(!tbody)return;
  if(!top.length){tbody.innerHTML=`<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-sub)">No differentials found for this filter.</td></tr>`;return;}
  tbody.innerHTML=top.map(p=>{
    const inTeam=S.myTeam.includes(p.id);const full=!inTeam&&S.myTeam.length>=15;
    const fix=p.upcomingFixtures[0];
    const fixStr=fix?`${fix.home?'':'@'}${fix.opponent} <span class="fdr fdr-${fix.difficulty}">${fix.difficulty}</span>`:'—';
    return `<tr><td><div class="player-name">${p.web_name}</div><div class="player-sub">${p.teamShort}</div></td><td><span class="pos-chip pos-${p.posShort}">${p.posShort}</span></td><td><span class="price-val">£${p.price.toFixed(1)}</span></td><td><span class="form-val form-hi">${p.form}</span></td><td><span class="ep-val">${p.ep_next||'—'}</span></td><td><span class="sel-pct">${parseFloat(p.selected_by_percent).toFixed(1)}%</span></td><td style="font-family:var(--font-data);font-size:.7rem">${fixStr}</td><td><button class="add-btn ${inTeam?'in-team':''}" data-pid="${p.id}" ${full?'disabled':''}>${inTeam?'✓':'＋'}</button></td></tr>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════════
   PLAYER COMPARISON (#5)
══════════════════════════════════════════════════════════════ */
function renderComparison(){
  const v1=(el('compareSearch1')?.value||'').toLowerCase();
  const v2=(el('compareSearch2')?.value||'').toLowerCase();
  const v3=(el('compareSearch3')?.value||'').toLowerCase();
  const find=q=>q?S.players.filter(p=>`${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase().includes(q)).sort((a,b)=>b.total_points-a.total_points)[0]:null;
  const players=[find(v1),find(v2),find(v3)].filter(Boolean);
  const area=el('compareResults');if(!area)return;
  if(players.length<2){area.innerHTML=emptyState('⚖','ADD PLAYERS TO COMPARE','Type at least 2 player names and tap Compare.');return;}
  const stats=[
    {label:'Position',key:p=>p.posShort},
    {label:'Team',key:p=>p.teamShort},
    {label:'Price',key:p=>`£${p.price.toFixed(1)}m`,num:p=>p.price},
    {label:'Form',key:p=>p.form,num:p=>parseFloat(p.form)},
    {label:'Total Pts',key:p=>p.total_points,num:p=>p.total_points},
    {label:'xPts Next',key:p=>p.ep_next||'—',num:p=>parseFloat(p.ep_next)||0},
    {label:'Ownership',key:p=>p.selected_by_percent+'%',num:p=>parseFloat(p.selected_by_percent)},
    {label:'ICT Index',key:p=>parseFloat(p.ict_index).toFixed(1),num:p=>parseFloat(p.ict_index)},
    {label:'Goals',key:p=>p.goals_scored,num:p=>p.goals_scored},
    {label:'Assists',key:p=>p.assists,num:p=>p.assists},
    {label:'Clean Sheets',key:p=>p.clean_sheets,num:p=>p.clean_sheets},
    {label:'Next Fix FDR',key:p=>p.upcomingFixtures[0]?`GW${p.upcomingFixtures[0].gw} FDR ${p.upcomingFixtures[0].difficulty}`:'—',num:p=>p.upcomingFixtures[0]?6-p.upcomingFixtures[0].difficulty:0},
  ];
  const headers=players.map((p,i)=>`<th class="${i===0?'compare-header-cell':''}">${p.web_name}<br><span style="font-size:.62rem;color:var(--text-sub)">${p.teamShort}·${p.posShort}</span></th>`).join('');
  const rows=stats.map(s=>{
    const vals=players.map(p=>s.key(p));const nums=s.num?players.map(p=>s.num(p)):null;
    const maxNum=nums?Math.max(...nums):null;
    const cells=vals.map((v,i)=>(`<td class="${nums&&nums[i]===maxNum&&maxNum>0?'compare-best':''}">${v}</td>`)).join('');
    return `<tr><td>${s.label}</td>${cells}</tr>`;
  }).join('');
  area.innerHTML=`<div class="player-table-wrap"><table class="compare-table"><thead><tr><th>Stat</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ══════════════════════════════════════════════════════════════
   FDR CALENDAR (#6)
══════════════════════════════════════════════════════════════ */
function renderFDRCalendar(){
  const area=el('fdrCalendarArea');if(!area)return;
  const gwCount=parseInt(el('fdrGwCount')?.value||6);
  const startGW=S.nextGW||(S.currentGW?S.currentGW+1:1);
  const teams=Object.values(S.teams).sort((a,b)=>a.short_name.localeCompare(b.short_name));
  const fxMap={};
  teams.forEach(t=>{fxMap[t.id]={};});
  S.allFixtures.forEach(f=>{
    if(!f.event||f.event<startGW||f.event>=startGW+gwCount)return;
    if(!fxMap[f.team_h])fxMap[f.team_h]={};if(!fxMap[f.team_a])fxMap[f.team_a]={};
    (fxMap[f.team_h][f.event]=fxMap[f.team_h][f.event]||[]).push({opp:S.teams[f.team_a]?.short_name||'?',home:true,fdr:f.team_h_difficulty});
    (fxMap[f.team_a][f.event]=fxMap[f.team_a][f.event]||[]).push({opp:S.teams[f.team_h]?.short_name||'?',home:false,fdr:f.team_a_difficulty});
  });
  const gwHeaders=Array.from({length:gwCount},(_,i)=>`<th>GW${startGW+i}</th>`).join('');
  const rows=teams.map(t=>{
    const cells=Array.from({length:gwCount},(_,i)=>{
      const gw=startGW+i,fixtures=fxMap[t.id]?.[gw]||[];
      if(!fixtures.length)return`<td class="fdr-cell fdr-blank">—</td>`;
      if(fixtures.length>=2){const txt=fixtures.map(f=>`${f.home?'':'@'}${f.opp}`).join('<br>');return`<td class="fdr-cell fdr-double" title="Double GW">${txt}</td>`;}
      const f=fixtures[0];return`<td class="fdr-cell fdr-cell-${f.fdr}" title="FDR ${f.fdr}">${f.home?'':'@'}${f.opp}</td>`;
    }).join('');
    return`<tr><td class="fdr-team">${t.short_name}</td>${cells}</tr>`;
  }).join('');
  area.innerHTML=`<div class="fdr-table-wrap"><table class="fdr-table"><thead><tr><th>Team</th>${gwHeaders}</tr></thead><tbody>${rows}</tbody></table></div><div style="display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap;font-size:.68rem"><span style="color:#c084fc;font-family:var(--font-data)">■ Double GW</span><span style="color:var(--text-sub);font-family:var(--font-data)">— Blank GW</span><span style="color:#00e676;font-family:var(--font-data)">■ Easy</span><span style="color:#ef9a9a;font-family:var(--font-data)">■ Hard</span></div>`;
}

/* ══════════════════════════════════════════════════════════════
   BLANK / DOUBLE GW DETECTOR (#7)
══════════════════════════════════════════════════════════════ */
function renderBlankDouble(){
  const area=el('blankDoubleAlert');if(!area)return;
  const checkGWs=8;const startGW=S.nextGW||(S.currentGW?S.currentGW+1:1);
  const blanks=[],doubles=[];
  for(let gw=startGW;gw<startGW+checkGWs;gw++){
    const teamCounts={};
    Object.values(S.teams).forEach(t=>{teamCounts[t.id]=0;});
    S.allFixtures.filter(f=>f.event===gw).forEach(f=>{if(teamCounts[f.team_h]!==undefined)teamCounts[f.team_h]++;if(teamCounts[f.team_a]!==undefined)teamCounts[f.team_a]++;});
    const blankTeams=Object.entries(teamCounts).filter(([,c])=>c===0).map(([id])=>S.teams[id]?.short_name).filter(Boolean);
    const doubleTeams=Object.entries(teamCounts).filter(([,c])=>c>=2).map(([id])=>S.teams[id]?.short_name).filter(Boolean);
    if(blankTeams.length)blanks.push({gw,teams:blankTeams});
    if(doubleTeams.length)doubles.push({gw,teams:doubleTeams});
  }
  let html='';
  doubles.forEach(d=>{html+=`<div class="bdgw-banner double">🎯 <strong>GW${d.gw} DOUBLE:</strong> ${d.teams.join(', ')} have 2 fixtures</div>`;});
  blanks.forEach(b=>{html+=`<div class="bdgw-banner blank">⚠ <strong>GW${b.gw} BLANK:</strong> ${b.teams.join(', ')} have no fixture</div>`;});
  area.innerHTML=html||'';area.style.display=html?'block':'none';
}

/* ══════════════════════════════════════════════════════════════
   AUTO SQUAD BUILDER (#8)
══════════════════════════════════════════════════════════════ */
function runAutoBuilder(){
  const budget=parseFloat(el('autoBudget')?.value||100);
  const priority=el('autoPriority')?.value||'value';
  const area=el('autoBuilderResult');if(!area)return;
  area.innerHTML='<div style="color:var(--text-sub);font-size:.8rem;padding:.5rem">Building squad...</div>';
  setTimeout(()=>{area.innerHTML=buildSquad(budget,priority,15);},100);
}

function scorePlayer(p,priority){
  if(priority==='form')return p.formVal*(2-p.avgFDR/5);
  if(priority==='fixtures')return p.projectedPts*(2-p.avgFDR/5);
  return p.projectedPts/p.price; // value
}

function buildSquad(budget,priority,size=15){
  const limits={GKP:{min:1,max:2},DEF:{min:3,max:5},MID:{min:2,max:5},FWD:{min:1,max:3}};
  const eligible=S.players.filter(p=>p.minutes>90).sort((a,b)=>scorePlayer(b,priority)-scorePlayer(a,priority));
  const selected=[],teamCounts={},posCounts={GKP:0,DEF:0,MID:0,FWD:0};
  let spent=0;
  // First pass: fill minimums
  for(const pos of['GKP','DEF','MID','FWD']){
    let needed=limits[pos].min;
    for(const p of eligible){
      if(!needed)break;if(selected.find(s=>s.id===p.id))continue;
      if(p.posShort!==pos)continue;
      if((teamCounts[p.team]||0)>=3)continue;
      if(spent+p.price>budget)continue;
      selected.push(p);teamCounts[p.team]=(teamCounts[p.team]||0)+1;posCounts[pos]++;spent+=p.price;needed--;
    }
  }
  // Second pass: fill remaining slots
  for(const p of eligible){
    if(selected.length>=size)break;if(selected.find(s=>s.id===p.id))continue;
    const pos=p.posShort;if(posCounts[pos]>=limits[pos].max)continue;
    if((teamCounts[p.team]||0)>=3)continue;
    if(spent+p.price>budget)continue;
    selected.push(p);teamCounts[p.team]=(teamCounts[p.team]||0)+1;posCounts[pos]++;spent+=p.price;
  }
  if(selected.length<11)return`<div style="color:var(--red);font-size:.82rem;padding:.5rem">Could not build a full squad within £${budget}m. Try increasing the budget.</div>`;
  const totalXpts=selected.reduce((s,p)=>s+p.projectedPts,0);
  const byPos={GKP:selected.filter(p=>p.posShort==='GKP'),DEF:selected.filter(p=>p.posShort==='DEF'),MID:selected.filter(p=>p.posShort==='MID'),FWD:selected.filter(p=>p.posShort==='FWD')};
  const renderPos=(pos,label)=>byPos[pos].length?`<div class="builder-pos-section"><div class="builder-pos-label"><span class="pos-chip pos-${pos}">${pos}</span> ${label}</div><div class="builder-result-grid">${byPos[pos].map(p=>`<div class="builder-player"><div class="builder-player-name">${p.web_name}</div><div class="builder-player-meta">${p.teamShort}·£${p.price.toFixed(1)}m·${p.projectedPts}xP</div></div>`).join('')}</div></div>`:'';
  const addAllBtn=`<button class="btn btn-green btn-sm" id="addAutoSquadBtn" style="margin-top:.5rem">+ Add This Squad</button>`;
  const html=`${renderPos('GKP','Goalkeeper')}${renderPos('DEF','Defenders')}${renderPos('MID','Midfielders')}${renderPos('FWD','Forwards')}<div class="builder-total" style="margin-top:.75rem"><div><div class="builder-total-label">TOTAL COST</div><div style="font-family:var(--font-data);color:var(--amber);font-size:1rem">£${spent.toFixed(1)}m</div></div><div style="text-align:right"><div class="builder-total-label">TOTAL xPts</div><div class="builder-total-val">${Math.round(totalXpts*10)/10}</div></div></div>${addAllBtn}`;
  // Wire up button after render
  setTimeout(()=>{el('addAutoSquadBtn')?.addEventListener('click',()=>{S.myTeam=selected.map(p=>p.id);saveTeam();renderPlayerTable();renderMyTeam();renderDashboard();alert(`✅ Added ${selected.length} players to your squad!`);});},100);
  return html;
}

/* ══════════════════════════════════════════════════════════════
   WILDCARD PLANNER (#9)
══════════════════════════════════════════════════════════════ */
function runWildcard(){
  const area=el('wildcardResult');if(!area)return;
  area.innerHTML='<div style="color:var(--text-sub);font-size:.8rem;padding:.5rem">Generating wildcard team...</div>';
  setTimeout(()=>{
    // Score over next 5 GWs
    const startGW=S.nextGW||(S.currentGW?S.currentGW+1:1);
    const scored=S.players.map(p=>{
      let totalScore=0;for(let gw=startGW;gw<startGW+5;gw++){const fx=S.allFixtures.filter(f=>f.event===gw&&(f.team_h===p.team||f.team_a===p.team));if(!fx.length)continue;const avgFdr=fx.reduce((s,f)=>s+(f.team_h===p.team?f.team_h_difficulty:f.team_a_difficulty),0)/fx.length;totalScore+=p.formVal*fdrMult(avgFdr);}return{...p,wcScore:totalScore};
    });
    S.players=scored;
    const html=buildSquad(100,'form',15);
    // Restore
    area.innerHTML=`<div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub);margin-bottom:.5rem">Optimised for GW${startGW}–GW${startGW+4} fixture difficulty</div>${html}`;
  },100);
}

/* ══════════════════════════════════════════════════════════════
   CHIP PLANNER (#3)
══════════════════════════════════════════════════════════════ */
function renderChipPlanner(){
  const area=el('chipPlannerArea');if(!area)return;
  if(!S.fplEntryId){area.innerHTML=emptyState('🃏','CONNECT ACCOUNT','Login to see your chip status and suggestions.');return;}
  if(!S.gwHistory){area.innerHTML='<div style="color:var(--text-sub);padding:1rem;font-size:.8rem">Loading chip data...</div>';fetchGWHistory().then(()=>renderChipPlanner());return;}
  const usedChips=(S.gwHistory.chips||[]).map(c=>c.name);
  const allChips=[
    {name:'wildcard',icon:'🃏',label:'Wildcard',desc:'Free transfers for 1 GW',suggestion:()=>{const bad=S.players.filter(p=>S.myTeam.includes(p.id)&&p.avgFDR>=4).length;return bad>=4?`⚡ Good time to play — ${bad} players have tough fixtures`:'Hold for a more disruptive fixture schedule';}},
    {name:'freehit',icon:'🎯',label:'Free Hit',desc:'Unlimited free transfers for 1 GW',suggestion:()=>{const blanks=[];for(const p of myPlayers()){if(!p.upcomingFixtures.length)blanks.push(p.web_name);}return blanks.length>=3?`Useful — ${blanks.slice(0,2).join(', ')} have no next fixture`:'Hold for a blank gameweek';}},
    {name:'bboost',icon:'💪',label:'Bench Boost',desc:'Bench players score points too',suggestion:()=>'Play when your bench has great fixtures and form'},
    {name:'3xc',icon:'⭐',label:'Triple Captain',desc:'Captain scores 3× points',suggestion:()=>{const cap=S.players.find(p=>p.id===S.captainId)||myPlayers().sort((a,b)=>capScore(b)-capScore(a))[0];return cap?`Best on ${cap.web_name} (Form ${cap.form}) vs easy fixture`:'Set a captain first';}},
  ];
  area.innerHTML=allChips.map(chip=>{
    const used=usedChips.includes(chip.name);
    const gwUsed=S.gwHistory.chips?.find(c=>c.name===chip.name);
    return `<div class="chip-card"><div class="chip-icon">${chip.icon}</div><div style="flex:1"><div class="chip-name">${chip.label}</div><div class="chip-status ${used?'chip-used':'chip-available'}">${used?`Used GW${gwUsed?.event||'?'}`:'✅ Available'}</div><div style="font-size:.75rem;color:var(--text-sub);margin-top:2px">${chip.desc}</div>${!used?`<div class="chip-suggestion">💡 ${chip.suggestion()}</div>`:''}</div></div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════════
   POINTS PREDICTOR (#10)
══════════════════════════════════════════════════════════════ */
function renderPredictor(){
  const posF=el('predictorPosFilter')?.value||'';
  const sortKey=el('predictorSort')?.value||'total';
  const area=el('predictorResults');if(!area)return;
  let pool=S.players.filter(p=>p.minutes>0);if(posF)pool=pool.filter(p=>p.posShort===posF);
  // Score breakdown
  const predicted=pool.map(p=>{
    const fix=p.upcomingFixtures[0];const fdr=fix?fix.difficulty:3;const fdrMul_=fdrMult(fdr);
    const avgMins=p.minutes/Math.max(1,S.currentGW||1);const playProb=Math.min(1,avgMins/90);
    const minutesPts=playProb>=0.75?2:playProb>=0.5?1:0;
    const isAttacker=p.element_type===3||p.element_type===4;
    const isDefender=p.element_type===1||p.element_type===2;
    const threat=parseFloat(p.threat)||0,creativity=parseFloat(p.creativity)||0;
    const goalProb=isAttacker?(threat/100)*fdrMul_*0.3:isDefender?(threat/100)*fdrMul_*0.08:0;
    const assistProb=isAttacker?(creativity/100)*fdrMul_*0.25:0;
    const goalPts=goalProb*(p.element_type===4?4:p.element_type===3?5:6);
    const assistPts=assistProb*3;
    const csPts=isDefender?(fdr<=2?0.5:fdr<=3?0.35:0.15)*(p.element_type===1?6:4):isAttacker?(fdr<=2?0.25:0.15)*1:0;
    const bonusPts=(goalProb+assistProb)*1.2;
    const total=minutesPts+goalPts+assistPts+csPts+bonusPts;
    return{...p,pred:{total:Math.round(total*10)/10,minutes:minutesPts,goals:Math.round(goalPts*10)/10,assists:Math.round(assistPts*10)/10,cs:Math.round(csPts*10)/10,bonus:Math.round(bonusPts*10)/10},nextFix:fix};
  });
  if(sortKey==='goals')predicted.sort((a,b)=>b.pred.goals-a.pred.goals);
  else if(sortKey==='cs')predicted.sort((a,b)=>b.pred.cs-a.pred.cs);
  else predicted.sort((a,b)=>b.pred.total-a.pred.total);
  const top=predicted.slice(0,15);
  const maxTotal=Math.max(...top.map(p=>p.pred.total),1);
  area.innerHTML=top.map(p=>{
    const inTeam=S.myTeam.includes(p.id);const full=!inTeam&&S.myTeam.length>=15;
    const col=tc(p.teamShort);
    const bar=(val,color,max)=>`<div class="predictor-bar-track"><div class="predictor-bar-fill" style="width:${Math.round((val/max)*100)}%;background:${color}"></div></div>`;
    return `<div class="predictor-row"><div class="team-color-bar" style="background:${col.p}"></div><div style="flex:1;min-width:0"><div style="font-weight:700;display:flex;align-items:center;gap:4px">${p.web_name} <span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div><div style="font-size:.68rem;color:var(--text-sub)">${p.teamShort}·£${p.price.toFixed(1)}m${p.nextFix?` · ${p.nextFix.home?'':' @'}${p.nextFix.opponent} GW${p.nextFix.gw}`:''}</div><div class="predictor-bars" style="margin-top:4px"><div class="predictor-bar-row"><span class="predictor-bar-label">Mins</span>${bar(p.pred.minutes,'var(--blue)',2)}<span class="predictor-bar-val">${p.pred.minutes}</span></div><div class="predictor-bar-row"><span class="predictor-bar-label">Goals</span>${bar(p.pred.goals,'var(--green)',6)}<span class="predictor-bar-val">${p.pred.goals}</span></div><div class="predictor-bar-row"><span class="predictor-bar-label">Assists</span>${bar(p.pred.assists,'var(--amber)',3)}<span class="predictor-bar-val">${p.pred.assists}</span></div>${p.pred.cs?`<div class="predictor-bar-row"><span class="predictor-bar-label">CS</span>${bar(p.pred.cs,'var(--blue)',6)}<span class="predictor-bar-val">${p.pred.cs}</span></div>`:''}<div class="predictor-bar-row"><span class="predictor-bar-label">Bonus</span>${bar(p.pred.bonus,'var(--amber)',3)}<span class="predictor-bar-val">${p.pred.bonus}</span></div></div></div><div style="text-align:right;flex-shrink:0;padding-left:.5rem"><div class="predictor-total">${p.pred.total}</div><button class="add-btn ${inTeam?'in-team':''}" data-pid="${p.id}" ${full?'disabled':''} style="margin-top:4px;padding:4px 8px;font-size:.65rem">${inTeam?'✓':'＋'}</button></div></div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════════
   TRANSFERS
══════════════════════════════════════════════════════════════ */
function renderTransfers(){
  const mp=myPlayers();
  if(!mp.length){setHTML('transferArea',emptyState('⇄','NO SQUAD','Build your team first.'));}
  else{
    const sugg=[];
    mp.forEach(cur=>{const best=S.players.filter(p=>p.element_type===cur.element_type&&p.id!==cur.id&&!S.myTeam.includes(p.id)&&p.price<=cur.price+0.5&&p.projectedPts>cur.projectedPts).sort((a,b)=>b.projectedPts-a.projectedPts)[0];if(best)sugg.push({out:cur,in:best,gain:Math.round((best.projectedPts-cur.projectedPts)*10)/10});});
    sugg.sort((a,b)=>b.gain-a.gain);const top=sugg.slice(0,8);
    if(!top.length)setHTML('transferArea',emptyState('✅','OPTIMAL','No better options within budget.'));
    else{const fx=f=>f?`${f.home?'':'@'}${f.opponent} GW${f.gw} <span class="fdr fdr-${f.difficulty}">${f.difficulty}</span>`:'';setHTML('transferArea',`<div class="card-header" style="margin-bottom:.75rem"><span class="card-title">AI SUGGESTIONS</span><span class="card-badge badge-green">TOP ${top.length}</span></div>${top.map(s=>`<div class="transfer-item"><div class="transfer-out"><div class="transfer-label">OUT</div><div class="transfer-player" style="color:var(--red)">${s.out.web_name}</div><div class="transfer-stats">Form ${s.out.form}·£${s.out.price.toFixed(1)}m ${fx(s.out.upcomingFixtures[0])}</div></div><div class="transfer-arrow">→</div><div class="transfer-in"><div class="transfer-label">IN</div><div class="transfer-player" style="color:var(--green)">${s.in.web_name}</div><div class="transfer-stats">Form ${s.in.form}·£${s.in.price.toFixed(1)}m ${fx(s.in.upcomingFixtures[0])}</div></div><div class="transfer-gain">+${s.gain}xP</div></div>`).join('')}`);}
  }
  const active=S.players.filter(p=>p.transfers_in_event>0||p.transfers_out_event>0);
  const topIn=[...active].sort((a,b)=>b.transfers_in_event-a.transfers_in_event).slice(0,8);
  const topOut=[...active].sort((a,b)=>b.transfers_out_event-a.transfers_out_event).slice(0,8);
  const noData='<div style="padding:1rem;color:var(--text-sub);font-size:.78rem">No data yet.</div>';
  const row=(p,key,color)=>{const val=p[key],maxV=(key==='transfers_in_event'?(topIn[0]?.[key]||1):(topOut[0]?.[key]||1));return`<div style="padding:.45rem 0;border-bottom:1px solid var(--border)"><div style="display:flex;justify-content:space-between"><div><div style="font-weight:700;font-size:.82rem">${p.web_name}</div><div style="font-size:.68rem;color:var(--text-sub)">${p.teamShort}·£${p.price.toFixed(1)}m·${p.form}</div></div><div style="font-family:var(--font-data);font-size:.68rem;color:${color}">${val.toLocaleString()}</div></div><div class="progress-bar"><div class="progress-fill" style="width:${Math.round(val/maxV*100)}%;background:${color}"></div></div></div>`;};
  const inEl=el('transfersInList'),outEl=el('transfersOutList');
  if(inEl)inEl.innerHTML=topIn.length?topIn.map(p=>row(p,'transfers_in_event','var(--green)')).join(''):noData;
  if(outEl)outEl.innerHTML=topOut.length?topOut.map(p=>row(p,'transfers_out_event','var(--red)')).join(''):noData;
}

/* ══════════════════════════════════════════════════════════════
   FIXTURES
══════════════════════════════════════════════════════════════ */
function renderFixtureGwSelect(){
  const sel=el('fixtureGwSelect');if(!sel||!S.bootstrap)return;
  sel.innerHTML=S.bootstrap.events.filter(e=>e.id>=1).map(e=>`<option value="${e.id}" ${e.is_current?'selected':''}>${e.name}</option>`).join('');
}
function renderFixtures(){
  const gw=parseInt(el('fixtureGwSelect')?.value||S.currentGW||1);
  const list=S.allFixtures.filter(f=>f.event===gw);
  if(!list.length){setHTML('fixturesArea','<div style="padding:2rem;text-align:center;color:var(--text-sub)">No fixtures found.</div>');return;}
  setHTML('fixturesArea',list.map(f=>{
    const h=S.teams[f.team_h],a=S.teams[f.team_a];
    const ko=f.kickoff_time?new Date(f.kickoff_time):null;
    const ts=ko?ko.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})+' '+ko.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'TBC';
    let mid;
    if(f.finished||f.finished_provisional)mid=`<div class="fixture-score">${f.team_h_score??'?'}–${f.team_a_score??'?'}</div>`;
    else if(f.started)mid=`<div class="fixture-score" style="color:var(--amber)">${f.team_h_score??0}–${f.team_a_score??0}</div><div class="fixture-time">LIVE ${f.minutes}'</div>`;
    else mid=`<div class="fixture-vs">vs</div><div class="fixture-time">${ts}</div>`;
    return`<div class="fixture-item"><div class="fixture-team home"><span class="fdr fdr-${f.team_h_difficulty}">${f.team_h_difficulty}</span> ${h?.name||'?'}</div><div class="fixture-center">${mid}</div><div class="fixture-team">${a?.name||'?'} <span class="fdr fdr-${f.team_a_difficulty}">${f.team_a_difficulty}</span></div></div>`;
  }).join(''));
}

/* ══════════════════════════════════════════════════════════════
   LIVE GW
══════════════════════════════════════════════════════════════ */
function renderLivePanel(){
  const{starters}=getSquadGroups();const mp=myPlayers();
  if(!mp.length){setHTML('livePlayerList',emptyState('◎','NO SQUAD','Build your team first.'));return;}
  if(!S.liveData){setHTML('livePlayerList',emptyState('◎','NO LIVE DATA','Active during live gameweeks.'));return;}
  const sorted=[...starters].sort((a,b)=>(S.liveData[b.id]?.stats?.total_points??0)-(S.liveData[a.id]?.stats?.total_points??0));
  let total=0;
  const rows=sorted.map(p=>{
    const live=S.liveData[p.id]?.stats||{},pts=live.total_points??0;
    const isC=p.id===S.captainId,isV=p.id===S.vcaptainId,eff=isC?pts*2:pts;total+=eff;
    const bd=buildPtsBreakdown(S.liveData[p.id]);const col_=tc(p.teamShort);
    const col=pts>=10?'var(--green)':pts>=6?'var(--amber)':'var(--text)';
    return`<div class="team-list-row"><div class="team-color-bar" style="background:${col_.p}"></div><div style="flex:1;min-width:0"><div style="font-weight:700;display:flex;align-items:center;gap:4px;flex-wrap:wrap">${p.web_name}${isC?'<span class="card-badge badge-amber">C×2</span>':''}${isV?'<span class="card-badge badge-blue">V/C</span>':''}<span class="pos-chip pos-${p.posShort}">${p.posShort}</span></div><div style="font-size:.68rem;color:var(--text-sub)">${p.teamShort}·${live.minutes??0} mins</div>${bd?`<div class="pts-breakdown">${bd}</div>`:''}</div><div style="text-align:right;flex-shrink:0"><div style="font-family:var(--font-data);font-size:1.3rem;font-weight:700;color:${col}">${eff}</div><div style="font-family:var(--font-data);font-size:.56rem;color:var(--text-sub)">pts</div></div></div>`;
  });
  setHTML('livePlayerList',rows.join(''));setText('liveSquadPts',total);
}

/* ══════════════════════════════════════════════════════════════
   FPL ACCOUNT
══════════════════════════════════════════════════════════════ */
function openModal(){const m=el('loginModal');if(m)m.style.display='flex';const inp=el('loginTeamId');if(inp)inp.value='';clearLoginErr();}
function closeModal(){const m=el('loginModal');if(m)m.style.display='none';clearLoginErr();}
function clearLoginErr(){const e=el('loginError');if(e){e.style.display='none';e.textContent='';}}
function setLoginErr(msg){const e=el('loginError');if(e){e.style.display='block';e.textContent=msg;}}
function handleAccountBtn(){if(S.fplEntryId)switchTab('leagues');else openModal();}

async function submitTeamId(){
  const inp=el('loginTeamId'),btn=el('loginSubmitBtn');
  const id=parseInt(inp?.value?.trim());if(!id||isNaN(id)){setLoginErr('Enter a valid Team ID.');return;}
  clearLoginErr();if(btn){btn.textContent='CONNECTING...';btn.disabled=true;}
  try{await connectEntry(id);}catch(err){setLoginErr(`Failed: ${err.message}`);}
  finally{if(btn){btn.textContent='CONNECT TEAM';btn.disabled=false;}}
}

async function connectEntry(entryId){
  const res=await fplFetch(`/entry/${entryId}/`);if(!res.ok){setLoginErr(`No FPL team found with ID ${entryId}.`);return;}
  const raw=await res.json();
  S.fplEntryId=entryId;
  S.fplPlayer={first_name:raw.player_first_name||'',last_name:raw.player_last_name||'',teamName:raw.name||'',summary_overall_points:raw.summary_overall_points,summary_overall_rank:raw.summary_overall_rank,summary_event_points:raw.summary_event_points,entry:entryId};
  S.myLeagues=raw.leagues||{classic:[],h2h:[]};
  localStorage.setItem('fpl_entry_id',entryId);localStorage.setItem('fpl_player',JSON.stringify(S.fplPlayer));localStorage.setItem('fpl_leagues',JSON.stringify(S.myLeagues));
  closeModal();updateAccountUI();renderDashboard();
  await importFplTeam();fetchGWHistory();
}

async function searchManager(){
  const inp=el('managerSearchInput'),res=el('managerSearchResults');const q=inp?.value?.trim();if(!q||!res)return;
  res.style.display='block';res.innerHTML='<div style="color:var(--text-sub);font-size:.78rem;padding:.5rem">Searching...</div>';
  try{
    const r=await fplFetch(`/search/?q=${encodeURIComponent(q)}&page_size=8`);if(!r.ok)throw new Error('No results');
    const data=await r.json();const entries=data.results||[];
    if(!entries.length){res.innerHTML=`<div style="color:var(--text-sub);font-size:.78rem;padding:.5rem">No managers found for "${q}"</div>`;return;}
    res.innerHTML=entries.map(e=>`<div class="search-result-item"><div><div style="font-weight:700;font-size:.82rem">${e.player_name}</div><div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">${e.entry_name}·ID ${e.entry}·Rank ${e.entry_rank?.toLocaleString()||'—'}</div></div><button class="btn btn-green btn-sm sr-select" data-eid="${e.entry}">Select</button></div>`).join('');
  }catch{res.innerHTML='<div style="color:var(--text-sub);font-size:.78rem;padding:.5rem">Search unavailable. Enter Team ID directly.</div>';}
}

function updateAccountUI(){
  const btn=el('accountBtn'),lbl=el('accountBtnLabel');if(!btn)return;
  if(S.fplPlayer){btn.classList.add('logged-in');if(lbl)lbl.textContent=S.fplPlayer.first_name||'ACCOUNT';}
  else{btn.classList.remove('logged-in');if(lbl)lbl.textContent='LOGIN';}
}

function logout(){
  S.fplEntryId=null;S.fplPlayer=null;S.myLeagues={classic:[],h2h:[]};S.gwHistory=null;
  ['fpl_entry_id','fpl_player','fpl_leagues'].forEach(k=>localStorage.removeItem(k));
  updateAccountUI();renderDashboard();renderLeaguesTab();
  el('seasonStatsSection').style.display='none';el('historyChartSection').style.display='none';
}

async function importFplTeam(){
  if(!S.fplEntryId)return;const gw=S.currentGW||S.nextGW;if(!gw)return;
  try{
    const res=await fplFetch(`/entry/${S.fplEntryId}/event/${gw}/picks/`);if(!res.ok)return;
    const data=await res.json();const picks=data.picks||[];if(!picks.length)return;
    const newTeam=picks.map(pk=>pk.element).filter(id=>S.players.find(p=>p.id===id));if(!newTeam.length)return;
    S.myTeam=newTeam;S.pickOrder={};picks.forEach(pk=>{S.pickOrder[pk.element]=pk.position;});
    const capPick=picks.find(pk=>pk.is_captain),vcPick=picks.find(pk=>pk.is_vice_captain);
    if(capPick)S.captainId=capPick.element;if(vcPick)S.vcaptainId=vcPick.element;
    saveTeam();renderAll();
  }catch(err){console.warn('Import:',err.message);}
}

/* ══════════════════════════════════════════════════════════════
   LEAGUES + H2H TRACKER (#11) + RANK TRACKER (#12)
══════════════════════════════════════════════════════════════ */
function renderLeaguesTab(){
  const prompt=el('leaguesLoginPrompt'),content=el('leaguesContent');
  if(!S.fplEntryId){if(prompt)prompt.style.display='block';if(content)content.style.display='none';return;}
  if(prompt)prompt.style.display='none';if(content)content.style.display='block';
  renderEntryCard();loadLeaguesList();
  if(S.gwHistory)renderRankTracker();
}

function renderEntryCard(){
  const e=el('fplEntryCard');if(!e||!S.fplPlayer)return;
  const p=S.fplPlayer;
  e.innerHTML=`<div class="entry-card-name">${p.first_name} ${p.last_name}</div><div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">${p.teamName||''}·Entry #${S.fplEntryId}</div><div class="entry-card-grid"><div class="entry-stat"><div class="entry-stat-val">${p.summary_overall_points||'—'}</div><div class="entry-stat-lbl">Total Pts</div></div><div class="entry-stat"><div class="entry-stat-val">${p.summary_overall_rank?.toLocaleString()||'—'}</div><div class="entry-stat-lbl">Overall Rank</div></div><div class="entry-stat"><div class="entry-stat-val">${p.summary_event_points||'—'}</div><div class="entry-stat-lbl">GW Pts</div></div></div>`;
}

function renderRankTracker(){
  const area=el('rankChartArea');if(!area)return;
  const current=S.gwHistory?.current||[];if(!current.length){area.innerHTML='<div style="color:var(--text-sub);text-align:center;padding:1rem;font-size:.8rem">No rank history</div>';return;}
  const ranks=current.map(g=>g.overall_rank);const labels=current.map(g=>`GW${g.event}`);
  // Invert ranks so going up on chart = better rank
  const inverted=ranks.map(r=>-r);
  const chart=svgLineChart(inverted,labels,'var(--blue)',90);
  const latest=ranks[ranks.length-1];const prev=ranks[ranks.length-2]||latest;const delta=prev-latest;
  area.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem"><span style="font-family:var(--font-data);font-size:.65rem;color:var(--text-sub)">OVERALL RANK MOVEMENT</span><span style="font-family:var(--font-data);font-size:.75rem;color:${delta>0?'var(--green)':delta<0?'var(--red)':'var(--text-sub)'}">${delta>0?'▲':'▼'} ${Math.abs(delta).toLocaleString()}</span></div><div class="rank-chart-wrap">${chart}</div><div style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub);text-align:center;margin-top:.25rem">Lower rank number = better position (chart shows inverted)</div>`;
}

async function loadLeaguesList(){
  if(S.myLeagues?.classic?.length||S.myLeagues?.h2h?.length){renderLeagueLists(S.myLeagues);return;}
  setHTML('classicLeaguesList','<div style="color:var(--text-sub);padding:.5rem;font-size:.78rem">Loading...</div>');
  try{
    const res=await fplFetch(`/entry/${S.fplEntryId}/`);if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const data=await res.json();S.myLeagues=data.leagues||{classic:[],h2h:[]};
    localStorage.setItem('fpl_leagues',JSON.stringify(S.myLeagues));renderLeagueLists(S.myLeagues);
  }catch(err){setHTML('classicLeaguesList',`<div style="color:var(--red);font-size:.78rem;padding:.5rem">Failed: ${err.message}</div>`);}
}

function renderLeagueLists(leagues){
  const render=(list,id)=>{const e=el(id);if(!e)return;if(!list?.length){e.innerHTML='<div style="color:var(--text-sub);font-size:.78rem;padding:.5rem 0">No leagues.</div>';return;}e.innerHTML=list.map(l=>`<div class="league-item" data-lid="${l.id}" data-name="${l.name||l.league_name||'League'}"><div><div class="league-name">${l.name||l.league_name||'—'}</div><div class="league-meta">ID: ${l.id}·Rank: ${l.entry_rank?.toLocaleString()||'—'}</div></div><span style="color:var(--text-sub)">›</span></div>`).join('');};
  render(leagues.classic||[],'classicLeaguesList');render(leagues.h2h||[],'h2hLeaguesList');
}

async function loadStandings(lid,type,name,page=1){
  S.currentLeagueId=lid;S.currentLeagueType=type;
  const panel=el('standingsPanel'),title=el('standingsTitle'),table=el('standingsTable');
  if(!panel)return;panel.style.display='block';if(title&&name)title.textContent=name.toUpperCase();if(table)table.innerHTML='<div style="padding:1rem;color:var(--text-sub)">Loading...</div>';
  try{
    const ep=type==='h2h'?`/leagues-h2h/${lid}/standings/?page_standings=${page}`:`/leagues-classic/${lid}/standings/?page_standings=${page}`;
    const res=await fplFetch(ep);if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const data=await res.json();const rows=data.standings?.results||[];
    if(!rows.length){if(table)table.innerHTML='<div style="padding:1rem;color:var(--text-sub)">No data.</div>';return;}
    if(table)table.innerHTML=`<div class="standings-row header"><div>#</div><div>Manager</div><div>GW</div><div>Total</div><div>±</div></div>${rows.map(r=>{const isMine=r.entry===S.fplEntryId,top3=r.rank<=3;const mv=(r.last_rank||r.rank)-r.rank;const mCls=mv>0?'move-up':mv<0?'move-down':'move-same';const mStr=mv>0?`▲${mv}`:mv<0?`▼${Math.abs(mv)}`:'–';return`<div class="standings-row ${isMine?'my-entry':''}"><div class="s-rank ${top3?'top3':''}">${r.rank}</div><div><div style="font-weight:700;font-size:.82rem">${r.player_name}</div><div style="font-size:.68rem;color:var(--text-sub)">${r.entry_name}</div></div><div style="text-align:right;font-family:var(--font-data);font-size:.78rem">${r.event_total}</div><div class="s-pts">${r.total}</div><div class="s-move ${mCls}">${mStr}</div></div>`;}).join('')}`;
    // H2H rival tracker (#11)
    if(type==='classic'&&S.fplEntryId){renderH2HTracker(rows);}
    const pag=el('standingsPagination');if(pag){let ph='';if(page>1)ph+=`<button class="page-btn" data-page="${page-1}">‹ Prev</button>`;ph+=`<span style="font-family:var(--font-data);font-size:.62rem;color:var(--text-sub)">Page ${page}</span>`;if(data.standings?.has_next)ph+=`<button class="page-btn" data-page="${page+1}">Next ›</button>`;pag.innerHTML=ph;}
  }catch(err){if(table)table.innerHTML=`<div style="padding:1rem;color:var(--red)">Failed: ${err.message}</div>`;}
}

function renderH2HTracker(rows){
  // Show manager above and below you in the league
  const myIdx=rows.findIndex(r=>r.entry===S.fplEntryId);if(myIdx<0)return;
  const rivals=[];
  if(myIdx>0)rivals.push({...rows[myIdx-1],relation:'⬆ Above you'});
  rivals.push({...rows[myIdx],relation:'👤 You',isMe:true});
  if(myIdx<rows.length-1)rivals.push({...rows[myIdx+1],relation:'⬇ Below you'});
  const section=el('h2hTrackerSection'),area=el('h2hTrackerArea');
  if(!section||!area)return;
  section.style.display='block';
  area.innerHTML=rivals.map(r=>`<div class="h2h-row ${r.isMe?'my-row':''}"><div><div class="h2h-manager">${r.player_name} <span style="font-family:var(--font-data);font-size:.6rem;color:var(--text-sub)">#${r.rank}</span></div><div class="h2h-meta">${r.entry_name}·${r.relation}</div></div><div class="h2h-pts" style="color:${r.isMe?'var(--green)':'var(--text)'}">${r.total}</div></div>`).join('');
}

function hideStandings(){const p=el('standingsPanel');if(p)p.style.display='none';}

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */
const el=id=>document.getElementById(id);
function myPlayers(){return S.players.filter(p=>S.myTeam.includes(p.id));}
function setText(id,v){const e=el(id);if(e)e.textContent=v;}
function setHTML(id,v){const e=el(id);if(e)e.innerHTML=v;}
function pad(n){return String(n).padStart(2,'0');}
function emptyState(icon,h,p){return`<div class="empty-state"><div class="icon">${icon}</div><h3>${h}</h3><p>${p}</p></div>`;}

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',init);
