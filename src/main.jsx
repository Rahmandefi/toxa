import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import '@fontsource/ibm-plex-sans/300.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { liveConfigured, explorerTx, CREDITCOIN_TESTNET_ID, SEPOLIA_ID } from './lib/chains.js';
import {
  connectWallet, lockCollateral, startProofJob, pollProofJob, submitProof, fetchAccount, repayLoan,
  quoteLoan, fetchCollateral, unlockCollateral,
} from './lib/live.js';

/* ---------- constants ---------- */
const DEMO_COLLATERAL = 0.01;
const DEMO_ADDRESS = '0x71f9a2b6c4E1d8a03f9c4b1e6a2d9f0c71C34C2A';
const STARTING_SCORE = 700;
const BASE_LTV_BPS = 6000;
const MAX_LTV_BPS = 8000;
const LTV_BPS_PER_POINT = 10;
const REPAY_SCORE_DELTA = 15;
const LOCK_SCORE_DELTA = 5;
const CAP_SCORE = 900;

const CONTRACT = '0x2bF2EC0ebBa8eFc4999460420a86F1F3c1D0b938';
const LOCK_TX = '0x57d916f64337fd26fa6b867b83414dc86a754b78280c00406c0b34ea789a4724';
const EXEC_TX = '0x1087519dc6ee4ea4003e4950b0a38f9e0be72fa2ab90fb2ff8a7430490517088';
const REPAY_TX = '0x880cc66a02fd3887163b5f8affe111309c05be330047d34103cd444dd7d4c302';
const LOCK2_TX = '0x787ce03e577622fde1eef1bc060a0e6c0282ba95f5fac803dd1e0d952ba0474a';
const EXEC2_TX = '0x0d745dc6c8abf8bfba41c04a1aa9731daba731752d042ac6aac81bdef8c4affd';
const PROVEN_BLOCK = 11640288;
const DEMO_WAIT_MS = 2400;

const PIXEL_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});
function CubeLoader({ label = 'Working' }) {
  return (
    <span className="tx-loader" role="status" aria-label={label}>
      <span className="tx-loader-grid" aria-hidden="true">
        {PIXEL_DELAYS.map((delay, i) => (
          <span key={i} className="tx-loader-cell wave" style={{ '--pixel-delay': `${delay}ms` }} />
        ))}
      </span>
    </span>
  );
}

const NAV = [
  ['overview', 'Portfolio'], ['borrow', 'Borrow'], ['score', 'Score'], ['activity', 'Activity'], ['docs', 'Docs'],
];
const TABS = [['overview', 'PORT'], ['borrow', 'BORROW'], ['score', 'SCORE'], ['activity', 'ACTIV'], ['docs', 'DOCS']];

/* demo proof pipeline - an animated walkthrough of the real Attestcoin flow */
const DEMO_PHASES = [
  { step: 0, t: '00:00', log: 'Lock confirmed on Sepolia', meta: `blk ${PROVEN_BLOCK}` },
  { step: 1, t: '00:02', log: 'Waiting for Creditcoin attestors', meta: 'quorum', wait: true },
  { step: 1, t: '00:03', log: 'Attestor quorum 3 of 5 signed', meta: '3 / 5' },
  { step: 1, t: '00:04', log: 'Attestor quorum 5 of 5 signed', meta: '5 / 5' },
  { step: 1, t: '00:05', log: 'Merkle inclusion proof built', meta: 'depth 14' },
  { step: 2, t: '00:06', log: 'Continuity proof over 13 blocks', meta: '288 → 301' },
  { step: 2, t: '00:07', log: 'Submitting to BlockProver 0x0FD2', meta: 'precompile', wait: true },
  { step: 3, t: '00:08', log: 'Verified on Creditcoin', meta: 'exec ok' },
  { step: 3, t: '00:09', log: 'Loan issued · 0.0060 tCTC disbursed', meta: 'settled', done: true },
];

