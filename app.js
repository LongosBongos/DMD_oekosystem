// DMD DApp — FINAL App Logic (Split 2/2)
// Kompatibel mit Solflare, Phantom & Bitget
// Vollständige Rollen- und Whitelist-Kontrolle (Founder / Investor / Trader)
// Program ID: EDY4bp4fXWkAJpJhXUMZLL7fjpDhpKZQFPpygzsTMzro
// Mint:       3rCZT3Xw6jvU4JWatQPsivS8fQ7gV7GjUfJnbTk9Ssn5
// Vault PDA:  AfbZG6WHh462YduimCUmAvVi3jSjGfkaQCyEnYPeXwPF (SOL for BUY)
// Founder:    AqPFb5LWQuzKiyoKTX9XgUwsYWoFvpeE8E8uzQvnDTzT

import { Connection, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Transaction, TransactionInstruction } from "https://esm.sh/@solana/web3.js@1.95.3?bundle";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "https://esm.sh/@solana/spl-token@0.4.6?bundle";

// Anchor nur bei Bedarf laden (und Fehler abfangen)
const loadAnchor = async () => {
  try { return await import("https://esm.sh/@coral-xyz/anchor@0.29.0?bundle"); }
  catch (e) { console.warn("Anchor-Ladefehler:", e); throw new Error("Anchor konnte nicht geladen werden (CDN/Netz)."); }
};

const enc = new TextEncoder();
const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);

// ---- GLOBAL STATE ----
const STATE = {
  rpcUrl: localStorage.getItem('dmd_rpc') || ($('#rpcUrl')?.value ?? 'https://api.mainnet-beta.solana.com'),
  programId: new PublicKey(localStorage.getItem('dmd_program') || ($('#programId')?.value ?? 'EDY4bp4fXWkAJpJhXUMZLL7fjpDhpKZQFPpygzsTMzro')),
  mint: new PublicKey(localStorage.getItem('dmd_mint') || ($('#mintAddr')?.value ?? '3rCZT3Xw6jvU4JWatQPsivS8fQ7gV7GjUfJnbTk9Ssn5')),
  vault: new PublicKey(localStorage.getItem('dmd_vault') || ($('#vaultAddr')?.value ?? 'AfbZG6WHh462YduimCUmAvVi3jSjGfkaQCyEnYPeXwPF')),
  founder: new PublicKey(localStorage.getItem('dmd_founder') || ($('#founderAddr')?.value ?? 'AqPFb5LWQuzKiyoKTX9XgUwsYWoFvpeE8E8uzQvnDTzT')),
  treasury: new PublicKey(localStorage.getItem('dmd_treasury') || ($('#treasuryAddr')?.value ?? 'CEUmazdgtbUCcQyLq6NCm4BuQbvCsYFzKsS5wdRvZehV')),
  idl: null,
  methods: {
    initialize: localStorage.getItem('m_initialize') || ($('#mInitialize')?.value ?? 'initialize'),
    toggleSale: localStorage.getItem('m_toggle') || ($('#mToggleSale')?.value ?? 'toggle_public_sale'),
    whitelistAdd: localStorage.getItem('m_wladd') || ($('#mWhitelistAdd')?.value ?? 'whitelist_add'),
    whitelistRemove: localStorage.getItem('m_wlrm') || ($('#mWhitelistRemove')?.value ?? 'whitelist_add'),
    buy: localStorage.getItem('m_buy') || ($('#mBuy')?.value ?? 'buy_dmd'),
    sell: localStorage.getItem('m_sell') || ($('#mSell')?.value ?? 'sell_dmd'),
    claimReward: localStorage.getItem('m_claim') || ($('#mClaim')?.value ?? 'claim_reward'),
    burnDmd: localStorage.getItem('m_burn') || ($('#mBurn')?.value ?? 'burnDmd'),
    updateConfig: localStorage.getItem('m_update') || ($('#mUpdate')?.value ?? 'updateConfig'),
  },
  wallet: null,
  connection: null,
  price: Number(localStorage.getItem('dmd_price') || '0.01'),
  charts: { mcap: null },
  role: 'UNKNOWN', // FOUNDER | INVESTOR | TRADER | UNKNOWN
  wlMode: localStorage.getItem('wl_mode') || 'buyerStatePda',
  wlSeed1: 'buyer',
  wlAccountName: 'BuyerState',
  wlFlagField: 'whitelisted',
  roleOverride: localStorage.getItem('role_override') || 'auto',
};

