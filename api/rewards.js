// js/rewards.js
import { supabase } from '/supabaseClient.js';

// Your bot (without @)
const BOT_USERNAME = 'ChadiliZe';

// Mini helper: Telegram WebApp object if available
const WebApp = window.Telegram?.WebApp;

// UI refs
const btnOpen = document.getElementById('claimRewardsBtn');
const modal = document.getElementById('claimModal');
const tiersHost = document.getElementById('rwTiers');
const linkBox = document.getElementById('rwLinkBox');
const linkEl = document.getElementById('rwLink');
const copyBtn = document.getElementById('rwCopy');

// App-side state (we read your existing local state shape to set claim flags)
const STORAGE_KEY = 'chad_state_' + (WebApp?.initDataUnsafe?.user?.id ?? 'guest');
let state = loadLocalState();
function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { chads: 0n, purchases:{}, invited: {1:false,2:false,3:false}, claimed: {1:false,2:false,3:false} };
    const o = JSON.parse(raw);
    return {
      chads: BigInt(o.chads ?? '0'),
      purchases: o.purchases ?? {},
      invited: o.invited ?? {1:false,2:false,3:false},
      claimed: o.claimed ?? {1:false,2:false,3:false}
    };
  } catch {
    return { chads: 0n, purchases:{}, invited: {1:false,2:false,3:false}, claimed: {1:false,2:false,3:false} };
  }
}
function saveLocalState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state, (_,v)=>typeof v==='bigint'? v.toString():v)); }

// Rewards table (you can tweak values)
const TIERS = [
  { tier:1, title:'Add a friend', reward: 500_000n },
  { tier:2, title:'Add a friend', reward: 50_000_000n },
  { tier:3, title:'Add a friend', reward: 3_000_000_000n },
];

// UI — open/close modal
btnOpen?.addEventListener('click', () => { openModal(); renderTiers(); });
modal?.addEventListener('click', (e) => {
  if (e.target.dataset.close !== undefined || e.target.classList.contains('rw-modal-backdrop')) closeModal();
});
function openModal(){ modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); linkBox.classList.add('hidden'); }
function closeModal(){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); }

// Render rows
function renderTiers() {
  tiersHost.innerHTML = '';
  TIERS.forEach(({tier, title, reward}) => {
    const prevOk = tier === 1 || state.claimed[tier-1] === true;
    const isClaimed = state.claimed[tier] === true;
    const canClaim = state.invited[tier] === true && !isClaimed;

    const row = document.createElement('div');
    row.className = 'rw-row';

    row.innerHTML = `
      <div class="rw-left">
        <div class="rw-badge" aria-hidden="true"></div>
        <div>
          <div class="rw-title">${title}</div>
          <div class="rw-reward">Claim ${Number(reward).toLocaleString()} chads</div>
        </div>
        ${isClaimed ? '<span class="rw-tick">✔</span>' : ''}
      </div>
      <div class="rw-actions">
        <button class="rw-btn rw-send" data-tier="${tier}" ${(!prevOk || isClaimed) ? 'disabled':''}>Send link</button>
        <button class="rw-btn rw-claim ${canClaim ? 'active':''}" data-claim="${tier}">Claim</button>
      </div>
    `;

    tiersHost.appendChild(row);
  });

  // bind buttons
  tiersHost.querySelectorAll('.rw-send').forEach(btn => {
    btn.addEventListener('click', async () => {
      const t = Number(btn.dataset.tier);
      await handleSend(t, btn);
    });
  });
  tiersHost.querySelectorAll('.rw-claim').forEach(btn => {
    btn.addEventListener('click', async () => {
      const t = Number(btn.dataset.claim);
      await handleClaim(t, btn);
    });
  });
}

// Build a Telegram deep link using startapp (recommended for Mini Apps)
function buildInviteLink(code) {
  // e.g., https://t.me/ChadiliZe?startapp=ref_ABCXYZ
  const payload = encodeURIComponent(`ref_${code}`);
  return `https://t.me/${BOT_USERNAME}?startapp=${payload}`;
}

// Try to open link inside Telegram Mini App; fallback to window.open and copy
async function openShareLink(url) {
  try {
    if (WebApp?.openTelegramLink) {
      WebApp.openTelegramLink(url);    // recommended in Mini App
    } else if (WebApp?.openLink) {
      WebApp.openLink(url);
    } else {
      window.open(url, '_blank');
    }
  } catch (e) {
    console.error('open link error', e);
  }
  // Always reveal the link & copy as a UX fallback
  linkEl.href = url;
  linkEl.textContent = url;
  linkBox.classList.remove('hidden');
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied to clipboard.');
  } catch {
    /* ignore */
  }
}

copyBtn?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(linkEl.href); toast('Copied!'); } catch {}
});

function toast(msg){
  if (WebApp?.showPopup) WebApp.showPopup({title:'', message:msg, buttons:[{type:'ok'}]});
  else alert(msg);
}

// Call your RPC to create/get an invite code; fallback to local code if RPC fails.
async function getInviteCode(tier) {
  try {
    const { data, error } = await supabase.rpc('create_invite', { tier });
    if (error) throw error;
    // Your RPC may return a single row or a string; normalize:
    if (!data) throw new Error('No code from RPC');
    if (typeof data === 'string') return data;
    if (data.code) return data.code;
    // row object:
    if (Array.isArray(data) && data[0]?.code) return data[0].code;
    // last resort, stringify uid+time:
    throw new Error('Unexpected RPC shape');
  } catch (e) {
    console.warn('RPC create_invite failed, using fallback code:', e.message);
    // Local fallback: still let users share *something* so UX isn’t dead
    const uid = WebApp?.initDataUnsafe?.user?.id ?? 'guest';
    return `t${tier}_${uid}_${Date.now().toString(36)}`;
  }
}

async function handleSend(tier, btn) {
  btn.disabled = true;
  btn.textContent = 'Generating...';
  try {
    const code = await getInviteCode(tier);
    const url = buildInviteLink(code);
    await openShareLink(url);

    // Mark "invited" locally so Claim can turn yellow after friend joins
    state.invited[tier] = true;
    saveLocalState();
    renderTiers();
  } catch (e) {
    console.error(e);
    toast('Could not create link. Try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send link';
  }
}

// “Claim” adds chads to your balance locally *and* pings backend if you wired claim_reward(tier)
async function handleClaim(tier, btn) {
  try {
    // Optional: call your RPC to atomically add balance server-side
    // const { data, error } = await supabase.rpc('claim_reward', { tier });
    // if (error) throw error;
    // const delta = BigInt(data?.new_chads ?? 0);

    // Local update (keeps your existing economy logic consistent with your games):
    const reward = TIERS.find(t=>t.tier===tier).reward;
    state.chads = BigInt(state.chads) + reward;
    state.claimed[tier] = true;
    saveLocalState();

    toast(`+${Number(reward).toLocaleString()} chads added to balance`);
    renderTiers();
  } catch (e) {
    console.error(e);
    toast('Claim failed. Make sure your friend has played.');
  }
}

// Don’t auto-open anything on load.
// Only render after first open to keep things snappy.