/* ---------- helpers ---------- */
const trunc = (h, lead = 10) => (h ? `${h.slice(0, lead)}…${h.slice(-4)}` : '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ltvBpsFor = (score) => Math.min(MAX_LTV_BPS, BASE_LTV_BPS + Math.max(0, score - STARTING_SCORE) * LTV_BPS_PER_POINT);
const fmtLtv = (bps) => `${(bps / 100).toFixed(1)}%`;
const scorePct = (score) => clamp(((score - STARTING_SCORE) / (CAP_SCORE - STARTING_SCORE)) * 100, 0, 100);
const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const copyText = (v) => { if (v && navigator.clipboard) navigator.clipboard.writeText(v).catch(() => {}); };

function CopyBtn({ value, label = 'copy' }) {
  const [done, setDone] = useState(false);
  return <button className="copy-link" onClick={() => { copyText(value); setDone(true); setTimeout(() => setDone(false), 1200); }}>{done ? 'copied' : label}</button>;
}
function VerifiedChip({ verified, done = 'VERIFIED', pending = 'UNVERIFIED' }) {
  return verified
    ? <span className="chip verified"><Check size={11} />{done}</span>
    : <span className="chip unverified"><span className="gsq" />{pending}</span>;
}

/* ---------- LTV ladder ---------- */
function LtvLadder({ score, variant = 'full' }) {
  const nowPct = scorePct(score);
  const nextScore = Math.min(CAP_SCORE, score + REPAY_SCORE_DELTA);
  const nextPct = scorePct(nextScore);
  const ltvNow = fmtLtv(ltvBpsFor(score));
  const ltvNext = fmtLtv(ltvBpsFor(nextScore));
  const scale = <div className="ladder-scale"><span>700 · 60%</span><span>750 · 65%</span><span>800 · 70%</span><span>850 · 75%</span><span>900 · 80%</span></div>;
  if (variant === 'loan') {
    return (
      <div>
        <div className="ladder-top"><span className="lbl">LTV Ladder</span><span className="ladder-note">cap 80.0%</span></div>
        <div className="ladder-bar"><div className="fill" style={{ width: `${Math.max(1.5, nowPct)}%` }} /><div className="mk" style={{ left: `${nowPct}%` }} /><div className="cap-now" style={{ left: `${nowPct}%` }}>{score} · {ltvNow} THIS LOAN</div></div>
        <div style={{ marginTop: 12 }}>{scale}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="ladder-top"><span className="lbl">LTV Ladder</span><span className="ladder-note">+10 bp per score point · cap 80.0%</span></div>
      <div className="ladder-wrap">
        <div className="ladder-track" />
        <div className="ladder-fill" style={{ width: `${Math.max(1.2, nowPct)}%` }} />
        <div className="ladder-dash" style={{ left: `${nowPct}%`, width: `${Math.max(0, nextPct - nowPct)}%` }} />
        <div className="ladder-marker" style={{ left: `${nowPct}%` }} />
        <div className="ladder-now" style={{ left: `${nowPct}%` }}><b>{score} · {ltvNow} · NOW</b></div>
        {nextScore > score && <div className="ladder-next" style={{ left: `${nextPct}%` }}><b>{nextScore} · {ltvNext} · AFTER NEXT REPAYMENT (+{REPAY_SCORE_DELTA})</b></div>}
        <div className="ladder-cap"><b>900 · 80.0% CAP</b></div>
      </div>
      {scale}
    </div>
  );
}

/* ---------- shared nav ---------- */
function Nav({ active, onTab, onLogo, addr, copied, onCopy, onConnect, connecting }) {
  return (
    <div className="nav">
      <div className="nav-left">
        <button className="brand" onClick={onLogo || (() => onTab('overview'))} aria-label="toxa home"><img className="brand-mark" src="/brand/ticket-bone.svg" width="24" height="24" alt="" /><span className="brand-word">toxa</span></button>
        <nav className="tabs">{NAV.map(([id, label]) => <button key={id} className={'tab' + (active === id ? ' active' : '')} onClick={() => onTab(id)}>{label}</button>)}</nav>
      </div>
      <div className="nav-right">
        {addr
          ? <button className="wallet" onClick={onCopy} aria-label="Copy wallet address"><span className="dot" />{copied ? 'COPIED' : trunc(addr, 6)}<Copy size={14} /></button>
          : <button className="btn bone sm" onClick={onConnect} disabled={connecting}>{connecting ? <CubeLoader label="Connecting" /> : 'Connect wallet'}</button>}
      </div>
    </div>
  );
}
function Rise({ className = '', children }) {
  return <section className={'lsec rise' + (className ? ` ${className}` : '')}>{children}</section>;
}

function Footer() {
  return (
    <footer className="foot">
      <div className="foot-inner">
        <div className="foot-col brand-col">
          <span className="foot-brand">
            <img className="brand-mark" src="/brand/ticket-bone.svg" width="24" height="24" alt="" />
            <span className="brand-word">toxa</span>
          </span>
          <p>Lock once. Borrow better. Score everywhere.</p>
        </div>
        <div className="foot-col">
          <span className="lbl">Proof</span>
          <span className="fitem"><span className="fd" />Merkle + continuity</span>
          <span className="fitem">BlockProver 0x0FD2</span>
          <span className="fitem">Foundry 32/32 passing</span>
        </div>
        <div className="foot-col">
          <span className="lbl">Networks</span>
          <span className="fitem">Sepolia</span>
          <span className="fitem">Creditcoin testnet</span>
          <a className="mlink" href={`https://sepolia.etherscan.io/address/${CONTRACT}`} target="_blank" rel="noreferrer">Contract {trunc(CONTRACT, 6)}</a>
        </div>
        <div className="foot-col">
          <span className="lbl">Build</span>
          <span className="fitem">Attestcoin protocol</span>
          <span className="fitem">BUIDL CTC 2026 Fall</span>
        </div>
      </div>
    </footer>
  );
}

/* ---------- landing ---------- */
function Landing({ navProps, banner, onEnter, onDocs }) {
  const [opening, setOpening] = useState(false);
  const goDesk = () => {
    if (opening) return;
    setOpening(true);
    window.setTimeout(onEnter, DEMO_WAIT_MS);
  };
  return (
    <div className="app"><div className="frame">
      <Nav {...navProps} />
      {banner}
      <main>
        <div className="landing-hero">
          <div className="landing-copy">
            <h1 className="landing-title reveal d1">Lock once. <b>Borrow better.</b> Score everywhere.</h1>
            <p className="landing-sub reveal d2">Lock ETH on Sepolia. Prove it on Creditcoin. The loan is issued because the lock was cryptographically proven, not because an oracle vouched for it.</p>
            <div className="landing-cta reveal d3">
              <button className="btn bone" onClick={goDesk} disabled={opening}>{opening ? <CubeLoader label="Opening" /> : <>Enter the desk <ArrowUpRight className="arrow" size={16} /></>}</button>
              <button className="btn outline" onClick={onDocs}>Read the docs</button>
            </div>
            <div className="landing-stats reveal d4">
              <div className="stat"><b className="num">705</b><span>Credit score</span></div>
              <div className="stat"><b className="num">60.5%</b><span>LTV unlocked</span></div>
              <div className="stat"><b className="num">{PROVEN_BLOCK}</b><span>Proven Sepolia block</span></div>
            </div>
          </div>
          <div className="mechanism">
            <div className="lbl" style={{ marginBottom: 24 }}>The mechanism</div>
            <div className="mech-steps">
              <div className="mech-step"><span className="no">01</span><div><h4>Lock collateral</h4><p>0.0100 ETH escrowed on Ethereum Sepolia.</p></div></div>
              <div className="mech-step"><span className="no">02</span><div><h4>Generate proof</h4><p>Merkle inclusion + continuity proof, built by Creditcoin attestors.</p></div></div>
              <div className="mech-step"><span className="no">03</span><div><h4>Verify on Creditcoin</h4><p>BlockProver precompile <code>0x0FD2</code> checks it on-chain.</p></div></div>
              <div className="mech-step"><span className="no">04</span><div><h4>Loan issued</h4><p>0.0060 tCTC disbursed. No oracle vouched for anything.</p></div></div>
            </div>
            <div className="hero-note">
              <div className="lbl pos">The point</div>
              <p>Every figure on this desk is backed by a proof you can open in a block explorer, not an oracle's word.</p>
            </div>
          </div>
        </div>

        <Rise>
          <div className="lsec-head">
            <div className="lbl pos">What it is</div>
            <h2>Cross-chain credit, issued from a proof instead of trust.</h2>
            <p>Toxa lets you lock collateral on one blockchain and borrow against it on another. The loan is issued only because your lock was cryptographically proven on-chain: no custodian holds your funds, no price oracle vouches for you, no counterparty is trusted.</p>
          </div>
          <div className="pillars">
            <div className="pillar"><div className="pnum">01</div><h3>Cross-chain by proof</h3><p>Lock ETH on Ethereum Sepolia, draw a loan on Creditcoin. A Merkle inclusion plus continuity proof carries the fact between chains.</p></div>
            <div className="pillar"><div className="pnum">02</div><h3>No oracle to trust</h3><p>Creditcoin's BlockProver precompile <code style={{ fontFamily: 'var(--mono)' }}>0x0FD2</code> verifies the proof on-chain. If the math doesn't check out, no loan is issued.</p></div>
            <div className="pillar"><div className="pnum">03</div><h3>A score that compounds</h3><p>Repay and your score rises, unlocking a higher loan-to-value on the next loan. Proven behavior earns better capital terms.</p></div>
          </div>
        </Rise>

        <Rise className="recess">
          <div className="lsec-head">
            <div className="lbl pos">What gets verified</div>
            <h2>Four checks, all enforced on-chain.</h2>
            <p>Every loan is gated by these inside the contract, not asserted by a screen.</p>
          </div>
          <div className="verify-grid">
            <div className="vrow">Merkle inclusion of the lock <span className="tag"><Check size={13} />on-chain</span></div>
            <div className="vrow">Header continuity of the source chain <span className="tag"><Check size={13} />on-chain</span></div>
            <div className="vrow">Attestor quorum signature <span className="tag"><Check size={13} />3 of 5</span></div>
            <div className="vrow no">Price feed from a central oracle <span className="tag"><span className="gsq" />not used</span></div>
          </div>
        </Rise>

        <Rise>
          <div className="lsec-head">
            <div className="lbl pos">The loop</div>
            <h2>Behavior in, better terms out.</h2>
            <p>The score is the product. It starts at 700 and only moves when a proof settles on Creditcoin.</p>
          </div>
          <div className="loop">
            <div className="cell"><b className="num">700</b><span>Starting score for every new address.</span></div>
            <div className="cell"><b className="num g">+5</b><span>Per verified lock, once the proof lands on-chain.</span></div>
            <div className="cell"><b className="num g">+15</b><span>Per loan repaid in full.</span></div>
            <div className="cell"><b className="num">60→80%</b><span>LTV rises 10 bp per point, capped at 80%.</span></div>
          </div>
        </Rise>

        <Rise className="recess">
          <div className="lsec-head">
            <div className="lbl pos">Live on testnet</div>
            <h2>It already settles on-chain.</h2>
          </div>
          <div className="live-grid">
            <div className="row"><span className="k">Contract (both chains)</span><span><a className="mlink" href={`https://sepolia.etherscan.io/address/${CONTRACT}`} target="_blank" rel="noreferrer">{CONTRACT}</a></span><CopyBtn value={CONTRACT} /></div>
            <div className="row"><span className="k">Sepolia lock tx</span><span><a className="mlink" href={explorerTx(SEPOLIA_ID, LOCK_TX)} target="_blank" rel="noreferrer">{trunc(LOCK_TX)}</a> <span className="dim">· etherscan</span></span><CopyBtn value={LOCK_TX} /></div>
            <div className="row"><span className="k">Creditcoin exec tx</span><span><a className="mlink" href={explorerTx(CREDITCOIN_TESTNET_ID, EXEC_TX)} target="_blank" rel="noreferrer">{trunc(EXEC_TX)}</a> <span className="dim">· blockscout</span></span><CopyBtn value={EXEC_TX} /></div>
            <div className="row"><span className="k">Creditcoin repay tx</span><span><a className="mlink" href={explorerTx(CREDITCOIN_TESTNET_ID, REPAY_TX)} target="_blank" rel="noreferrer">{trunc(REPAY_TX)}</a> <span className="dim">· score 705 → 720</span></span><CopyBtn value={REPAY_TX} /></div>
            <div className="row"><span className="k">Second lock tx</span><span><a className="mlink" href={explorerTx(SEPOLIA_ID, LOCK2_TX)} target="_blank" rel="noreferrer">{trunc(LOCK2_TX)}</a> <span className="dim">· etherscan</span></span><CopyBtn value={LOCK2_TX} /></div>
            <div className="row"><span className="k">Loan #2 exec tx</span><span><a className="mlink" href={explorerTx(CREDITCOIN_TESTNET_ID, EXEC2_TX)} target="_blank" rel="noreferrer">{trunc(EXEC2_TX)}</a> <span className="dim">· 0.0062 tCTC at 62%</span></span><CopyBtn value={EXEC2_TX} /></div>
            <div className="row"><span className="k">Proven Sepolia block</span><span>{PROVEN_BLOCK}</span><CopyBtn value={String(PROVEN_BLOCK)} /></div>
          </div>
        </Rise>

        <Rise className="closing">
          <h2>Credit from proof.</h2>
          <p>Lock once. Borrow better. Score everywhere.</p>
          <button className="btn bone" onClick={goDesk} disabled={opening}>{opening ? <CubeLoader label="Opening" /> : <>Enter the desk <ArrowUpRight className="arrow" size={16} /></>}</button>
        </Rise>
      </main>
      <Footer />
    </div></div>
  );
}

/* ---------- app ---------- */
function App() {
  const [entered, setEntered] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search).get('desk') === '1') return true;
      return sessionStorage.getItem('toxa-entered') === '1';
    } catch { return false; }
  });
  const [view, setView] = useState('overview');
  const [mode, setMode] = useState('demo');
  const [account, setAccount] = useState('');
  const [stage, setStage] = useState(0);
  const [loan, setLoan] = useState(false);
  const [score, setScore] = useState(STARTING_SCORE);
  const [copied, setCopied] = useState(false);
  const [amount, setAmount] = useState('0.01');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [noWallet, setNoWallet] = useState(false);
  const [liveAccount, setLiveAccount] = useState(null);
  const [liveCollateral, setLiveCollateral] = useState(null);
  const [liveQuote, setLiveQuote] = useState(null);
  const [activity, setActivity] = useState([]);
  const [lockTx, setLockTx] = useState('');
  const [loanTx, setLoanTx] = useState('');
  const [elapsed, setElapsed] = useState(0);
  // demo pipeline
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoIdx, setDemoIdx] = useState(0);
  const [demoLog, setDemoLog] = useState([]);
  const [demoDone, setDemoDone] = useState(false);

  const live = mode === 'live';
  const displayScore = live ? (liveAccount?.score ?? STARTING_SCORE) : score;
  const displayAddr = account; // real wallet only - no fake address in demo
  const liveProving = live && ((stage > 0 && stage < 3) || busy);
  const proving = view === 'borrow' && (demoRunning || liveProving);

  const enterApp = (nextView) => {
    try { sessionStorage.setItem('toxa-entered', '1'); } catch { /* private mode */ }
    if (nextView) setView(nextView);
    setEntered(true);
  };
  const toLanding = () => {
    try { sessionStorage.removeItem('toxa-entered'); } catch { /* private mode */ }
    setEntered(false);
    resetDemo();
  };

  const refreshLive = async (addr = account) => {
    if (!liveConfigured || !addr) return;
    const [acct, collateral] = await Promise.allSettled([fetchAccount(addr), fetchCollateral(addr)]);
    if (acct.status === 'fulfilled') setLiveAccount(acct.value);
    else setError(acct.reason?.message || String(acct.reason));
    if (collateral.status === 'fulfilled') setLiveCollateral(collateral.value);
  };
  useEffect(() => { if (live && account) refreshLive(account); }, [live, account]);

  useEffect(() => {
    if (!live || !account || !liveConfigured || view !== 'borrow') { setLiveQuote(null); return undefined; }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const quote = await quoteLoan(account, amount || '0');
        if (!cancelled) setLiveQuote(quote);
      } catch { if (!cancelled) setLiveQuote(null); }
    }, 350);
    return () => { cancelled = true; clearTimeout(id); };
  }, [live, account, amount, view]);

  useEffect(() => {
    if (!proving) { setElapsed(0); return undefined; }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [proving]);

  // demo pipeline driver
  useEffect(() => {
    if (!demoRunning) return undefined;
    if (demoIdx >= DEMO_PHASES.length) {
      setLoan(true);
      setScore((s) => Math.min(CAP_SCORE, s + LOCK_SCORE_DELTA));
      setLockTx(LOCK_TX); setLoanTx(EXEC_TX);
      setDemoRunning(false); setDemoDone(true);
      return undefined;
    }
    const ph = DEMO_PHASES[demoIdx];
    const id = setTimeout(() => {
      setStage(ph.step);
      setDemoLog((l) => [...l, ph]);
      setDemoIdx((i) => i + 1);
    }, demoIdx === 0 ? 450 : 900);
    return () => clearTimeout(id);
  }, [demoRunning, demoIdx]);

  const copyAddress = () => { copyText(displayAddr); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  const onConnect = async () => {
    setError(''); setNoWallet(false);
    if (typeof window !== 'undefined' && !window.ethereum) { setNoWallet(true); return null; }
    setConnecting(true);
    try {
      const addr = await connectWallet();
      setAccount(addr);
      setMode('live');
      pushActivity('Wallet connected', trunc(addr, 6));
      return addr; // the live-account read is handled by the [live, account] effect
    } catch (err) { setError(err.message); return null; }
    finally { setConnecting(false); }
  };

  const resetDemo = () => { setDemoRunning(false); setDemoIdx(0); setDemoLog([]); setDemoDone(false); setStage(0); };
  const begin = () => { setView('borrow'); resetDemo(); setError(''); setStatus(''); };
  const startDemoRun = () => { setError(''); setDemoLog([]); setDemoIdx(0); setStage(0); setDemoDone(false); setDemoRunning(true); };

  const pushActivity = (label, detail) => setActivity((r) => [{ id: Date.now(), label, detail, time: 'Just now' }, ...r].slice(0, 8));

  const advanceLive = async () => {
    if (busy) return;
    setError('');
    if (!account) { await onConnect(); return; }
    setBusy(true);
    try {
      if (stage === 0) {
        setStatus('Checking the Creditcoin pool before anything is locked.');
        const quote = await quoteLoan(account, amount).catch(() => null);
        if (quote && !quote.fundable) {
          const reason = Number(quote.pool) < Number(quote.principal)
            ? `The Creditcoin pool holds ${Number(quote.pool).toFixed(4)} tCTC and this lock needs ${Number(quote.principal).toFixed(4)} tCTC. Nothing was locked.`
            : 'You already have a loan outstanding. Repay it before locking more collateral.';
          setStatus(''); setError(reason);
          return;
        }
        setStatus('Switch to Sepolia and confirm the lock transaction.');
        const result = await lockCollateral(account, amount);
        setLockTx(result.hash); pushActivity('Collateral locked', `${amount} ETH · ${trunc(result.hash)}`); setStage(1);
        setStatus('Waiting for Creditcoin attestors, then building the Merkle + continuity proof.');
        const jobId = await startProofJob(result.hash);
        const proof = await pollProofJob(jobId, (s, detail) => setStatus(detail || s));
        setStage(2); setStatus('Proof ready. Switch to Creditcoin Testnet and confirm loan issuance.');
        const issued = await submitProof(account, proof);
        setLoanTx(issued.hash); pushActivity('Proof verified', `Attestcoin execute · ${trunc(issued.hash)}`); setStage(3);
        await refreshLive(account); pushActivity('Loan issued', `${liveAccount?.principal || ''} tCTC`); setStatus('Loan issued on Creditcoin.');
        return;
      }
      if (stage >= 3) { setView('overview'); setStage(0); setStatus(''); }
    } catch (err) { setError(err.message || String(err)); } finally { setBusy(false); }
  };

  // unified borrow action for the primary button
  const borrowAction = () => {
    if (live) { advanceLive(); return; }
    if (demoRunning) return;
    if (demoDone) { setView('overview'); resetDemo(); return; }
    startDemoRun();
  };

  const onUnlock = async () => {
    setError('');
    if (!live || !account) return;
    const locked = Number(liveCollateral?.locked || 0);
    if (locked <= 0) return;
    setBusy(true);
    try {
      const hash = await unlockCollateral(account, liveCollateral.locked);
      pushActivity('Collateral released', `${locked} ETH · ${trunc(hash)}`);
      setStatus('Collateral released on Sepolia.');
      await refreshLive(account);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const onRepay = async () => {
    setError('');
    if (!live) {
      if (!loan) return;
      setScore((s) => Math.min(CAP_SCORE, s + REPAY_SCORE_DELTA));
      setLoan(false); setDemoDone(false);
      return;
    }
    if (!liveAccount || liveAccount.repaid || liveAccount.activeLoanId === '0') return;
    setBusy(true);
    try { await repayLoan(account, liveAccount.activeLoanId, liveAccount.principal); pushActivity('Loan repaid', `loan #${liveAccount.activeLoanId}`); await refreshLive(account); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const setBorrowMode = (m) => { if (m === mode) return; setMode(m); setError(''); setStatus(''); resetDemo(); setLockTx(''); setLoanTx(''); };

  const navProps = {
    active: entered ? view : null,
    onTab: (id) => (entered ? setView(id) : enterApp(id)),
    onLogo: entered ? toLanding : () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    live, onMode: (m) => { setMode(m); setError(''); },
    addr: displayAddr, copied, onCopy: copyAddress,
    onConnect, connecting,
  };

  const walletBanner = noWallet ? (
    <div className="banner info" role="status">
      No wallet detected in this browser. <a className="mlink" href="https://metamask.io/download" target="_blank" rel="noreferrer">Install MetaMask</a>, then connect again to use Toxa on testnet. Demo mode needs no wallet.
      <button className="btn ghost sm" style={{ marginLeft: 12 }} onClick={() => setNoWallet(false)}>Dismiss</button>
    </div>
  ) : null;

  if (!entered) {
    const landingNav = { ...navProps, onConnect: async () => { const addr = await onConnect(); if (addr) enterApp('overview'); } };
    return <Landing navProps={landingNav} banner={walletBanner || (error && <div className="banner error" role="alert">{error}</div>)} onEnter={() => enterApp('overview')} onDocs={() => enterApp('docs')} />;
  }

  return (
    <div className="app"><div className="frame">
      <Nav {...navProps} />
      {walletBanner}
      {error && <div className="banner error" role="alert">{error}</div>}
      {live && !liveConfigured && view !== 'docs' && <div className="banner info">Live contracts not configured. Set <code>VITE_LOCKER_ADDRESS</code> and <code>VITE_TOXASCORE_ADDRESS</code>, or stay in Demo.</div>}

      <main>
        {view === 'overview' && <Overview score={displayScore} loan={live ? Boolean(liveAccount && Number(liveAccount.principal) > 0) : loan} live={live} liveAccount={liveAccount} liveCollateral={liveCollateral} begin={begin} setView={setView} onRepay={onRepay} onUnlock={onUnlock} busy={busy} />}
        {view === 'borrow' && <Borrow live={live} onMode={setBorrowMode} liveConfigured={liveConfigured} liveQuote={liveQuote} amount={amount} setAmount={setAmount} status={status} busy={busy} proving={proving} elapsed={elapsed} lockTx={lockTx} loanTx={loanTx} score={displayScore} stage={stage} demoRunning={demoRunning} demoDone={demoDone} demoLog={demoLog} demoIdx={demoIdx} action={borrowAction} onRepay={onRepay} setView={setView} />}
        {view === 'score' && <ScoreView score={displayScore} live={live} liveAccount={liveAccount} setView={setView} />}
        {view === 'activity' && <ActivityView loan={loan} live={live} activity={activity} score={displayScore} begin={begin} />}
        {view === 'docs' && <Docs />}
      </main>
      <Footer />
      <nav className="bottom-nav">{TABS.map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}</nav>
    </div></div>
  );
}

/* ---------- portfolio ---------- */
function Overview({ score, loan, live, liveAccount, liveCollateral, begin, setView, onRepay, onUnlock, busy }) {
  const ltvBps = live && liveAccount ? liveAccount.ltvBps : ltvBpsFor(score);
  const ltv = fmtLtv(ltvBps);
  const livePosition = live && liveAccount && Number(liveAccount.collateralAmount) > 0;
  const hasPosition = live ? livePosition : loan;
  const collat = livePosition ? Number(liveAccount.collateralAmount) : (live ? 0 : DEMO_COLLATERAL);
  const borrowedNum = live ? Number((liveAccount && !liveAccount.repaid ? liveAccount.principal : 0) || 0) : (loan ? DEMO_COLLATERAL * (BASE_LTV_BPS / 10_000) : 0);
  const availableNum = Math.max(0, collat * (ltvBps / 10_000) - borrowedNum);
  const canRepay = live ? (liveAccount && !liveAccount.repaid && Number(liveAccount.principal) > 0) : loan;
  const delta = score - STARTING_SCORE;
  const statusLabel = live ? (liveAccount?.repaid ? 'REPAID' : (borrowedNum > 0 ? 'OPEN' : 'LOCKED')) : (loan ? 'OPEN' : 'LOCKED');
  const lockedEth = Number(liveCollateral?.locked || 0);
  const canRelease = live && lockedEth > 0 && !canRepay;

  return (
    <div className="pf">
      <div className="pf-main">
        <div className="pf-score">
          <div>
            <div className="lbl">Credit score</div>
            <div className="score-den"><span className="score-big num">{score}</span><span className="den">/ 850</span></div>
            <div style={{ marginTop: 16 }}>{delta > 0 ? <span className="chip verified"><Check size={11} />+{delta} VERIFIED</span> : <span className="chip queued"><span className="gsq" />{live ? 'LIVE · NO PROOFS YET' : 'UNVERIFIED · DEMO'}</span>}</div>
          </div>
          <div className="score-metrics">
            <div className="m"><div className="lbl">LTV</div><div className="mv num">{ltv}</div></div>
            <div className="m"><div className="lbl">Borrowed</div><div className="mv num">{borrowedNum.toFixed(4)} <small>tCTC</small></div></div>
            <div className="m avail"><div className="lbl">Available</div><div className="mv num">{availableNum.toFixed(4)} <small>tCTC</small></div></div>
          </div>
        </div>
        <div className="sec"><LtvLadder score={score} /></div>
        <div className="sec" style={{ borderBottom: 0 }}>
          <div className="lbl">Active positions · {hasPosition ? 1 : 0}</div>
          {hasPosition ? (
            <div className="scroll-x">
              <div className="tbl-head pos-cols"><span>Asset / chain</span><span>Amount</span><span>LTV</span><span>Status</span><span>Proof</span></div>
              <div className="tbl-row pos-cols">
                <div><div className="asset-name">ETH</div><div className="asset-chain">Ethereum Sepolia</div></div>
                <div className="cell-num">{collat.toFixed(4)} ETH</div>
                <div className="cell-num">{ltv}</div>
                <div className="cell-status"><i />{statusLabel}</div>
                <div className="cell-proof"><VerifiedChip verified={hasPosition} /><div className="sub">blk {PROVEN_BLOCK} · <a className="mlink" href={explorerTx(SEPOLIA_ID, LOCK_TX)} target="_blank" rel="noreferrer">{trunc(LOCK_TX)}</a></div></div>
              </div>
            </div>
          ) : (
            <div className="firstrun">
              <div className="lbl pos">Get started</div>
              <h3>Originate your first proven loan.</h3>
              <p>Lock ETH on Sepolia, watch the Attestcoin proof pipeline verify it on Creditcoin, and draw a loan sized by your score. About nine seconds in demo.</p>
              <button className="btn bone" onClick={begin}>Lock collateral &amp; prove <ArrowUpRight className="arrow" size={16} /></button>
            </div>
          )}
        </div>
      </div>
      <div className="pf-side">
        <button className="btn bone block" onClick={begin}>New loan <ArrowUpRight className="arrow" size={16} /></button>
        <button className="btn outline block" onClick={onRepay} disabled={!canRepay || busy}>{busy ? <CubeLoader label="Repaying" /> : (canRepay ? `Repay ${(live ? Number(liveAccount.principal) : borrowedNum).toFixed(4)} tCTC` : 'Repay')}</button>
        <div className="card hover" style={{ marginTop: 14 }}>
          <div className="lbl">Proof receipt{live && !hasPosition ? ' · reference' : ''}</div>
          <div className="kv">
            <div className="kv-row"><span className="k">CHAIN</span><span>Sepolia · key 1</span></div>
            <div className="kv-row"><span className="k">PROVEN BLOCK</span><span>{PROVEN_BLOCK}</span></div>
            <div className="kv-row"><span className="k">CONTINUITY</span><span className={hasPosition ? 'pos' : 'dim'}>{hasPosition ? '✓ READY' : '☐ PENDING'}</span></div>
            <div className="kv-row"><span className="k">VERIFIER</span><span>0x0FD2</span></div>
            <div className="kv-row"><span className="k">LOCK TX</span><span><a className="mlink" href={explorerTx(SEPOLIA_ID, LOCK_TX)} target="_blank" rel="noreferrer">{trunc(LOCK_TX)}</a><CopyBtn value={LOCK_TX} /></span></div>
            <div className="kv-row"><span className="k">EXEC TX</span><span><a className="mlink" href={explorerTx(CREDITCOIN_TESTNET_ID, EXEC_TX)} target="_blank" rel="noreferrer">{trunc(EXEC_TX)}</a><CopyBtn value={EXEC_TX} /></span></div>
          </div>
          {live && !hasPosition && <p className="note" style={{ marginTop: 12 }}>Loan #1 on testnet, shown for reference. Your own receipt lands here after your first proven lock.</p>}
        </div>
        {live && (
          <div className="card hover" style={{ marginTop: 14 }}>
            <div className="lbl">Collateral escrow</div>
            <div className="kv">
              <div className="kv-row"><span className="k">LOCKED</span><span>{lockedEth.toFixed(4)} ETH</span></div>
              <div className="kv-row"><span className="k">RELEASE</span><span className={canRelease ? 'pos' : 'dim'}>{canRelease ? '✓ VOUCHER READY' : (canRepay ? '☐ LOAN OPEN' : '☐ NOTHING LOCKED')}</span></div>
            </div>
            <button className="btn outline block sm" style={{ marginTop: 12 }} onClick={onUnlock} disabled={!canRelease || busy}>
              {busy ? <CubeLoader label="Releasing" /> : (canRelease ? `Release ${lockedEth.toFixed(4)} ETH` : 'Release collateral')}
            </button>
            <p className="note">The relayer signs a release only once Creditcoin shows nothing outstanding. If it ever goes quiet, <code>emergencyUnlock</code> returns your ETH 30 days after the lock.</p>
          </div>
        )}
        <div className="card hover"><div className="lbl">Next unlock</div><p className="note">One repayment adds +{REPAY_SCORE_DELTA} points and 1.5 points of LTV. Proven behavior earns better terms.</p><button className="btn ghost block sm" style={{ marginTop: 14 }} onClick={() => setView('score')}>Score detail <ArrowUpRight className="arrow" size={14} /></button></div>
      </div>
    </div>
  );
}

/* ---------- borrow / origination ---------- */
function Borrow({ live, onMode, liveConfigured, liveQuote, amount, setAmount, status, busy, proving, elapsed, lockTx, loanTx, score, stage, demoRunning, demoDone, demoLog, demoIdx, action, onRepay, setView }) {
  const ltvNow = fmtLtv(ltvBpsFor(score));
  const est = live ? '8-15 MIN' : '~9s DEMO';
  const approx = ((Number(amount) || 0) * ltvBpsFor(score) / 10_000).toFixed(4);
  const done = demoDone || stage >= 3;
  const steps = [
    { title: 'Lock collateral', desc: <>{amount || '0'} ETH · Sepolia{lockTx ? <><br />blk {PROVEN_BLOCK} · <a className="mlink" href={explorerTx(SEPOLIA_ID, lockTx)} target="_blank" rel="noreferrer">{trunc(lockTx)}</a></> : ''}</> },
    { title: 'Generate proof', desc: <>Merkle + continuity<br />attestor quorum · @gluwa/usc-sdk</> },
    { title: 'Verify on Creditcoin', desc: <>BlockProver 0x0FD2<br />on-chain verification</> },
    { title: 'Loan issued', desc: <>{approx} tCTC<br />at {ltvNow} LTV</> },
  ];
  const stepClass = (i) => (done ? 'done' : i < stage ? 'done' : i === stage ? (proving ? 'working' : 'working') : 'queued');
  const stepChip = (i) => {
    const c = stepClass(i);
    if (c === 'done') return <span className="chip done"><Check size={11} />DONE</span>;
    if (c === 'working') return <span className="chip working"><span className={'gsq' + (proving ? ' pulse' : '')} />{proving ? fmtClock(elapsed) : 'READY'}</span>;
    return <span className="chip queued">QUEUED</span>;
  };
  const barWidth = demoRunning ? Math.round((demoIdx / DEMO_PHASES.length) * 100) : done ? 100 : [8, 40, 75, 100][stage] || 8;
  const label = busy ? `Proving… ${fmtClock(elapsed)}`
    : demoRunning ? `Proving… ${fmtClock(elapsed)}`
      : done ? 'View portfolio'
        : live ? (stage === 0 ? 'Lock collateral on Sepolia' : stage < 3 ? 'Proving…' : 'Back to portfolio') : 'Lock collateral & prove';
  const disabled = busy || demoRunning || (live && stage > 0 && stage < 3);

  return (
    <div>
      <div className="pipeline-wrap">
        <div className="lbl">Origination pipeline</div>
        <div className="pipeline">
          {steps.map((s, i) => <div className={'pstep ' + stepClass(i)} key={s.title}><div className="top"><span className="sno">STEP 0{i + 1}</span>{stepChip(i)}</div><h4>{s.title}</h4><div className="sd">{s.desc}</div></div>)}
        </div>
      </div>

      <div className="borrow-grid">
        <div className="borrow-main">
          {proving ? (
            <div className="prove">
              <div className="prove-head"><div className="st"><i className="pulse" />PROVING · STEP 0{Math.min(stage + 1, 4)} OF 04</div><div className="el">ELAPSED {fmtClock(elapsed)} · EST {est}</div></div>
              <div className="prove-bar"><span style={{ width: `${barWidth}%` }} /></div>
              <div className="prove-log">
                {(live ? [] : demoLog).map((ph, i) => <div className={'log-row' + (ph.wait ? ' wait' : '')} key={i}><span className="t">{ph.wait ? '·' : '✓'} {ph.t}</span><span>{ph.log}</span><span className="meta">{ph.meta}</span></div>)}
                {live && status && <div className="log-row"><span className="t">· {fmtClock(elapsed)}</span><span>{status}</span><span className="meta">live</span></div>}
                {live && !status && <div className="log-row wait"><span className="t">·</span><span>Running the Attestcoin proof pipeline…</span><span className="meta">live</span></div>}
              </div>
              <div className="prove-foot">You can leave this page. The proof continues on the attestor set and the loan settles on Creditcoin without further signatures.</div>
            </div>
          ) : done ? (
            <div className="resting success">
              <div className="stamp"><Check size={14} />LOAN ISSUED · VERIFIED ON-CHAIN</div>
              <h3 style={{ margin: '14px 0 0', font: '300 30px/1.15 var(--sans)', letterSpacing: '-0.02em' }}>{approx} tCTC disbursed on Creditcoin.</h3>
              <p className="note">The proof verified via BlockProver 0x0FD2 and your score rose +{LOCK_SCORE_DELTA}. Repay to add +{REPAY_SCORE_DELTA} more and unlock a higher LTV on the next loan.</p>
              <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
                <button className="btn bone" onClick={() => setView('overview')}>View portfolio <ArrowUpRight className="arrow" size={16} /></button>
                <button className="btn outline" onClick={onRepay}>Repay {approx} tCTC</button>
              </div>
            </div>
          ) : (
            <div className="resting">
              <div className="lbl">Ready to originate</div>
              <h3 style={{ margin: '14px 0 0', font: '300 28px/1.2 var(--sans)', letterSpacing: '-0.02em' }}>Lock ETH. Prove it. Borrow against the proof.</h3>
              <p className="note">Attestcoin builds a Merkle + continuity proof of your Sepolia lock, BlockProver 0x0FD2 verifies it on Creditcoin, and the loan is sized at {ltvNow} LTV from your score. {live ? 'Live proving takes 8-15 minutes and needs a wallet.' : 'Press the button to watch the full pipeline run.'}</p>
            </div>
          )}
          <div className="card" style={{ padding: 32 }}><LtvLadder score={score} variant="loan" /></div>
        </div>

        <div className="borrow-side">
          <div className="card" style={{ padding: 24 }}>
            <div className="modeswitch">
              <span className="lbl">Mode</span>
              <div className="toggle small" role="tablist" aria-label="Demo or live testnet">
                <button className={!live ? 'demo-on' : ''} aria-pressed={!live} onClick={() => onMode('demo')} disabled={proving}>DEMO</button>
                <button className={live ? 'live-on' : ''} aria-pressed={live} onClick={() => onMode('live')} disabled={proving}>LIVE TESTNET</button>
              </div>
            </div>
            <div className="modehint">{live ? 'Real Sepolia + Creditcoin · needs a wallet · 8-15 min' : 'Simulated walkthrough · no wallet · ~9s'}</div>
            {live && !liveConfigured && <div className="modehint" style={{ color: 'var(--rust-text)' }}>Live contracts not set in .env - connect will still prompt, but issuance needs deployed addresses.</div>}
            {live && liveQuote && (
              <div className="modehint" style={liveQuote.fundable ? undefined : { color: 'var(--rust-text)' }}>
                {liveQuote.fundable
                  ? `draws ≈ ${Number(liveQuote.principal).toFixed(4)} tCTC · pool holds ${Number(liveQuote.pool).toFixed(4)} tCTC`
                  : `pool holds ${Number(liveQuote.pool).toFixed(4)} tCTC, this lock needs ${Number(liveQuote.principal).toFixed(4)} tCTC`}
              </div>
            )}
            <div className="lbl" style={{ marginTop: 20 }}>Collateral</div>
            <div className="amount">
              <input type="number" min="0.001" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={proving || done} aria-label="Collateral amount in ETH" />
              <div className="unit"><span>ETH</span><button className="maxbtn" onClick={() => setAmount(String(DEMO_COLLATERAL))} disabled={proving || done}>MAX</button></div>
            </div>
            <div className="amount-help"><span>MAX {DEMO_COLLATERAL.toFixed(4)}</span><span>≈ {approx} tCTC AT {ltvNow} LTV</span></div>
            <div className="readout">
              <div className="kv-row"><span className="k">CHAIN</span><span>Sepolia</span></div>
              <div className="kv-row"><span className="k">CHAIN KEY</span><span>1</span></div>
              <div className="kv-row"><span className="k">CONTINUITY</span><span className={stage > 1 || done ? 'pos' : 'dim'}>{stage > 1 || done ? '✓ READY' : '☐ PENDING'}</span></div>
              <div className="kv-row"><span className="k">TIMING</span><span>{est}</span></div>
              <div className="kv-row"><span className="k">CONTRACT</span><a className="mlink" href={explorerTx(CREDITCOIN_TESTNET_ID, EXEC_TX)} target="_blank" rel="noreferrer">{trunc(CONTRACT)}</a></div>
            </div>
            <button className={'btn block ' + (disabled ? 'working' : 'bone')} style={{ marginTop: 22 }} onClick={action} disabled={disabled}>{(busy || demoRunning) ? <CubeLoader label="Proving" /> : <>{label}{!disabled && <ArrowUpRight className="arrow" size={16} />}</>}</button>
            {disabled && <div className="disabled-note">Proof pipeline running · do not close</div>}
          </div>
          <div className="card" style={{ padding: 24 }}>
            <div className="lbl">Transactions</div>
            <div className="kv">
              <div className="kv-row"><span className="k">ETHERSCAN</span><span>{lockTx ? <><a className="mlink" href={explorerTx(SEPOLIA_ID, lockTx)} target="_blank" rel="noreferrer">{trunc(lockTx)}</a><CopyBtn value={lockTx} /></> : <span className="dim">awaiting lock tx</span>}</span></div>
              <div className="kv-row"><span className="k">BLOCKSCOUT</span><span>{loanTx ? <><a className="mlink" href={explorerTx(CREDITCOIN_TESTNET_ID, loanTx)} target="_blank" rel="noreferrer">{trunc(loanTx)}</a><CopyBtn value={loanTx} /></> : <span className="dim">awaiting exec tx</span>}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- score ---------- */
function ScoreView({ score, live, liveAccount, setView }) {
  const ltvNow = fmtLtv(live && liveAccount ? liveAccount.ltvBps : ltvBpsFor(score));
  const delta = score - STARTING_SCORE;
  const factors = [['Repayment history', 40], ['Collateral quality', 25], ['Credit age', 20], ['Utilization', 15]];
  return (
    <div className="score-page">
      <div className="score-mech">
        <div className="lbl">Score mechanics</div>
        <h2>Every point is earned by a proof that settled on-chain.</h2>
        <div className="mech-list">
          <div className="row"><b>700</b><p>Starting score for every new address.</p></div>
          <div className="row"><b className="g">+5</b><p>Per verified lock. Only counted once the proof verifies on Creditcoin.</p></div>
          <div className="row"><b className="g">+15</b><p>Per repayment in full.</p></div>
          <div className="row"><b>60.0%</b><p>Base LTV at score 700.</p></div>
          <div className="row"><b>+10 bp</b><p>Per score point, capped at 80.0%.</p></div>
          <div className="row"><b>80.0%</b><p>Hard cap. No score raises LTV beyond it.</p></div>
        </div>
      </div>
      <div className="score-side">
        <div className="score-current"><div><div className="lbl">Current</div><div className="den"><span className="big num">{score}</span><span className="d">/ 850</span></div></div><div className="score-breakdown">700 base<br />{delta > 0 ? `+${delta} verified activity` : 'no verified activity yet'}</div></div>
        <div><div className="lbl">Scoring factors</div><div className="factors">{factors.map(([name, w]) => <div className="factor" key={name}><div className="fh"><span>{name}</span><span>{w}%</span></div><div className="bar"><span style={{ width: `${w}%` }} /></div></div>)}</div></div>
        <div className="card" style={{ padding: 22 }}>
          <div className="lbl">Score history</div>
          <div className="score-hist">{delta > 0 && <div className="row"><span className="d">Verified activity on record</span><span className="delta">+{delta}</span><span>{score}</span></div>}<div className="row"><span className="d">Account opened</span><span className="delta zero">-</span><span>700</span></div></div>
        </div>
        <button className="btn bone" onClick={() => setView('borrow')}>Start a new loan · {ltvNow} LTV <ArrowUpRight className="arrow" size={16} /></button>
      </div>
    </div>
  );
}

/* ---------- activity ---------- */
function ActivityView({ loan, live, activity, score, begin }) {
  const [filter, setFilter] = useState('all');
  const delta = score - STARTING_SCORE;
  const hasActivity = loan || delta > 0;
  const demoRows = hasActivity ? [
    { id: 'a1', cat: 'score', name: 'Score updated', detail: `700 → ${score} · LTV 60.0 → ${fmtLtv(ltvBpsFor(score))}`, time: '2026-09-05 14:22:08', verified: true, tx: EXEC_TX, chain: CREDITCOIN_TESTNET_ID },
    { id: 'a2', cat: 'loan', name: 'Loan issued', detail: `${(DEMO_COLLATERAL * BASE_LTV_BPS / 10_000).toFixed(4)} tCTC on Creditcoin`, time: '2026-09-05 14:22:02', verified: true, tx: EXEC_TX, chain: CREDITCOIN_TESTNET_ID },
    { id: 'a3', cat: 'proof', name: 'Proof generated', detail: 'Merkle depth 14 + continuity 13 blk · 0x0FD2', time: '2026-09-05 14:13:41', verified: true, tx: '' },
    { id: 'a4', cat: 'lock', name: 'Collateral locked', detail: `${DEMO_COLLATERAL.toFixed(4)} ETH · Sepolia blk ${PROVEN_BLOCK}`, time: '2026-09-05 14:05:19', verified: true, tx: LOCK_TX, chain: SEPOLIA_ID },
    { id: 'a5', cat: 'lock', name: 'Lock submitted', detail: 'Awaiting 12 confirmations · 4 of 12', time: '2026-09-05 14:04:52', verified: false, tx: LOCK_TX, chain: SEPOLIA_ID, pending: true },
  ] : [];
  const liveRows = activity.map((a) => ({ id: a.id, name: a.label, detail: a.detail, time: a.time, verified: true, cat: /repaid|loan/i.test(a.label) ? 'loan' : /proof|verified/i.test(a.label) ? 'proof' : 'lock', tx: '' }));
  const rows = live ? liveRows : demoRows;
  const shown = rows.filter((r) => filter === 'all' || r.cat === filter);
  const proofs = rows.filter((r) => r.verified).length;
  return (
    <div>
      <div className="act-head">
        <div><div className="lbl">Verified event ledger</div><div className="count">{rows.length} events, {proofs} proofs</div></div>
        <div className="filters">{[['all', 'ALL'], ['lock', 'LOCKS'], ['proof', 'PROOFS'], ['loan', 'LOANS']].map(([id, l]) => <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{l}</button>)}</div>
      </div>
      {shown.length > 0 ? (
        <div className="ledger-wrap"><div className="scroll-x">
          <div className="tbl-head ledger-cols"><span>Event</span><span>Detail</span><span>Timestamp</span><span>Proof</span><span>TX</span></div>
          {shown.map((r) => (
            <div className={'tbl-row ledger-cols ledger-row' + (r.pending ? ' pending' : '')} key={r.id}>
              <span className="ev-name">{r.name}</span><span className="ev-detail">{r.detail}</span><span className="ev-time">{r.time}</span>
              <span><VerifiedChip verified={r.verified} /></span>
              <span className="ev-tx">{r.tx ? <a className="mlink" href={explorerTx(r.chain, r.tx)} target="_blank" rel="noreferrer">{trunc(r.tx)}</a> : <span className="dim">precompile call</span>}</span>
            </div>
          ))}
        </div></div>
      ) : (
        <div className="empty"><div className="lbl">No verified events yet</div><div className="mk" /><h3>Lock collateral to write your first proof</h3><p>Every row here is backed by a transaction you can open in an explorer.</p><button className="btn bone" onClick={begin}>Lock collateral <ArrowUpRight className="arrow" size={16} /></button></div>
      )}
    </div>
  );
}

/* ---------- docs ---------- */
function Docs() {
  return (
    <div className="docs">
      <div className="docs-grid">
        <div className="doc-cell"><div className="h">How it works</div><p>Lock ETH on Ethereum Sepolia. A proof pipeline builds a Merkle inclusion proof plus a continuity proof. A contract on Creditcoin verifies that proof on-chain, then disburses a loan sized by your credit score. Repaying raises the score, and a higher score unlocks a better LTV on the next loan.</p></div>
        <div className="doc-cell"><div className="h">What is verified</div><div className="doc-kv">
          <div className="row"><span className="k">Merkle inclusion of the lock</span><span className="pos">✓ on-chain</span></div>
          <div className="row"><span className="k">Header continuity of the chain</span><span className="pos">✓ on-chain</span></div>
          <div className="row"><span className="k">Attestor quorum signature</span><span className="pos">✓ 3 of 5</span></div>
          <div className="row"><span className="k">Price feed from a central oracle</span><span className="no">☐ not used</span></div>
        </div></div>
        <div className="doc-cell"><div className="h">Score mechanics</div><div className="doc-kv">
          <div className="row"><span className="k">Start</span><span>700</span></div>
          <div className="row"><span className="k">Verified lock</span><span>+5</span></div>
          <div className="row"><span className="k">Repayment</span><span>+15</span></div>
          <div className="row"><span className="k">LTV</span><span>60% + 10 bp / pt, cap 80%</span></div>
        </div></div>
        <div className="doc-cell"><div className="h">Live setup</div><div className="doc-kv">
          <div className="row"><span className="k">Collateral chain</span><span>Ethereum Sepolia · key 1</span></div>
          <div className="row"><span className="k">Credit chain</span><span>Creditcoin testnet</span></div>
          <div className="row"><span className="k">Verifier</span><span>BlockProver 0x0FD2</span></div>
          <div className="row"><span className="k">Proving time</span><span>8-15 min</span></div>
        </div></div>
        <div className="doc-cell span"><div className="h row"><i />Live proofs</div><div className="proofs">
          <span className="k">CONTRACT (BOTH CHAINS)</span><span><a className="mlink" href={`https://sepolia.etherscan.io/address/${CONTRACT}`} target="_blank" rel="noreferrer">{CONTRACT}</a></span><span><CopyBtn value={CONTRACT} /></span>
          <span className="k">SEPOLIA LOCK TX</span><span><a className="mlink" href={explorerTx(SEPOLIA_ID, LOCK_TX)} target="_blank" rel="noreferrer">{trunc(LOCK_TX)}</a> <span className="dim">· etherscan</span></span><span><CopyBtn value={LOCK_TX} /></span>
          <span className="k">CREDITCOIN EXEC TX</span><span><a className="mlink" href={explorerTx(CREDITCOIN_TESTNET_ID, EXEC_TX)} target="_blank" rel="noreferrer">{trunc(EXEC_TX)}</a> <span className="dim">· blockscout</span></span><span><CopyBtn value={EXEC_TX} /></span>
          <span className="k">PROVEN BLOCK</span><span>{PROVEN_BLOCK}</span><span><CopyBtn value={String(PROVEN_BLOCK)} /></span>
        </div></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