const getConnection = ()=> (STATE.connection ??= new Connection(STATE.rpcUrl, { commitment: 'confirmed' }));

// ---- WALLET DETECTION (Solflare, Phantom, Bitget) ----
function listSolanaProviders(){
  const w = window; const found = [];
  if(w.solflare?.isSolflare) found.push({ name:'Solflare', provider:w.solflare });
  if(w.solana?.isPhantom)   found.push({ name:'Phantom',  provider:w.solana });
  if(w.bitget?.solana)      found.push({ name:'Bitget',   provider:w.bitget.solana });
  if(w.bitkeep?.solana)     found.push({ name:'Bitget',   provider:w.bitkeep.solana });
  if(w.solana && !w.solana.isPhantom) found.push({ name:'SolanaProvider', provider:w.solana });
  return found;
}
function getProvider(){
  const list = listSolanaProviders();
  const preferred = ['Solflare','Phantom','Bitget'];
  for(const n of preferred){ const x = list.find(p=>p.name===n); if(x) return x.provider; }
  return list[0]?.provider || null;
}
function getProviderName(p){
  if(!p) return '—'; if(p.isSolflare) return 'Solflare'; if(p.isPhantom) return 'Phantom';
  if(window.bitget?.solana===p || window.bitkeep?.solana===p) return 'Bitget';
  return 'Wallet';
}

async function connectWallet(){
  const provider = getProvider();
  if(!provider){ alert('Kein Wallet‑Provider gefunden. Bitte Solflare, Phantom oder Bitget nutzen (im In‑App‑Browser).'); return; }
  try{
    if(provider.connect)      await provider.connect();
    else if(provider.request) await provider.request({ method:'connect' });
    STATE.wallet = provider;
    $('#connectBtn') && ($('#connectBtn').textContent = `Verbunden (${getProviderName(provider)})`);
    $('#walletAddr') && ($('#walletAddr').textContent = provider.publicKey?.toBase58?.() || '—');
    await refreshBalances();
    await resolveRole();
  }catch(e){ console.error(e); alert('Wallet‑Verbindung abgelehnt oder fehlgeschlagen.'); }
}

// ---- CHARTS ----
function ensureChart(){ if(STATE.charts.mcap) return; if(!window.Chart) return; const ctx=$('#chartMcap'); if(!ctx) return; STATE.charts.mcap = new Chart(ctx, { type:'line', data:{ labels:[], datasets:[{ label:'Market Cap (USD)', data:[] }] }, options:{ responsive:true, scales:{ y:{ beginAtZero:true } } } }); }
function pushMcapPoint(v){ ensureChart(); if(!STATE.charts.mcap) return; const ds=STATE.charts.mcap.data; ds.labels.push(new Date().toLocaleTimeString()); ds.datasets[0].data.push(v); if(ds.labels.length>60){ ds.labels.shift(); ds.datasets[0].data.shift(); } STATE.charts.mcap.update(); }

// ---- READERS ----
async function getMintInfo(){
  try{
    const info = await getConnection().getParsedAccountInfo(STATE.mint);
    const parsed = info?.value?.data?.parsed;
    if(parsed?.info){ const supply=Number(parsed.info.supply); const decimals=Number(parsed.info.decimals); return { supplyUi: supply/10**decimals, decimals } }
  }catch(e){ console.warn('MintInfo', e); }
  return { supplyUi:0, decimals:9 };
}
async function getWalletSol(pubkey){ try{ return (await getConnection().getBalance(pubkey))/LAMPORTS_PER_SOL; }catch{ return 0; } }
async function getWalletDmd(pubkey){ try{ const r=await getConnection().getParsedTokenAccountsByOwner(pubkey,{ mint:STATE.mint }); const acc=r.value[0]; if(!acc) return 0; return acc.account.data.parsed.info.tokenAmount.uiAmount || 0; }catch{ return 0; } }
async function getFounderAta(){ try{ return await getAssociatedTokenAddress(STATE.mint, STATE.founder, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID); }catch{ return null; } }

