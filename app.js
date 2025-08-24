// DMD DApp – App Logic (Split 2/2)
// Program ID: EDY4bp4fXWkAJpJhXUMZLL7fjpDhpKZQFPpygzsTMzro
// Mint:       3rCZT3Xw6jvU4JWatQPsivS8fQ7gV7GjUfJnbTk9Ssn5
// Vault PDA:  AfbZG6WHh462YduimCUmAvVi3jSjGfkaQCyEnYPeXwPF (SOL for BUY)
// Founder:    AqPFb5LWQuzKiyoKTX9XgUwsYWoFvpeE8E8uzQvnDTzT

import { Connection, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Transaction, TransactionInstruction } from "https://esm.sh/@solana/web3.js@1.95.3?bundle";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "https://esm.sh/@solana/spl-token@0.4.6?bundle";
const loadAnchor = async () => await import("https://esm.sh/@coral-xyz/anchor@0.29.0?bundle");

const enc = new TextEncoder();
const $ = (q)=>document.querySelector(q); const $$ = (q)=>document.querySelectorAll(q);

const STATE = {
  rpcUrl: localStorage.getItem('dmd_rpc') || (document.getElementById('rpcUrl')?.value ?? 'https://api.mainnet-beta.solana.com'),
  programId: new PublicKey(localStorage.getItem('dmd_program') || (document.getElementById('programId')?.value ?? 'EDY4bp4fXWkAJpJhXUMZLL7fjpDhpKZQFPpygzsTMzro')),
  mint: new PublicKey(localStorage.getItem('dmd_mint') || (document.getElementById('mintAddr')?.value ?? '3rCZT3Xw6jvU4JWatQPsivS8fQ7gV7GjUfJnbTk9Ssn5')),
  vault: new PublicKey(localStorage.getItem('dmd_vault') || (document.getElementById('vaultAddr')?.value ?? 'AfbZG6WHh462YduimCUmAvVi3jSjGfkaQCyEnYPeXwPF')),
  founder: new PublicKey(localStorage.getItem('dmd_founder') || (document.getElementById('founderAddr')?.value ?? 'AqPFb5LWQuzKiyoKTX9XgUwsYWoFvpeE8E8uzQvnDTzT')),
  treasury: new PublicKey(localStorage.getItem('dmd_treasury') || (document.getElementById('treasuryAddr')?.value ?? 'CEUmazdgtbUCcQyLq6NCm4BuQbvCsYFzKsS5wdRvZehV')),
  idl: null,
  methods: {
    initialize: localStorage.getItem('m_initialize') || (document.getElementById('mInitialize')?.value ?? 'initialize'),
    toggleSale: localStorage.getItem('m_toggle') || (document.getElementById('mToggleSale')?.value ?? 'toggle_public_sale'),
    whitelistAdd: localStorage.getItem('m_wladd') || (document.getElementById('mWhitelistAdd')?.value ?? 'whitelist_add'),
    whitelistRemove: localStorage.getItem('m_wlrm') || (document.getElementById('mWhitelistRemove')?.value ?? 'whitelist_add'),
    buy: localStorage.getItem('m_buy') || (document.getElementById('mBuy')?.value ?? 'buy_dmd'),
    sell: localStorage.getItem('m_sell') || (document.getElementById('mSell')?.value ?? 'sell_dmd'),
    claimReward: localStorage.getItem('m_claim') || (document.getElementById('mClaim')?.value ?? 'claim_reward'),
    burnDmd: localStorage.getItem('m_burn') || (document.getElementById('mBurn')?.value ?? 'burnDmd'),
    updateConfig: localStorage.getItem('m_update') || (document.getElementById('mUpdate')?.value ?? 'updateConfig'),
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

function setKpiPrice(){
  const p = `$${STATE.price.toFixed(4)}`;
  const priceNow = document.getElementById('priceNow');
  if(document.getElementById('kpi-price')) document.getElementById('kpi-price').textContent = p;
  if(priceNow) priceNow.textContent = p;
  if(document.getElementById('priceManual')) document.getElementById('priceManual').value = STATE.price;
  computeAndRenderMcap();
}

const getConnection = () => { if(!STATE.connection) STATE.connection = new Connection(STATE.rpcUrl, { commitment: 'confirmed' }); return STATE.connection; };

function getProvider(){
  const anyWindow = window; const providers = [];
  if(anyWindow.solana) providers.push(anyWindow.solana);
  if(anyWindow.solflare) providers.push(anyWindow.solflare);
  return providers.find(p=>p.isSolflare) || providers.find(p=>p.isPhantom) || providers[0] || null;
}

async function connectWallet(){
  const provider = getProvider();
  if(!provider){ alert('Kein Wallet Provider gefunden. Bitte Solflare oder Phantom installieren.'); return; }
  try{
    await provider.connect();
    STATE.wallet = provider;
    const pk = provider.publicKey?.toBase58?.() || '–';
    const wa = document.getElementById('walletAddr'); if(wa) wa.textContent = pk;
    const btn = document.getElementById('connectBtn'); if(btn) btn.textContent = 'Verbunden';
    await refreshBalances();
    await resolveRole();
  }catch(e){ console.error(e); alert('Wallet Verbindung abgelehnt.'); }
}

// ---- Charts ----
function ensureChart(){ if(STATE.charts.mcap) return; const ctx=document.getElementById('chartMcap'); if(!ctx) return; STATE.charts.mcap = new Chart(ctx, { type:'line', data:{ labels:[], datasets:[{ label:'Market Cap (USD)', data:[] }] }, options:{ responsive:true, scales:{ y:{ beginAtZero:true } } } }); }
function pushMcapPoint(value){ ensureChart(); if(!STATE.charts.mcap) return; const ds=STATE.charts.mcap.data; const ts=new Date().toLocaleTimeString(); ds.labels.push(ts); ds.datasets[0].data.push(value); if(ds.labels.length>60){ ds.labels.shift(); ds.datasets[0].data.shift(); } STATE.charts.mcap.update(); }

// ---- Readers ----
async function getMintInfo(){
  try{ const info = await getConnection().getParsedAccountInfo(STATE.mint); const parsed = info?.value?.data?.parsed; if(parsed&&parsed.info){ const supply=Number(parsed.info.supply); const decimals=Number(parsed.info.decimals); return { rawSupply:supply, decimals, supplyUi: supply/10**decimals }; } }catch(e){ console.warn('MintInfo error', e); }
  return { rawSupply:0, decimals:9, supplyUi:0 };
}
async function getWalletSol(pubkey){ try{ const bal = await getConnection().getBalance(pubkey); return bal / LAMPORTS_PER_SOL; }catch{ return 0; } }
async function getWalletDmd(pubkey){ try{ const resp = await getConnection().getParsedTokenAccountsByOwner(pubkey, { mint: STATE.mint }); const acc = resp.value[0]; if(!acc) return 0; const amt = acc.account.data.parsed.info.tokenAmount.uiAmount || 0; return amt; }catch(e){ return 0; } }

async function getFounderAta(){
  try{ const ata = await getAssociatedTokenAddress(STATE.mint, STATE.founder, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID); return ata; }catch(e){ console.warn('Founder ATA error', e); return null; }
}

async function refreshBalances(){
  const pk = STATE.wallet?.publicKey || null; const mint = await getMintInfo();
  const ks = document.getElementById('kpi-supply'); if(ks) ks.textContent = mint.supplyUi.toLocaleString('en-US');
  await computeAndRenderMcap(mint.supplyUi);
  if(pk){ const [sol, dmd] = await Promise.all([ getWalletSol(pk), getWalletDmd(pk) ]);
    const ks2=document.getElementById('kpi-sol'); if(ks2) ks2.textContent = sol.toFixed(4);
    const kd=document.getElementById('kpi-dmd'); if(kd) kd.textContent = dmd.toLocaleString('en-US');
  }
}

async function computeAndRenderMcap(preKnownSupply){
  const mintInfo = preKnownSupply ? { supplyUi: preKnownSupply } : await getMintInfo();
  let circ = mintInfo.supplyUi;
  try{
    // Circulating = TotalSupply – Founder‑Bestand (ATA)
    const founderAta = await getFounderAta();
    if(founderAta){
      const accInfo = await getConnection().getParsedAccountInfo(founderAta);
      const parsed = accInfo?.value?.data?.parsed;
      if(parsed?.type==='account' && parsed?.info?.mint===STATE.mint.toBase64?.() ? parsed?.info?.mint===STATE.mint.toBase64() : parsed?.info?.mint===STATE.mint.toBase58()){
        const founderBal = parsed.info.tokenAmount.uiAmount || 0;
        circ = Math.max(0, circ - founderBal);
      }
    }
  }catch{}
  const mcap = STATE.price * circ; const txt = mcap ? `$${mcap.toLocaleString('en-US',{maximumFractionDigits:2})}` : '—';
  const km=document.getElementById('kpi-mcap'); if(km) km.textContent = txt; const mcapNow=document.getElementById('mcapNow'); if(mcapNow) mcapNow.textContent = txt; pushMcapPoint(mcap);
}

// ---- Program (Anchor) ----
let anchorLib = null; // lazy
async function getProgram(){
  if(!STATE.idl){ throw new Error('IDL nicht gesetzt. Füge die Anchor‑IDL in Einstellungen ein.'); }
  if(!STATE.wallet || !STATE.wallet.publicKey) throw new Error('Wallet nicht verbunden.');
  if(!anchorLib) anchorLib = await loadAnchor();
  const { AnchorProvider, Program, BN } = anchorLib;
  const provider = new AnchorProvider(getConnection(), STATE.wallet, { commitment: 'confirmed' });
  return { program: new Program(STATE.idl, STATE.programId, provider), provider, BN };
}

// ---- Access Control ----
function updateRoleBadge(){ const rb=document.getElementById('roleBadge'); if(rb) rb.textContent = `Rolle: ${STATE.role}`; }

function applyRoleUi(){
  const tabInvestor = document.querySelector('.tab[data-tab="investor"]');
  const panelInvestor = document.querySelector('section[data-panel="investor"]');
  const tabTrader = document.querySelector('.tab[data-tab="trader"]');
  const panelTrader = document.querySelector('section[data-panel="trader"]');
  const tabFounder = document.querySelector('.tab[data-tab="founder"]');
  const panelFounder = document.querySelector('section[data-panel="founder"]');
  const tabSettings = document.querySelector('.tab[data-tab="settings"]');
  const panelSettings = document.querySelector('section[data-panel="settings"]');

  if(STATE.role==='FOUNDER'){
    [tabInvestor,panelInvestor,tabTrader,panelTrader,tabFounder,panelFounder,tabSettings,panelSettings].forEach(el=>{ if(el) el.hidden=false; });
  } else if(STATE.role==='INVESTOR'){
    if(tabInvestor) tabInvestor.hidden=false; if(panelInvestor) panelInvestor.hidden=false;
    if(tabTrader) tabTrader.hidden=true; if(panelTrader) panelTrader.hidden=true;
    if(tabFounder) tabFounder.hidden=true; if(panelFounder) panelFounder.hidden=true;
    if(tabSettings) tabSettings.hidden=true; if(panelSettings) panelSettings.hidden=true;
    if(document.querySelector('.tab[data-active="true"]')?.dataset.tab!=='investor'){ tabInvestor?.click(); }
  } else if(STATE.role==='TRADER'){
    if(tabInvestor) tabInvestor.hidden=true; if(panelInvestor) panelInvestor.hidden=true;
    if(tabTrader) tabTrader.hidden=false; if(panelTrader) panelTrader.hidden=false;
    if(tabFounder) tabFounder.hidden=true; if(panelFounder) panelFounder.hidden=true;
    if(tabSettings) tabSettings.hidden=true; if(panelSettings) panelSettings.hidden=true;
    if(document.querySelector('.tab[data-active="true"]')?.dataset.tab!=='trader'){ tabTrader?.click(); }
  } else {
    if(tabInvestor) tabInvestor.hidden=true; if(panelInvestor) panelInvestor.hidden=true;
    if(tabTrader) tabTrader.hidden=false; if(panelTrader) panelTrader.hidden=false;
    if(tabFounder) tabFounder.hidden=true; if(panelFounder) panelFounder.hidden=true;
    if(tabSettings) tabSettings.hidden=true; if(panelSettings) panelSettings.hidden=true;
  }
  const claimBtn=document.getElementById('claimBtn'); if(claimBtn) claimBtn.disabled = !(STATE.role==='FOUNDER' || STATE.role==='INVESTOR');
  updateRoleBadge();
}

async function deriveBuyerStatePda(buyerPk){
  const seed1 = enc.encode(STATE.wlSeed1 || 'buyer');
  const [pda] = PublicKey.findProgramAddressSync([seed1, STATE.vault.toBuffer(), buyerPk.toBuffer()], STATE.programId);
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
  const out = document.getElementById('wlCheckStatus');
  try{
    if(!STATE.wallet?.publicKey){ STATE.role='UNKNOWN'; applyRoleUi(); return; }
    if(STATE.wallet.publicKey.toBase58() === STATE.founder.toBase58()){ STATE.role='FOUNDER'; applyRoleUi(); if(out) out.textContent='Founder erkannt ✓'; return; }
    if(STATE.roleOverride && STATE.roleOverride!=='auto'){ STATE.role = STATE.roleOverride; applyRoleUi(); if(out) out.textContent=`Override: ${STATE.role}`; return; }
    if(STATE.wlMode==='none'){ STATE.role='TRADER'; applyRoleUi(); if(out) out.textContent='Whitelist deaktiviert → TRADER'; return; }
    const wl = await isWhitelisted(STATE.wallet.publicKey);
    STATE.role = wl ? 'INVESTOR' : 'TRADER';
    applyRoleUi(); if(out) out.textContent = wl ? 'Wallet ist auf Whitelist ✓ (INVESTOR)' : 'Nicht auf Whitelist → TRADER';
  }catch(e){ if(out) out.textContent = 'Whitelist/Role Fehler: ' + (e.message||e); STATE.role='TRADER'; applyRoleUi(); }
}

function assertCan(action){
  const r = STATE.role;
  const founderOnly = ['init','toggle','whitelist','burn','update','readVault'];
  const investorOrFounder = ['claim'];
  if(founderOnly.includes(action) && r!=='FOUNDER') throw new Error('Nur Founder erlaubt.');
  if(investorOrFounder.includes(action) && !(r==='FOUNDER' || r==='INVESTOR')) throw new Error('Nur Investor/Founder erlaubt.');
  return true;
}

// ---- Actions ----
async function doInitialize(){ const out=document.getElementById('initStatus'); if(out) out.textContent='Sende Initialize...'; try{
  assertCan('init'); const { program, provider, BN } = await getProgram();
  const founderPk = STATE.wallet.publicKey;
  const buyerStatePda = await deriveBuyerStatePda(founderPk);
  const founderAta = await getAssociatedTokenAddress(STATE.mint, founderPk, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const priceSol = Number(prompt('Initial price (SOL per DMD, z.B. 0.000001)?','0.000001')) || 0;
  const priceLamports = new BN(String(Math.round(priceSol * 1e9)));
  const tx = await program.methods[STATE.methods.initialize](priceLamports).accounts({
    vault: STATE.vault,
    buyer_state: buyerStatePda,
    founder: founderPk,
    mint: STATE.mint,
    founder_token_account: founderAta,
    token_program: TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
  }).rpc(); if(out) out.innerHTML=`✅ Initialize: <span class="mono">${tx}</span>`; }
  catch(e){ if(out) out.textContent='❌ '+(e.message||e); }
}

async function doToggleSale(){ const out=document.getElementById('toggleStatus'); if(out) out.textContent='Sende Toggle...'; try{
  assertCan('toggle'); const { program } = await getProgram();
  let next = true;
  try{ const info = await getConnection().getAccountInfo(STATE.vault); if(info?.data){ const acc = (await getProgram()).program.coder.accounts.decode('Vault', info.data); next = !acc.public_sale_active; } }catch{}
  const tx= await program.methods[STATE.methods.toggleSale](next).accounts({ vault: STATE.vault, founder: STATE.wallet.publicKey }).rpc();
  const ss=document.getElementById('saleState'); if(ss) ss.textContent = next? 'aktiv' : 'inaktiv'; if(out) out.innerHTML=`✅ Toggle: <span class="mono">${tx}</span>`; }
  catch(e){ if(out) out.textContent='❌ '+(e.message||e); }
}

async function doWhitelist(add=true){ const out=document.getElementById('wlStatus'); if(out) out.textContent='Sende Whitelist...'; try{
  assertCan('whitelist'); const addr=document.getElementById('wlAddr').value.trim(); if(!addr) throw new Error('Adresse fehlt.'); const { program } = await getProgram(); const buyerPk=new PublicKey(addr);
  const buyerStatePda = await deriveBuyerStatePda(buyerPk);
  const tx= await program.methods[STATE.methods.whitelistAdd](!!add).accounts({
    vault: STATE.vault,
    buyer: buyerPk,
    buyer_state: buyerStatePda,
    founder: STATE.wallet.publicKey,
    system_program: SystemProgram.programId,
  }).rpc(); if(out) out.innerHTML=`✅ WL ${add?'Add':'Remove'}: <span class="mono">${tx}</span>`; }
  catch(e){ if(out) out.textContent='❌ '+(e.message||e); }
}

async function doBuy(){ const out=document.getElementById('buyStatus'); if(out) out.textContent='Kaufe...'; try{
  assertCan('buy'); const sol=Number(document.getElementById('buySol').value||'0'); if(sol<=0) throw new Error('SOL Betrag ungültig.');
  if(STATE.role!=='FOUNDER'){ if(sol<0.5) throw new Error('Mindestinvestition: 0.5 SOL'); if(sol>10){ alert('Für >10 SOL bitte das DMD‑Team kontaktieren.'); throw new Error('Maximal 10 SOL ohne Sondergenehmigung'); } }
  const { program, BN } = await getProgram();
  if(STATE.wallet.publicKey.toBase58() !== STATE.founder.toBase58()) throw new Error('IDL erfordert Founder‑Signatur für buy_dmd. Bitte Founder‑Wallet verbinden.');
  const lamports = new BN(String(Math.round(sol*1e9)));
  const buyerPk = STATE.wallet.publicKey;
  const buyerStatePda = await deriveBuyerStatePda(buyerPk);
  const founderAta = await getAssociatedTokenAddress(STATE.mint, STATE.founder, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const buyerAta = await getAssociatedTokenAddress(STATE.mint, buyerPk, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const tx= await program.methods[STATE.methods.buy](lamports).accounts({
    vault: STATE.vault,
    buyer_state: buyerStatePda,
    founder: STATE.founder,
    treasury: STATE.treasury,
    founder_token_account: founderAta,
    buyer_token_account: buyerAta,
    buyer: buyerPk,
    token_program: TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
  }).rpc(); if(out) out.innerHTML=`✅ Buy: <span class="mono">${tx}</span>`; logEvent(`BUY ${sol} SOL`); await refreshBalances(); }
  catch(e){ if(out) out.textContent='❌ '+(e.message||e); }
}

async function doSell(){ const out=document.getElementById('sellStatus'); if(out) out.textContent='Verkaufe...'; try{
  assertCan('sell'); const dmd=Number(document.getElementById('sellDmd').value||'0'); if(dmd<=0) throw new Error('DMD Menge ungültig.');
  const { program, BN } = await getProgram(); const mint=await getMintInfo(); const amountU64=new BN(String(Math.round(dmd*(10**mint.decimals))));
  const buyerPk = STATE.wallet.publicKey;
  const buyerStatePda = await deriveBuyerStatePda(buyerPk);
  const tx= await program.methods[STATE.methods.sell](amountU64).accounts({
    vault: STATE.vault,
    buyer_state: buyerStatePda,
    buyer: buyerPk,
  }).rpc(); if(out) out.innerHTML=`✅ Sell: <span class="mono">${tx}</span>`; logEvent(`SELL ${dmd} DMD`); await refreshBalances(); }
  catch(e){ if(out) out.textContent='❌ '+(e.message||e); }
}

async function doClaim(){ const out=document.getElementById('claimStatus'); if(out) out.textContent='Claim...'; try{
  assertCan('claim'); const { program } = await getProgram(); const buyerPk = STATE.wallet.publicKey; const buyerStatePda = await deriveBuyerStatePda(buyerPk);
  const tx= await program.methods[STATE.methods.claimReward]().accounts({ vault: STATE.vault, buyer_state: buyerStatePda, buyer: buyerPk }).rpc();
  if(out) out.innerHTML=`✅ Claim: <span class="mono">${tx}</span>`; }
  catch(e){ if(out) out.textContent='❌ '+(e.message||e); }
}

async function doBurn(){ const out=document.getElementById('burnStatus'); if(out) out.textContent='Burn...'; try{
  assertCan('burn'); const n=Number(document.getElementById('burnAmount').value||'0'); if(n<=0) throw new Error('Menge ungültig');
  if(STATE.idl?.instructions?.some(i=>i.name===STATE.methods.burnDmd)){
    const { program, BN } = await getProgram(); const mint=await getMintInfo(); const amt=BigInt(Math.round(n*(10**mint.decimals))); const tx= await program.methods[STATE.methods.burnDmd](new BN(amt.toString())).accounts({ /* TODO: accounts lt. IDL falls vorhanden */ }).rpc(); if(out) out.innerHTML=`✅ Burn (Programm): <span class=\"mono\">${tx}</span>`;
  } else {
    // SPL-Burn Fallback
    const { provider } = await getProgram();
    const owner=STATE.wallet?.publicKey; if(!owner) throw new Error('Wallet nicht verbunden');
    const resp=await getConnection().getParsedTokenAccountsByOwner(owner, { mint: STATE.mint }); const acc=resp.value[0]?.pubkey; if(!acc) throw new Error('Kein DMD Tokenkonto gefunden.');
    const mint=await getMintInfo(); const amount=BigInt(Math.round(n*(10**mint.decimals)));
    const data=new Uint8Array(1+8); data[0]=14; new DataView(data.buffer).setBigUint64(1, amount, true);
    const keys=[ {pubkey:acc,isSigner:false,isWritable:true}, {pubkey:STATE.mint,isSigner:false,isWritable:true}, {pubkey:owner,isSigner:true,isWritable:false} ];
    const ix=new TransactionInstruction({ keys, programId: TOKEN_PROGRAM_ID, data });
    const txo=new Transaction().add(ix);
    const sig = await provider.sendAndConfirm(txo, []);
    if(out) out.innerHTML = `✅ Burn (SPL): <span class="mono">${sig}</span>`;
  }
  await refreshBalances(); }catch(e){ if(out) out.textContent='❌ '+(e.message||e); }
}

async function doEcoUpdate(){ const out=document.getElementById('ecoStatus'); if(out) out.textContent='Sende Update...'; try{
  assertCan('update'); const cfgRaw=document.getElementById('ecoJson').value.trim(); const cfg= cfgRaw? JSON.parse(cfgRaw):{}; const { program } = await getProgram();
  const tx= await program.methods[STATE.methods.updateConfig](cfg).accounts({ /* TODO: accounts lt. IDL falls notwendig */ }).rpc(); if(out) out.innerHTML=`✅ UpdateConfig: <span class=\"mono\">${tx}</span>`; }
  catch(e){ if(out) out.textContent='❌ '+(e.message||e); }
}

async function doReadVault(){ const out=document.getElementById('ecoStatus'); if(out) out.textContent='Lesen...'; try{
  assertCan('readVault'); const sol= await getWalletSol(STATE.vault);
  let founderDmd='n/a';
  try{ const ata = await getFounderAta(); if(ata){ const acc= await getConnection().getParsedAccountInfo(ata); const p=acc?.value?.data?.parsed; if(p?.type==='account' && (p?.info?.mint===STATE.mint.toBase58())){ founderDmd = p.info.tokenAmount.uiAmount; } } }catch{}
  if(out) out.innerHTML=`Vault SOL (BUY-PDA): <b>${sol.toFixed(4)}</b> • Founder DMD (ATA): <b>${founderDmd}</b>`; }
  catch(e){ if(out) out.textContent='❌ '+(e.message||e); }
}

// ---- UI wiring ----
function switchTab(tab){ $$('.tab').forEach(t=>t.dataset.active = String(t.dataset.tab===tab)); $$('section.grid').forEach(s=>{ s.hidden = s.dataset.panel !== tab; }); }
$$('.tab').forEach(t=> t.addEventListener('click', ()=> switchTab(t.dataset.tab)) );

document.getElementById('connectBtn')?.addEventListener('click', connectWallet);
document.getElementById('buyBtn')?.addEventListener('click', doBuy);
document.getElementById('sellBtn')?.addEventListener('click', doSell);
document.getElementById('claimBtn')?.addEventListener('click', doClaim);
document.getElementById('refreshBalances')?.addEventListener('click', refreshBalances);
document.getElementById('initBtn')?.addEventListener('click', doInitialize);
document.getElementById('toggleSaleBtn')?.addEventListener('click', doToggleSale);
document.getElementById('wlAdd')?.addEventListener('click', ()=>doWhitelist(true));
document.getElementById('wlRemove')?.addEventListener('click', ()=>doWhitelist(false));
document.getElementById('burnBtn')?.addEventListener('click', doBurn);
document.getElementById('ecoUpdate')?.addEventListener('click', doEcoUpdate);
document.getElementById('readVault')?.addEventListener('click', doReadVault);

document.getElementById('priceManual')?.addEventListener('change', ()=>{ STATE.price = Number(document.getElementById('priceManual').value||'0.01'); localStorage.setItem('dmd_price', String(STATE.price)); setKpiPrice(); });

function saveNetSettings(){ STATE.rpcUrl=document.getElementById('rpcUrl').value.trim(); localStorage.setItem('dmd_rpc', STATE.rpcUrl); STATE.programId=new PublicKey(document.getElementById('programId').value.trim()); localStorage.setItem('dmd_program', STATE.programId.toBase58()); STATE.mint=new PublicKey(document.getElementById('mintAddr').value.trim()); localStorage.setItem('dmd_mint', STATE.mint.toBase58()); STATE.vault=new PublicKey(document.getElementById('vaultAddr').value.trim()); localStorage.setItem('dmd_vault', STATE.vault.toBase58()); STATE.founder=new PublicKey(document.getElementById('founderAddr').value.trim()); localStorage.setItem('dmd_founder', STATE.founder.toBase58()); STATE.treasury=new PublicKey(document.getElementById('treasuryAddr').value.trim()); localStorage.setItem('dmd_treasury', STATE.treasury.toBase58()); const ns=document.getElementById('netStatus'); if(ns) ns.textContent='Gespeichert.'; const fp=document.getElementById('founderPkPill'); if(fp) fp.textContent=STATE.founder.toBase58(); STATE.connection=null; resolveRole(); }
['#rpcUrl', '#programId', '#mintAddr', '#vaultAddr', '#founderAddr', '#treasuryAddr'].forEach(sel=> document.querySelector(sel)?.addEventListener('change', saveNetSettings));

function saveIdl(){ try{ const t=document.getElementById('idlInput'); if(!t) throw new Error('IDL Feld fehlt'); const idl = JSON.parse(t.value.trim()); STATE.idl=idl; localStorage.setItem('dmd_idl', JSON.stringify(idl)); const s=document.getElementById('idlStatus'); if(s) s.textContent='IDL gespeichert ✓'; resolveRole(); } catch(e){ const s=document.getElementById('idlStatus'); if(s) s.textContent='IDL Fehler: '+(e.message||e); } }
document.getElementById('saveIdl')?.addEventListener('click', saveIdl);
document.getElementById('clearIdl')?.addEventListener('click', ()=>{ STATE.idl=null; localStorage.removeItem('dmd_idl'); const t=document.getElementById('idlInput'); if(t) t.value=''; const s=document.getElementById('idlStatus'); if(s) s.textContent='IDL entfernt.'; resolveRole(); });

function saveAccessSettings(){ STATE.wlMode=document.getElementById('wlMode').value; localStorage.setItem('wl_mode', STATE.wlMode); STATE.roleOverride=document.getElementById('roleOverride').value; localStorage.setItem('role_override', STATE.roleOverride); resolveRole(); }
['#wlMode','#roleOverride'].forEach(sel=> document.querySelector(sel)?.addEventListener('change', saveAccessSettings));

document.getElementById('testWhitelist')?.addEventListener('click', resolveRole);
document.getElementById('loadMetadata')?.addEventListener('click', async()=>{ try{ const res=await fetch('./metadata.json'); if(!res.ok) throw new Error('metadata.json nicht gefunden'); const j=await res.json(); const t=document.querySelector('.title'); if(t && j?.branding?.title) t.textContent=j.branding.title; const st=document.querySelector('.subtitle'); if(st && j?.branding?.subtitle) st.textContent=j.branding.subtitle; const meta=document.getElementById('metaStatus'); if(meta) meta.textContent='Metadata geladen ✓'; }catch(e){ const meta=document.getElementById('metaStatus'); if(meta) meta.textContent='Metadata Fehler: '+(e.message||e); } });

document.getElementById('quickGo')?.addEventListener('click', async()=>{ const side=document.getElementById('quickSide').value.startsWith('BUY')?'BUY':'SELL'; const amt=Number(document.getElementById('quickAmount').value||'0'); if(side==='BUY'){ document.getElementById('buySol').value=String(amt); await doBuy(); } else { document.getElementById('sellDmd').value=String(amt); await doSell(); } });

function logEvent(t){ const box=document.getElementById('eventLog'); if(!box) return; const line=`[${new Date().toLocaleTimeString()}] ${t}`; box.textContent += (box.textContent?"\n":"") + line; box.scrollTop = box.scrollHeight; }

// INIT
(async function init(){
  const y=document.getElementById('year'); if(y) y.textContent = new Date().getFullYear();
  const fp=document.getElementById('founderPkPill'); if(fp) fp.textContent = STATE.founder.toBase58();
  // Load saved IDL or prefill
  const idlSaved = localStorage.getItem('dmd_idl');
  if(idlSaved){ try{ STATE.idl = JSON.parse(idlSaved); const t=document.getElementById('idlInput'); if(t) t.value = idlSaved; const s=document.getElementById('idlStatus'); if(s) s.textContent='IDL geladen ✓'; }catch{} }
  else {
    // Prefill minimal IDL-hints (optional)
    try{ const preIdl = {
      address: 'EDY4bp4fXWkAJpJhXUMZLL7fjpDhpKZQFPpygzsTMzro',
      accounts: [{ name:'BuyerState' }, { name:'Vault' }],
      instructions: [ { name:'buy_dmd' }, { name:'sell_dmd' }, { name:'claim_reward' }, { name:'initialize' }, { name:'toggle_public_sale' }, { name:'whitelist_add' } ]
    }; const t=document.getElementById('idlInput'); if(t) t.value = JSON.stringify(preIdl, null, 2); }catch{}
  }

  // Restore price & role controls
  const wm=document.getElementById('wlMode'); if(wm) wm.value = STATE.wlMode; const ro=document.getElementById('roleOverride'); if(ro) ro.value = STATE.roleOverride;

  // Mobile: bis Rollen-Erkennung nur Trader sichtbar
  const ua = navigator.userAgent.toLowerCase(); const isMobile = /iphone|ipad|android|mobile/.test(ua);
  if(isMobile){ const tabInvestor = document.querySelector('.tab[data-tab="investor"]'); const tabFounder = document.querySelector('.tab[data-tab="founder"]'); const tabSettings = document.querySelector('.tab[data-tab="settings"]'); if(tabInvestor) tabInvestor.hidden = true; if(tabFounder) tabFounder.hidden = true; if(tabSettings) tabSettings.hidden = true; const t=document.querySelector('.tab[data-tab="trader"]'); if(t) t.click(); }

  setKpiPrice();
})();