async function refreshBalances(){
  const mint = await getMintInfo();
  $('#kpi-supply') && ($('#kpi-supply').textContent = mint.supplyUi.toLocaleString('en-US'));
  await computeAndRenderMcap(mint.supplyUi);
  const pk = STATE.wallet?.publicKey;
  if(pk){ const [sol,dmd] = await Promise.all([getWalletSol(pk), getWalletDmd(pk)]); $('#kpi-sol') && ($('#kpi-sol').textContent = sol.toFixed(4)); $('#kpi-dmd') && ($('#kpi-dmd').textContent = dmd.toLocaleString('en-US')); }
}

async function computeAndRenderMcap(pre){
  const supply = pre ?? (await getMintInfo()).supplyUi; let circ = supply;
  try{
    const ata = await getFounderAta();
    if(ata){ const a=await getConnection().getParsedAccountInfo(ata); const p=a?.value?.data?.parsed; if(p?.type==='account' && p?.info?.mint===STATE.mint.toBase58()){ const fb=p.info.tokenAmount.uiAmount||0; circ=Math.max(0, supply - fb); } }
  }catch{}
  const mcap = STATE.price * circ; const txt = mcap? `$${mcap.toLocaleString('en-US',{maximumFractionDigits:2})}` : '—';
  $('#kpi-mcap') && ($('#kpi-mcap').textContent = txt); $('#mcapNow') && ($('#mcapNow').textContent = txt); pushMcapPoint(mcap);
}

// ---- ANCHOR PROGRAM ----
let anchorLib = null;
async function getProgram(){
  if(!STATE.idl) throw new Error('IDL nicht gesetzt (Einstellungen → IDL speichern).');
  if(!STATE.wallet?.publicKey) throw new Error('Wallet nicht verbunden.');
  if(!anchorLib) anchorLib = await loadAnchor();
  const { AnchorProvider, Program, BN } = anchorLib;
  const provider = new AnchorProvider(getConnection(), STATE.wallet, { commitment:'confirmed' });
  return { program: new Program(STATE.idl, STATE.programId, provider), provider, BN };
}

// ---- ROLLEN & ZUGRIFF ----
function roleAllows(action){
  // Matrix: FOUNDER alles; INVESTOR = buy/sell/claim; TRADER = buy/sell
  const r = STATE.role;
  const founderOnly = ['init','toggle','whitelist','burn','update','readVault'];
  const investorOrFounder = ['claim'];
  if(founderOnly.includes(action)) return r==='FOUNDER';
  if(investorOrFounder.includes(action)) return (r==='FOUNDER' || r==='INVESTOR');
  // buy/sell & sonstiges ist jedem erlaubt (sichtbar je nach Tab)
  return true;
}
function assertCan(action){ if(!roleAllows(action)) throw new Error('Aktion in dieser Rolle nicht erlaubt.'); }

function applyRoleUi(){
  const show = (tab, v)=>{ const t=$(`.tab[data-tab="${tab}"]`); const p=$(`section[data-panel="${tab}"]`); if(t) t.hidden=!v; if(p) p.hidden=!v; };
  if(STATE.role==='FOUNDER'){ show('investor',true); show('trader',true); show('founder',true); show('settings',true); }
  else if(STATE.role==='INVESTOR'){ show('investor',true); show('trader',false); show('founder',false); show('settings',false); $('.tab[data-tab="investor"])')?.click(); }
  else if(STATE.role==='TRADER'){ show('investor',false); show('trader',true); show('founder',false); show('settings',false); $('.tab[data-tab="trader"])')?.click(); }
  else { show('investor',false); show('trader',true); show('founder',false); show('settings',false); }
  // Buttons hart absichern
  $('#claimBtn') && ($('#claimBtn').disabled = !roleAllows('claim'));
  $('#initBtn') &&  ($('#initBtn').disabled  = !roleAllows('init'));
  $('#toggleSaleBtn') && ($('#toggleSaleBtn').disabled = !roleAllows('toggle'));
  $('#wlAdd') && ($('#wlAdd').disabled = !roleAllows('whitelist'));
  $('#wlRemove') && ($('#wlRemove').disabled = !roleAllows('whitelist'));
  $('#burnBtn') && ($('#burnBtn').disabled = !roleAllows('burn'));
  $('#ecoUpdate') && ($('#ecoUpdate').disabled = !roleAllows('update'));
  $('#readVault') && ($('#readVault').disabled = !roleAllows('readVault'));
  $('#roleBadge') && ($('#roleBadge').textContent = `Rolle: ${STATE.role}`);
}

async function deriveBuyerStatePda(buyerPk){
  const [pda] = PublicKey.findProgramAddressSync([ enc.encode(STATE.wlSeed1), STATE.vault.toBuffer(), buyerPk.toBuffer() ], STATE.programId);
  return pda;
}

async function isWhitelisted(forPk){
  if(STATE.wlMode==='none') return false;
  try{
    const { program } = await getProgram();
    const pda = await deriveBuyerStatePda(forPk);
    const info = await getConnection().getAccountInfo(pda);
    if(!info) return false;
    const acc = program.coder.accounts.decode('BuyerState', info.data);
    return Boolean(acc.whitelisted);
  }catch(e){ console.warn('Whitelist decode failed:', e); return false; }
}

async function resolveRole(){
  const out=$('#wlCheckStatus');
  try{
    if(!STATE.wallet?.publicKey){ STATE.role='UNKNOWN'; applyRoleUi(); return; }
    if(STATE.wallet.publicKey.toBase58()===STATE.founder.toBase58()){ STATE.role='FOUNDER'; applyRoleUi(); out&&(out.textContent='Founder erkannt ✓'); return; }
    if(STATE.roleOverride && STATE.roleOverride!=='auto'){ STATE.role=STATE.roleOverride; applyRoleUi(); out&&(out.textContent=`Override: ${STATE.role}`); return; }
    if(STATE.wlMode==='none'){ STATE.role='TRADER'; applyRoleUi(); out&&(out.textContent='Whitelist deaktiviert → TRADER'); return; }
    const wl = await isWhitelisted(STATE.wallet.publicKey);
    STATE.role = wl ? 'INVESTOR' : 'TRADER';
    applyRoleUi(); out&&(out.textContent = wl ? 'Wallet ist auf Whitelist ✓ (INVESTOR)' : 'Nicht auf Whitelist → TRADER');
  }catch(e){ out&&(out.textContent='Whitelist/Role Fehler: ' + (e.message||e)); STATE.role='TRADER'; applyRoleUi(); }
}

// ---- ACTIONS ----
async function doInitialize(){ const out=$('#initStatus'); out&&(out.textContent='Sende Initialize...'); try{
  assertCan('init'); const { program, BN } = await getProgram();
  const founderPk = STATE.wallet.publicKey;
  const buyerStatePda = await deriveBuyerStatePda(founderPk);
  const founderAta = await getAssociatedTokenAddress(STATE.mint, founderPk, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const priceSol = Number(prompt('Initial price (SOL per DMD, z.B. 0.000001)?','0.000001')) || 0;
  const priceLamports = new BN(String(Math.round(priceSol*1e9)));
  const sig = await program.methods[STATE.methods.initialize](priceLamports).accounts({
    vault: STATE.vault,
    buyer_state: buyerStatePda,
    founder: founderPk,
    mint: STATE.mint,
    founder_token_account: founderAta,
    token_program: TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
  }).rpc(); out&&(out.innerHTML=`✅ Initialize: <span class="mono">${sig}</span>`); }catch(e){ out&&(out.textContent='❌ '+(e.message||e)); } }

async function doToggleSale(){ const out=$('#toggleStatus'); out&&(out.textContent='Sende Toggle...'); try{
  assertCan('toggle'); const { program } = await getProgram(); let next=true;
  try{ const info=await getConnection().getAccountInfo(STATE.vault); if(info?.data){ const acc=(await getProgram()).program.coder.accounts.decode('Vault', info.data); next=!acc.public_sale_active; } }catch{}
  const sig = await program.methods[STATE.methods.toggleSale](next).accounts({ vault: STATE.vault, founder: STATE.wallet.publicKey }).rpc();
  $('#saleState') && ($('#saleState').textContent = next? 'aktiv':'inaktiv'); out&&(out.innerHTML=`✅ Toggle: <span class="mono">${sig}</span>`); }catch(e){ out&&(out.textContent='❌ '+(e.message||e)); } }

async function doWhitelist(add=true){ const out=$('#wlStatus'); out&&(out.textContent='Sende Whitelist...'); try{
  assertCan('whitelist'); const addr=$('#wlAddr')?.value?.trim(); if(!addr) throw new Error('Adresse fehlt.'); const { program } = await getProgram(); const buyerPk=new PublicKey(addr);
  const buyerStatePda = await deriveBuyerStatePda(buyerPk);
  const sig = await program.methods[STATE.methods.whitelistAdd](!!add).accounts({
    vault: STATE.vault,
    buyer: buyerPk,
    buyer_state: buyerStatePda,
    founder: STATE.wallet.publicKey,
    system_program: SystemProgram.programId,
  }).rpc(); out&&(out.innerHTML=`✅ WL ${add?'Add':'Remove'}: <span class="mono">${sig}</span>`);
  // Falls der Founder sich selbst umstellt, Rolle neu berechnen
  await resolveRole(); }catch(e){ out&&(out.textContent='❌ '+(e.message||e)); } }

async function doBuy(){ const out=$('#buyStatus'); out&&(out.textContent='Kaufe...'); try{
  assertCan('buy'); const sol=Number($('#buySol')?.value||'0'); if(sol<=0) throw new Error('SOL Betrag ungültig.');
  // Investor/Trader Limits
  if(STATE.role!=='FOUNDER'){ if(sol<0.5) throw new Error('Mindestinvestition: 0.5 SOL'); if(sol>10){ alert('Für >10 SOL bitte das DMD‑Team kontaktieren.'); throw new Error('Maximal 10 SOL ohne Sondergenehmigung'); } }
  const { program, BN } = await getProgram();
  // WICHTIG: Deine IDL verlangt Founder‑Signatur für buy_dmd
  if(STATE.wallet.publicKey.toBase58() !== STATE.founder.toBase58()) throw new Error('IDL erfordert Founder‑Signatur für buy_dmd. Bitte Founder‑Wallet verbinden.');
  const lamports = new BN(String(Math.round(sol*1e9)));
  const buyerPk = STATE.wallet.publicKey;
  const buyerStatePda = await deriveBuyerStatePda(buyerPk);
  const founderAta = await getAssociatedTokenAddress(STATE.mint, STATE.founder, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const buyerAta = await getAssociatedTokenAddress(STATE.mint, buyerPk, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const sig = await program.methods[STATE.methods.buy](lamports).accounts({
    vault: STATE.vault,
    buyer_state: buyerStatePda,
    founder: STATE.founder,
    treasury: STATE.treasury,
    founder_token_account: founderAta,
    buyer_token_account: buyerAta,
    buyer: buyerPk,
    token_program: TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
  }).rpc(); out&&(out.innerHTML=`✅ Buy: <span class="mono">${sig}</span>`); await refreshBalances(); }catch(e){ out&&(out.textContent='❌ '+(e.message||e)); } }

async function doSell(){ const out=$('#sellStatus'); out&&(out.textContent='Verkaufe...'); try{
  assertCan('sell'); const dmd=Number($('#sellDmd')?.value||'0'); if(dmd<=0) throw new Error('DMD Menge ungültig.');
  const { program, BN } = await getProgram(); const mint=await getMintInfo(); const amountU64=new BN(String(Math.round(dmd*(10**mint.decimals))));
  const buyerPk = STATE.wallet.publicKey;
  const buyerStatePda = await deriveBuyerStatePda(buyerPk);
  const sig = await program.methods[STATE.methods.sell](amountU64).accounts({ vault: STATE.vault, buyer_state: buyerStatePda, buyer: buyerPk }).rpc();
  out&&(out.innerHTML=`✅ Sell: <span class="mono">${sig}</span>`); await refreshBalances(); }catch(e){ out&&(out.textContent='❌ '+(e.message||e)); } }

async function doClaim(){ const out=$('#claimStatus'); out&&(out.textContent='Claim...'); try{
  assertCan('claim'); const { program } = await getProgram(); const buyerPk=STATE.wallet.publicKey; const buyerStatePda=await deriveBuyerStatePda(buyerPk);
  const sig = await program.methods[STATE.methods.claimReward]().accounts({ vault: STATE.vault, buyer_state: buyerStatePda, buyer: buyerPk }).rpc();
  out&&(out.innerHTML=`✅ Claim: <span class="mono">${sig}</span>`); }catch(e){ out&&(out.textContent='❌ '+(e.message||e)); } }

async function doBurn(){ const out=$('#burnStatus'); out&&(out.textContent='Burn...'); try{
  assertCan('burn'); const n=Number($('#burnAmount')?.value||'0'); if(n<=0) throw new Error('Menge ungültig');
  if(STATE.idl?.instructions?.some(i=>i.name===STATE.methods.burnDmd)){
    const { program, BN } = await getProgram(); const mint=await getMintInfo(); const amt=BigInt(Math.round(n*(10**mint.decimals)));
    const sig= await program.methods[STATE.methods.burnDmd](new BN(amt.toString())).accounts({ /* ggf. Accounts lt. IDL */ }).rpc();
    out&&(out.innerHTML=`✅ Burn (Programm): <span class="mono">${sig}</span>`);
  } else {
    // SPL‑Burn fallback
    const { provider } = await getProgram();
    const owner=STATE.wallet?.publicKey; if(!owner) throw new Error('Wallet nicht verbunden');
    const resp=await getConnection().getParsedTokenAccountsByOwner(owner, { mint: STATE.mint }); const acc=resp.value[0]?.pubkey; if(!acc) throw new Error('Kein DMD Tokenkonto gefunden.');
    const mint=await getMintInfo(); const amount=BigInt(Math.round(n*(10**mint.decimals)));
    const data=new Uint8Array(1+8); data[0]=14; new DataView(data.buffer).setBigUint64(1, amount, true);
    const keys=[ {pubkey:acc,isSigner:false,isWritable:true}, {pubkey:STATE.mint,isSigner:false,isWritable:true}, {pubkey:owner,isSigner:true,isWritable:false} ];
    const ix=new TransactionInstruction({ keys, programId:TOKEN_PROGRAM_ID, data });
    const tx=new Transaction().add(ix);
    const sig = await provider.sendAndConfirm(tx, []);
    out&&(out.innerHTML = `✅ Burn (SPL): <span class="mono">${sig}</span>`);
  }
  await refreshBalances(); }catch(e){ out&&(out.textContent='❌ '+(e.message||e)); }
}

async function doEcoUpdate(){ const out=$('#ecoStatus'); out&&(out.textContent='Sende Update...'); try{
  assertCan('update'); const cfgRaw=$('#ecoJson')?.value?.trim()||''; const cfg = cfgRaw? JSON.parse(cfgRaw):{}; const { program } = await getProgram();
  const sig = await program.methods[STATE.methods.updateConfig](cfg).accounts({ /* ggf. Accounts lt. IDL */ }).rpc();
  out&&(out.innerHTML=`✅ UpdateConfig: <span class=\"mono\">${sig}</span>`); }catch(e){ out&&(out.textContent='❌ '+(e.message||e)); }
}

async function doReadVault(){ const out=$('#ecoStatus'); out&&(out.textContent='Lesen...'); try{
  assertCan('readVault'); const sol = await getWalletSol(STATE.vault);
  let founderDmd='n/a';
  try{ const ata=await getFounderAta(); if(ata){ const acc=await getConnection().getParsedAccountInfo(ata); const p=acc?.value?.data?.parsed; if(p?.type==='account' && p?.info?.mint===STATE.mint.toBase58()){ founderDmd=p.info.tokenAmount.uiAmount; } } }catch{}
  out&&(out.innerHTML=`Vault SOL (BUY-PDA): <b>${sol.toFixed(4)}</b> • Founder DMD (ATA): <b>${founderDmd}</b>`); }catch(e){ out&&(out.textContent='❌ '+(e.message||e)); }
}

// ---- UI WIRING ----
function switchTab(tab){ $$('.tab').forEach(t=>t.dataset.active=String(t.dataset.tab===tab)); $$('section.grid').forEach(s=>{ s.hidden = s.dataset.panel !== tab; }); }
$$('.tab').forEach(t=> t.addEventListener('click', ()=> switchTab(t.dataset.tab)) );

$('#connectBtn')?.addEventListener('click', connectWallet);
$('#buyBtn')?.addEventListener('click', doBuy);
$('#sellBtn')?.addEventListener('click', doSell);
$('#claimBtn')?.addEventListener('click', doClaim);
$('#refreshBalances')?.addEventListener('click', refreshBalances);
$('#initBtn')?.addEventListener('click', doInitialize);
$('#toggleSaleBtn')?.addEventListener('click', doToggleSale);
$('#wlAdd')?.addEventListener('click', ()=>doWhitelist(true));
$('#wlRemove')?.addEventListener('click', ()=>doWhitelist(false));
$('#burnBtn')?.addEventListener('click', doBurn);
$('#ecoUpdate')?.addEventListener('click', doEcoUpdate);
$('#readVault')?.addEventListener('click', doReadVault);

$('#priceManual')?.addEventListener('change', ()=>{ STATE.price = Number($('#priceManual').value||'0.01'); localStorage.setItem('dmd_price', String(STATE.price)); const p=`$${STATE.price.toFixed(4)}`; $('#kpi-price')&&($('#kpi-price').textContent=p); $('#priceNow')&&($('#priceNow').textContent=p); computeAndRenderMcap(); });

function saveNetSettings(){
  STATE.rpcUrl=$('#rpcUrl').value.trim(); localStorage.setItem('dmd_rpc', STATE.rpcUrl);
  STATE.programId=new PublicKey($('#programId').value.trim()); localStorage.setItem('dmd_program', STATE.programId.toBase58());
  STATE.mint=new PublicKey($('#mintAddr').value.trim()); localStorage.setItem('dmd_mint', STATE.mint.toBase58());
  STATE.vault=new PublicKey($('#vaultAddr').value.trim()); localStorage.setItem('dmd_vault', STATE.vault.toBase58());
  STATE.founder=new PublicKey($('#founderAddr').value.trim()); localStorage.setItem('dmd_founder', STATE.founder.toBase58());
  STATE.treasury=new PublicKey($('#treasuryAddr').value.trim()); localStorage.setItem('dmd_treasury', STATE.treasury.toBase58());
  $('#netStatus')&&($('#netStatus').textContent='Gespeichert.'); $('#founderPkPill')&&($('#founderPkPill').textContent=STATE.founder.toBase58());
  STATE.connection=null; resolveRole();
}
['#rpcUrl', '#programId', '#mintAddr', '#vaultAddr', '#founderAddr', '#treasuryAddr'].forEach(sel=> $(sel)?.addEventListener('change', saveNetSettings));

function saveIdl(){ try{ const t=$('#idlInput'); if(!t) throw new Error('IDL Feld fehlt'); const idl = JSON.parse(t.value.trim()); STATE.idl=idl; localStorage.setItem('dmd_idl', JSON.stringify(idl)); $('#idlStatus')&&($('#idlStatus').textContent='IDL gespeichert ✓'); resolveRole(); } catch(e){ $('#idlStatus')&&($('#idlStatus').textContent='IDL Fehler: '+(e.message||e)); } }
$('#saveIdl')?.addEventListener('click', saveIdl);
$('#clearIdl')?.addEventListener('click', ()=>{ STATE.idl=null; localStorage.removeItem('dmd_idl'); const t=$('#idlInput'); if(t) t.value=''; $('#idlStatus')&&($('#idlStatus').textContent='IDL entfernt.'); resolveRole(); });

function saveAccessSettings(){ STATE.wlMode=$('#wlMode').value; localStorage.setItem('wl_mode', STATE.wlMode); STATE.roleOverride=$('#roleOverride').value; localStorage.setItem('role_override', STATE.roleOverride); resolveRole(); }
['#wlMode','#roleOverride'].forEach(sel=> $(sel)?.addEventListener('change', saveAccessSettings));

$('#testWhitelist')?.addEventListener('click', resolveRole);
$('#loadMetadata')?.addEventListener('click', async()=>{ try{ const res=await fetch('./metadata.json'); if(!res.ok) throw new Error('metadata.json nicht gefunden'); const j=await res.json(); $('.title')&&j?.branding?.title && ($('.title').textContent=j.branding.title); $('.subtitle')&&j?.branding?.subtitle && ($('.subtitle').textContent=j.branding.subtitle); $('#metaStatus')&&($('#metaStatus').textContent='Metadata geladen ✓'); }catch(e){ $('#metaStatus')&&($('#metaStatus').textContent='Metadata Fehler: '+(e.message||e)); } });

$('#quickGo')?.addEventListener('click', async()=>{ const side=$('#quickSide').value.startsWith('BUY')?'BUY':'SELL'; const amt=Number($('#quickAmount').value||'0'); if(side==='BUY'){ $('#buySol').value=String(amt); await doBuy(); } else { $('#sellDmd').value=String(amt); await doSell(); } });

function logEvent(t){ const box=$('#eventLog'); if(!box) return; const line=`[${new Date().toLocaleTimeString()}] ${t}`; box.textContent += (box.textContent?"
":"") + line; box.scrollTop = box.scrollHeight; }

// ---- INIT ----
(function init(){
  $('#year') && ($('#year').textContent = new Date().getFullYear());
  $('#founderPkPill') && ($('#founderPkPill').textContent = STATE.founder.toBase58());
  // IDL aus LocalStorage oder Minimal-Hinweis
  const idlSaved = localStorage.getItem('dmd_idl');
  if(idlSaved){ try{ STATE.idl = JSON.parse(idlSaved); $('#idlInput')&&($('#idlInput').value=idlSaved); $('#idlStatus')&&($('#idlStatus').textContent='IDL geladen ✓'); }catch{} }
  else {
    try{ const preIdl = { address: STATE.programId.toBase58(), accounts:[{name:'BuyerState'},{name:'Vault'}], instructions:[{name:'buy_dmd'},{name:'sell_dmd'},{name:'claim_reward'},{name:'initialize'},{name:'toggle_public_sale'},{name:'whitelist_add'}] }; $('#idlInput')&&($('#idlInput').value = JSON.stringify(preIdl, null, 2)); }catch{}
  }
  // Restore Controls
  $('#wlMode') && ($('#wlMode').value = STATE.wlMode); $('#roleOverride') && ($('#roleOverride').value = STATE.roleOverride);
  // Mobile: zunächst nur Trader sichtbar
  const isMobile = /iphone|ipad|android|mobile/i.test(navigator.userAgent); if(isMobile){ $('.tab[data-tab="investor"]').hidden=true; $('.tab[data-tab="founder"]').hidden=true; $('.tab[data-tab="settings"]').hidden=true; $('.tab[data-tab="trader"])')?.click(); }
  // Preis UI setzen
  const p = `$${STATE.price.toFixed(4)}`; $('#kpi-price')&&($('#kpi-price').textContent=p); $('#priceNow')&&($('#priceNow').textContent=p);
  computeAndRenderMcap();
})();
