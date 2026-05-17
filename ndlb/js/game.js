// ============================================================
// 脑洞量表 Top Ten Online — Game Logic
// ============================================================

// ---- Utilities ----
const genCode = () => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 4; i++) s += c[Math.random() * c.length | 0];
  return s;
};
const shuffle = a => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.random() * (i+1) | 0; [b[i],b[j]] = [b[j],b[i]]; }
  return b;
};
const toast = (msg, dur=2500) => {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), dur);
};
const showConn = (txt='正在连接...') => {
  document.getElementById('connecting-text').textContent = txt;
  document.getElementById('connecting-overlay').classList.remove('hidden');
  ['conn-step1','conn-step2','conn-step3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.className = 'step'; el.querySelector('.step-icon').textContent = '⏳'; }
  });
};
const hideConn = () => document.getElementById('connecting-overlay').classList.add('hidden');

// ---- Game State ----
const GS = {
  roomCode: '', players: [], round: 1, captainIndex: 0,
  topic: { text: '', low: '', high: '' },
  unicorns: 0, poops: 0, totalUnicorns: 0,
  phase: 'lobby', flippedCards: [], revealedCards: [], flipVersion: 0,
  isHost: false, myId: '', myName: '', myNumber: null,
};

// ---- Helpers ----
function myPlayer() { return GS.players.find(p => p.id === GS.myId); }
function amCaptain() { return GS.players[GS.captainIndex]?.id === GS.myId; }

function switchScreen(n) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const target = document.getElementById(n + '-screen');
  if (target) {
    target.classList.add('active');
    target.style.display = 'block';
  }
}

function backToLobby() {
  stopHeartbeat();
  if (peer) { peer.destroy(); peer = null; }
  Object.keys(conns).forEach(k => delete conns[k]);
  GS.roomCode=''; GS.players=[]; GS.phase='lobby'; GS.myNumber=null; GS.flippedCards=[]; GS.revealedCards=[];
  switchScreen('lobby');
  document.getElementById('status-bar').style.display='none';
  document.getElementById('waiting-room').classList.add('hidden');
  document.getElementById('joined-waiting').classList.add('hidden');
  document.getElementById('create-form').classList.add('hidden');
  document.getElementById('join-form').classList.add('hidden');
  document.getElementById('lobby-screen').querySelector('.lobby-actions').style.display='flex';
}

// ---- Lobby UI ----
function showCreateRoom() { document.getElementById('create-form').classList.remove('hidden'); document.getElementById('join-form').classList.add('hidden'); }
function showJoinRoom() { document.getElementById('join-form').classList.remove('hidden'); document.getElementById('create-form').classList.add('hidden'); }
function hideForms() { document.getElementById('create-form').classList.add('hidden'); document.getElementById('join-form').classList.add('hidden'); }

async function doCreateRoom(attemptCount, relayOnly) {
  const name = document.getElementById('host-name').value.trim();
  if (!name) { toast('请输入昵称'); return; }
  const code = genCode();
  GS.roomCode = code; GS.isHost = true; GS.myName = name;
  attemptCount = attemptCount || 1;
  relayOnly = relayOnly || false;
  const modeLabel = relayOnly ? ' [中继模式]' : '';
  showConn(attemptCount === 1 ? `正在创建房间...${modeLabel}` : `正在创建房间... (第${attemptCount}次)${modeLabel}`);
  updateConnProgress('step1');
  iceDiagLog = [];
  try {
    await initHost(code, relayOnly);
    GS.myId = hostPeerId(code);
    GS.players = [{ id: GS.myId, name, number: null, peeked: false, isHost: true }];
    document.getElementById('room-code-display').textContent = code;
    updateWaitingRoom();
    document.getElementById('create-form').classList.add('hidden');
    document.getElementById('waiting-room').classList.remove('hidden');
    hideConn(); toast('房间创建成功！');
  } catch (e) {
    hideConn(); stopHeartbeat();
    if (peer) { try { peer.destroy(); } catch(_){} peer = null; }
    const errInfo = e?.title ? e : classifyError('peer_error', e);
    if (attemptCount < 3 && e?.source !== 'unavailable-id') {
      const delay = attemptCount * 2000;
      toast(`创建失败，${delay/1000}秒后重试...`);
      setTimeout(() => doCreateRoom(attemptCount+1, attemptCount>=2), delay);
    } else {
      showErrorModal({ title: '❌ 创建房间失败', reason: errInfo.reason||String(e),
        solutions: ['PeerJS 云服务可能暂时不可用', '检查网络连接', '公司/校园网可能屏蔽WebSocket，尝试手机热点', '刷新页面重试'] });
    }
  }
}

async function doJoinRoom(attemptCount, relayOnly) {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const name = document.getElementById('join-name').value.trim();
  document.getElementById('join-error').classList.add('hidden');
  if (code.length < 4) { toast('请输入4位房间码'); return; }
  if (!name) { toast('请输入昵称'); return; }
  GS.isHost = false; GS.myName = name;
  attemptCount = attemptCount || 1;
  relayOnly = relayOnly || false;
  if (attemptCount >= 4 && !relayOnly) { relayOnly = true; logICE('Auto-switch to RELAY'); }
  const modeLabel = relayOnly ? ' [中继模式]' : '';
  showConn(attemptCount === 1 ? `正在连接房间...${modeLabel}` : `正在连接房间... (第${attemptCount}次)${modeLabel}`);
  iceDiagLog = [];
  document.getElementById('join-code').dataset.lastCode = code;
  document.getElementById('join-name').dataset.lastName = name;
  try {
    await initClient(code, relayOnly);
    sendHost({ type: 'join', name });
  } catch (e) {
    hideConn();
    if (peer) { try { peer.destroy(); } catch(_){} peer = null; }
    stopHeartbeat();
    const errInfo = e?.title ? e : classifyError('peer_error', e, relayOnly);
    if (attemptCount < 6) {
      const delay = Math.min(attemptCount, 3) * 2000;
      const nextRelay = attemptCount >= 3;
      const hint = nextRelay && !relayOnly ? '，将切换中继模式' : '';
      toast(`连接失败，${delay/1000}秒后重试${hint}...`);
      setTimeout(() => doJoinRoom(attemptCount+1, nextRelay), delay);
    } else { showErrorModal(errInfo); }
  }
}

function updateWaitingRoom() {
  const list = document.getElementById('waiting-player-list');
  list.innerHTML = GS.players.map(p => {
    let actions = '';
    if (p.isHost) actions = '<span class="host-tag">房主</span>';
    else actions = `<button class="kick-btn" onclick="kickPlayer('${p.id}')">踢出</button>`;
    return `<li><span class="avatar">${p.name[0]}</span>${p.name}${actions}</li>`;
  }).join('');
  const btn = document.getElementById('start-game-btn');
  btn.disabled = GS.players.length < 4;
  btn.textContent = GS.players.length >= 4
    ? `开始游戏 (${GS.players.length}人)`
    : `至少4人才能开始 (当前${GS.players.length}人)`;
}

function updateJoinedList(players) {
  const list = document.getElementById('joined-player-list');
  list.innerHTML = players.map(p =>
    `<li><span class="avatar">${p.name[0]}</span>${p.name}${p.isHost ? '<span class="host-tag">房主</span>' : ''}</li>`
  ).join('');
}

// ---- Start Game ----
function doStartGame() {
  if (GS.players.length < 4) return;
  GS.round = 1; GS.captainIndex = 0;
  GS.unicorns = GS.players.length; GS.totalUnicorns = GS.unicorns; GS.poops = 0;
  GS.phase = 'topic';
  broadcast({
    type: 'game_start',
    players: GS.players.map(p => ({ ...p, number: null, peeked: false })),
    round: GS.round, captainIndex: GS.captainIndex,
    unicorns: GS.unicorns, poops: GS.poops, totalUnicorns: GS.totalUnicorns,
    phase: 'topic', topic: GS.topic
  });
  enterGame();
}

function enterGame() {
  switchScreen('game');
  document.getElementById('status-bar').style.display = 'block';
  updateBar(); updateSidebar(); renderGame();
}

// ---- Status Bar ----
function updateBar() {
  const dots = document.getElementById('round-dots');
  dots.innerHTML = `<div class="round-dot current" style="width:auto;padding:0 8px;font-size:12px">R${GS.round}</div>`;
  document.getElementById('uc').textContent = GS.unicorns;
  document.getElementById('pc').textContent = GS.poops;
  document.getElementById('game-room-code').textContent = GS.roomCode;
  document.getElementById('captain-name').textContent = GS.players[GS.captainIndex]?.name || '';
  updateSidebar();
}

// ---- Player Sidebar ----
function updateSidebar() {
  const list = document.getElementById('sidebar-player-list');
  if (!list) return;
  list.innerHTML = GS.players.map((p, i) => {
    const isMe = p.id === GS.myId;
    const isCaptain = i === GS.captainIndex;
    let roleText = '';
    if (isCaptain) roleText = '🎯 出题者';
    else if (p.isHost) roleText = '👑 房主';
    
    return `<div class="sidebar-player ${isCaptain ? 'current-captain' : ''} ${isMe ? 'me' : ''}">
      <span class="avatar sidebar-avatar">${p.name[0]}</span>
      <div class="sidebar-info">
        <div class="sidebar-name">${p.name}${isMe ? '（你）' : ''}</div>
        <div class="sidebar-role">${roleText || '玩家'}</div>
      </div>
      <span class="sidebar-status-dot ${isCaptain ? 'captain' : 'online'}"></span>
    </div>`;
  }).join('');
}

// ---- Phase Transitions ----
function goPhase(phase) {
  GS.phase = phase;
  if (phase === 'peek') {
    const nonCaptainPlayers = GS.players.filter((_, i) => i !== GS.captainIndex);
    const nums = shuffle([1,2,3,4,5,6,7,8,9,10]).slice(0, nonCaptainPlayers.length);
    nonCaptainPlayers.forEach((p, i) => { p.number = nums[i]; p.peeked = false; });
    const captain = GS.players[GS.captainIndex];
    if (captain) { captain.number = null; captain.peeked = true; }
    GS.myNumber = myPlayer()?.number ?? null;
  }
  if (GS.isHost) {
    broadcast({ type: 'phase_change', phase, extra: {
      topic: GS.topic, captainIndex: GS.captainIndex, round: GS.round
    }});
    if (phase === 'peek') {
      GS.players.forEach(p => {
        if (!p.isHost && p.number != null) sendClient(p.id, { type: 'your_number', number: p.number });
      });
      const captain = GS.players[GS.captainIndex];
      if (captain && !captain.isHost) {
        sendClient(captain.id, { type: 'peek_status', peeked: GS.players.map(x => ({ id: x.id, name: x.name, peeked: x.peeked })) });
      }
    }
  }
  renderGame(); updateBar();
}

// ---- Render Game Content ----
function renderGame() {
  const el = document.getElementById('game-content');
  const renderers = {
    topic: renderTopic, peek: renderPeek, answer: renderAnswer,
    flip: renderFlip, reveal: renderReveal, roundEnd: renderRoundEnd,
    gameOver: renderGameOver, gameFail: renderGameFail
  };
  el.innerHTML = (renderers[GS.phase] || (() => ''))();
}

function topicCard() {
  return `<div class="topic-card">
    <div class="topic-text">${GS.topic.text}</div>
    <div class="topic-range"><span>1</span> = ${GS.topic.low}　→　<span>10</span> = ${GS.topic.high}</div>
  </div>`;
}

// ---- TOPIC PHASE ----
function renderTopic() {
  const cap = GS.players[GS.captainIndex];
  if (amCaptain()) return `
    <div class="card">
      <div class="card-title">🎯 你是出题者</div>
      <p style="font-size:14px;color:var(--g500);margin-bottom:16px">请输入题目，并说明数字1和数字10分别代表什么</p>
      <div class="form-group"><label>题目</label><input id="topic-text" maxlength="100" placeholder="例如：你在汤圆里放了什么创新馅料？"></div>
      <div class="form-group"><label>数字 1 代表（最弱/最差/最…）</label><input id="topic-low" maxlength="30" placeholder="例如：最恶心"></div>
      <div class="form-group"><label>数字 10 代表（最强/最好/最…）</label><input id="topic-high" maxlength="30" placeholder="例如：最多人想吃"></div>
      <button class="btn btn-primary" onclick="submitTopic()">确认出题</button>
    </div>`;
  return `
    <div class="card text-center" style="padding:40px 20px">
      <div style="font-size:48px;margin-bottom:16px">🎯</div>
      <div style="font-size:18px;font-weight:700;margin-bottom:8px">${cap.name} 正在出题</div>
      <div class="text-muted">请稍候<span class="wd"></span></div>
    </div>`;
}

function submitTopic() {
  const text = document.getElementById('topic-text').value.trim();
  const low = document.getElementById('topic-low').value.trim();
  const high = document.getElementById('topic-high').value.trim();
  if (!text || !low || !high) { toast('请填写完整'); return; }
  GS.topic = { text, low, high };
  if (GS.isHost) { goPhase('peek'); }
  else {
    sendHost({ type: 'topic_submit', topic: { text, low, high } });
    document.getElementById('game-content').innerHTML = `
      <div class="card text-center" style="padding:40px 20px">
        <div style="font-size:48px;margin-bottom:16px">✅</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:8px">题目已提交</div>
        <div class="text-muted">等待数字分配<span class="wd"></span></div>
      </div>`;
  }
}

// ---- PEEK PHASE ----
function renderPeek() {
  let h = topicCard();
  const me = myPlayer();
  const myNum = me?.number ?? GS.myNumber;
  if (amCaptain()) {
    h += `<div class="card text-center" style="padding:24px">
      <div style="font-size:48px;margin-bottom:8px">🎯</div>
      <div style="font-size:16px;font-weight:700;color:var(--primary)">你是出题者</div>
      <div style="font-size:13px;color:var(--g400);margin-top:4px">无需查看数字，等待其他人确认</div>
    </div>`;
  } else if (myNum != null) {
    if (me?.peeked) {
      h += `<div class="card text-center" style="padding:24px">
        <div style="font-size:13px;color:var(--g400);margin-bottom:8px">你的数字</div>
        <div style="font-size:56px;font-weight:800;color:var(--primary);line-height:1">${myNum}</div>
        <div style="font-size:12px;color:var(--success);margin-top:8px">✓ 已确认</div>
      </div>`;
    } else {
      h += `<div class="card text-center" style="padding:24px">
        <button class="btn btn-primary" onclick="openPeek()" style="width:auto">👁 查看我的数字</button>
        <div style="font-size:12px;color:var(--g400);margin-top:8px">点击查看后，请记住数字并确认</div>
      </div>`;
    }
  }
  h += `<div class="card"><div class="card-title">查看进度</div><div id="peek-list">`;
  GS.players.forEach(p => {
    const tag = p.id === GS.myId ? '（你）' : '';
    h += `<div style="padding:6px 0;font-size:14px">${p.peeked ? '✅' : '⏳'} ${p.name}${tag}</div>`;
  });
  h += '</div></div>';
  return h;
}

function openPeek() {
  const me = myPlayer();
  const num = me?.number ?? GS.myNumber;
  if (num == null) return;
  document.getElementById('peek-name').textContent = me?.name || GS.myName;
  document.getElementById('peek-number').textContent = num;
  document.getElementById('peek-overlay').classList.remove('hidden');
}
function closePeek() { document.getElementById('peek-overlay').classList.add('hidden'); }

function confirmPeek() {
  const me = myPlayer();
  if (me) me.peeked = true;
  closePeek();
  if (GS.isHost) {
    renderGame();
    if (GS.players.every(p => p.peeked)) setTimeout(() => goPhase('answer'), 500);
  } else {
    sendHost({ type: 'peek_ack' });
    renderGame();
  }
}

function updateClientPeek(peekedData) {
  peekedData.forEach(p => {
    const player = GS.players.find(x => x.id === p.id);
    if (player) player.peeked = p.peeked;
  });
  const el = document.getElementById('peek-list');
  if (!el) return;
  el.innerHTML = peekedData.map(p =>
    `<div style="padding:6px 0;font-size:14px">${p.peeked ? '✅' : '⏳'} ${p.name}${p.name === GS.myName ? '（你）' : ''}</div>`
  ).join('');
}

// ---- ANSWER PHASE ----
function renderAnswer() {
  let h = topicCard();
  if (!amCaptain()) {
    const me = myPlayer();
    const myNum = me?.number ?? GS.myNumber;
    if (myNum != null) {
      h += `<div class="card text-center" style="padding:16px">
        <div style="font-size:12px;color:var(--g400)">你的数字</div>
        <div style="font-size:36px;font-weight:800;color:var(--primary);line-height:1">${myNum}</div>
      </div>`;
    }
  }
  if (amCaptain()) {
    h += `<div class="answer-prompt"><div class="big-text">🎤 你是出题者</div>
      <div class="sub-text">请仔细听大家的回答，然后翻牌</div></div>
      <button class="btn btn-primary" onclick="goFlip()">进入翻牌</button>`;
  } else {
    h += `<div class="answer-prompt"><div class="big-text">🗣 请在语音中回答！</div>
      <div class="sub-text">根据你的数字大小，给出对应强度的回答</div></div>`;
  }
  return h;
}

function goFlip() {
  if (GS.isHost) {
    GS.phase = 'flip';
    GS.flippedCards = [];
    GS.flipVersion++;
    renderGame();
    broadcast({ type: 'phase_change', phase: 'flip', extra: { captainIndex: GS.captainIndex, flippedCards: [], flipVersion: GS.flipVersion } });
    const captain = GS.players[GS.captainIndex];
    if (captain && !captain.isHost) {
      sendClient(captain.id, { type: 'all_numbers', players: GS.players.map(p => ({ id: p.id, name: p.name, number: p.number })) });
    }
  } else { sendHost({ type: 'flip_request' }); }
}

function renderFlip() {
  if (amCaptain()) {
    const captainId = GS.players[GS.captainIndex]?.id;
    const others = GS.players.filter(p => p.id !== captainId && p.number != null);
    const allFlipped = GS.flippedCards.length === others.length && others.length > 0;
    return `<div class="card">
      <div class="card-title">🃏 请从小到大翻牌</div>
      <p style="font-size:13px;color:var(--g500);margin-bottom:12px">点击卡片翻开数字，按从小到大的顺序依次翻开</p>
      <div class="flip-area" id="flip-area">
        ${others.map(p => {
          const flipped = GS.flippedCards.find(f => f.id === p.id);
          if (flipped) {
            return `<div class="flip-card flipped ${flipped.correct ? 'correct' : 'wrong'}">
              <div class="flip-card-inner">
                <div class="flip-card-front"><span class="avatar" style="width:32px;height:32px">${p.name[0]}</span>${p.name}</div>
                <div class="flip-card-back">
                  <div class="flip-number">${flipped.number}</div>
                  <div class="flip-name">${p.name}</div>
                  <div class="flip-status">${flipped.correct ? '✅' : '❌'}</div>
                </div>
              </div>
            </div>`;
          }
          return `<div class="flip-card" onclick="doFlipCard('${p.id}')">
            <div class="flip-card-inner">
              <div class="flip-card-front"><span class="avatar" style="width:32px;height:32px">${p.name[0]}</span>${p.name}</div>
              <div class="flip-card-back"><div class="flip-number">?</div></div>
            </div>
          </div>`;
        }).join('')}
      </div>
      ${allFlipped ? `<button class="btn btn-primary mt-2" onclick="finishFlip()">完成翻牌</button>` : ''}
    </div>`;
  }
  const cap = GS.players[GS.captainIndex];
  return `<div class="card text-center" style="padding:40px 20px">
    <div style="font-size:48px;margin-bottom:16px">🃏</div>
    <div style="font-size:18px;font-weight:700;margin-bottom:8px">${cap?.name} 正在翻牌</div>
    <div class="text-muted">请稍候<span class="wd"></span></div>
  </div>`;
}

function doFlipCard(playerId) {
  if (!amCaptain()) return;
  const p = GS.players.find(x => x.id === playerId);
  if (!p || p.number == null) return;
  const alreadyFlipped = GS.flippedCards.find(f => f.id === playerId);
  if (alreadyFlipped) return;
  const prevMax = GS.flippedCards.length > 0 ? Math.max(...GS.flippedCards.map(f => f.number)) : 0;
  const correct = GS.flippedCards.length === 0 || p.number > prevMax;
  const flipData = { id: playerId, name: p.name, number: p.number, correct };
  if (GS.isHost) {
    processFlipCardAsHost(flipData);
  } else {
    sendHost({ type: 'flip_card', flipData, flipVersion: GS.flipVersion });
  }
}

function processFlipCardAsHost(flipData) {
  const exists = GS.flippedCards.find(f => f.id === flipData.id);
  if (exists) return;
  GS.flippedCards.push(flipData);
  if (!flipData.correct && GS.unicorns > 0) {
    GS.unicorns--;
    GS.poops++;
  }
  if (GS.unicorns === 0) {
    broadcast({ type: 'game_fail', round: GS.round, unicorns: 0, poops: GS.poops });
    GS.phase = 'gameFail';
    renderGame(); updateBar();
    return;
  }
  broadcast({ type: 'flip_card', flipData, flipVersion: GS.flipVersion, unicorns: GS.unicorns, poops: GS.poops });
  renderGame();
  updateBar();
}

function finishFlip() {
  if (!amCaptain()) return;
  const captainId = GS.players[GS.captainIndex]?.id;
  const others = GS.players.filter(p => p.id !== captainId && p.number != null);
  if (GS.flippedCards.length < others.length) { toast('请翻开所有卡片'); return; }
  GS.phase = 'reveal';
  GS.revealedCards = [...GS.flippedCards];
  if (GS.isHost) {
    broadcast({ type: 'phase_change', phase: 'reveal', extra: { flippedCards: GS.flippedCards, poops: GS.poops } });
    renderGame();
  } else {
    sendHost({ type: 'finish_flip' });
  }
}


function renderReveal() {
  const allCorrect = GS.revealedCards.every(c => c.correct);
  const continueBtn = amCaptain() 
    ? `<button class="btn btn-primary mt-2" onclick="goRoundEnd()">继续</button>`
    : `<div class="text-muted mt-2" style="font-size:14px">等待 ${GS.players[GS.captainIndex]?.name} 继续<span class="wd"></span></div>`;
  return `<div class="card text-center" style="padding:24px 20px">
    <div style="font-size:48px;margin-bottom:16px">${allCorrect ? '🦄' : '💩'}</div>
    <div style="font-size:20px;font-weight:700;margin-bottom:8px">${allCorrect ? '完美翻牌！' : '翻牌有误'}</div>
    <div style="font-size:14px;color:var(--g500);margin-bottom:16px">
      🦄 ${GS.unicorns}　💩 ${GS.poops}
    </div>
    <div id="reveal-list" style="text-align:left">
      ${GS.revealedCards.map(c => `
        <div class="reveal-card">
          <div class="reveal-number ${c.correct?'correct':'wrong'}">${c.number}</div>
          <div><div class="reveal-name">${c.name}</div><div class="reveal-status">${c.correct?'✅ 正确':'❌ 错误'}</div></div>
        </div>`).join('')}
    </div>
    ${continueBtn}
  </div>`;
}

function goRoundEnd() {
  if (!amCaptain()) return;
  const allCorrect = GS.revealedCards.every(c => c.correct);
  if (allCorrect) {
    toast('🎉 完美翻牌！指示物保持不变');
  }
  GS.phase = 'roundEnd';
  if (GS.isHost) {
    broadcast({ type: 'round_end', unicorns: GS.unicorns, poops: GS.poops });
  } else {
    sendHost({ type: 'round_end_request' });
  }
  renderGame(); updateBar();
}

// ---- ROUND END ----
function renderRoundEnd() {
  const allCorrect = GS.revealedCards.every(c => c.correct);
  const nextCap = GS.players[(GS.captainIndex + 1) % GS.players.length];
  let actions = '';
  if (GS.isHost || amCaptain()) {
    actions = `<button class="btn btn-primary" onclick="doNextRound()">下一轮</button>
      <button class="btn btn-warn mt-2" onclick="doEndGame()">结束游戏</button>`;
  } else {
    actions = `<div class="text-muted" style="font-size:14px">等待 ${GS.players[GS.captainIndex]?.name} 或房主操作<span class="wd"></span></div>`;
  }
  return `<div class="card text-center" style="padding:32px 20px">
    <div style="font-size:48px;margin-bottom:16px">${allCorrect ? '🦄' : '💩'}</div>
    <div style="font-size:20px;font-weight:700;margin-bottom:8px">${allCorrect ? '完美翻牌！' : '翻牌有误'}</div>
    <div style="font-size:14px;color:var(--g500);margin-bottom:16px">
      🦄 ${GS.unicorns}　💩 ${GS.poops}
    </div>
    <div style="font-size:14px;color:var(--g500);margin-bottom:16px">下一轮出题者：${nextCap?.name}</div>
    ${actions}
  </div>`;
}

function doNextRound() {
  GS.round++;
  GS.captainIndex = (GS.captainIndex + 1) % GS.players.length;
  GS.phase = 'topic';
  GS.flippedCards = [];
  GS.revealedCards = [];
  GS.flipVersion++;
  GS.topic = { text: '', low: '', high: '' };
  GS.myNumber = null;
  GS.players.forEach(p => { p.number = null; p.peeked = false; });
  if (GS.isHost) {
    broadcast({ type: 'state_update', state: {
      round: GS.round, captainIndex: GS.captainIndex, phase: 'topic',
      topic: GS.topic, flippedCards: [], revealedCards: [], flipVersion: GS.flipVersion,
      players: GS.players, unicorns: GS.unicorns, poops: GS.poops
    }});
  }
  renderGame(); updateBar();
}

function doEndGame() {
  GS.phase = 'gameOver';
  broadcast({ type: 'game_over', unicorns: GS.unicorns, poops: GS.poops });
  renderGame(); updateBar();
}

// ---- GAME OVER ----
function renderGameOver() {
  const actions = GS.isHost 
    ? `<button class="btn btn-primary mt-2" onclick="doRestartGame()">再来一局</button>
      <button class="btn btn-warn mt-2" onclick="backToLobby()">离开房间</button>`
    : `<div class="text-muted mt-2" style="font-size:14px">等待房主开始新游戏<span class="wd"></span></div>`;
  return `<div class="card text-center" style="padding:40px 20px">
    <div style="font-size:64px;margin-bottom:16px">🏆</div>
    <div style="font-size:24px;font-weight:800;margin-bottom:8px">游戏结束</div>
    <div style="font-size:16px;color:var(--g500);margin-bottom:8px">共 ${GS.round} 轮</div>
    <div style="font-size:16px;color:var(--g500);margin-bottom:24px">
      🦄 ${GS.unicorns}　💩 ${GS.poops}
    </div>
    ${actions}
  </div>`;
}

function doRestartGame() {
  if (!GS.isHost) return;
  GS.round = 1;
  GS.captainIndex = 0;
  GS.phase = 'topic';
  GS.flippedCards = [];
  GS.revealedCards = [];
  GS.flipVersion++;
  GS.topic = { text: '', low: '', high: '' };
  GS.myNumber = null;
  GS.unicorns = GS.players.length;
  GS.totalUnicorns = GS.unicorns;
  GS.poops = 0;
  GS.players.forEach(p => { p.number = null; p.peeked = false; });
  broadcast({ type: 'state_update', state: {
    round: GS.round, captainIndex: GS.captainIndex, phase: 'topic',
    topic: GS.topic, flippedCards: [], revealedCards: [], flipVersion: GS.flipVersion,
    players: GS.players, unicorns: GS.unicorns, poops: GS.poops, totalUnicorns: GS.totalUnicorns
  }});
  renderGame(); updateBar();
}

// ---- GAME FAIL (独角兽归零) ----
function renderGameFail() {
  const actions = GS.isHost || amCaptain()
    ? `<button class="btn btn-warn mt-2" onclick="doEndGame()">结束游戏</button>
      <button class="btn btn-primary mt-2" onclick="doRestartGame()">再来一局</button>`
    : `<div class="text-muted mt-2" style="font-size:14px">等待房主或${GS.players[GS.captainIndex]?.name}操作<span class="wd"></span></div>`;
  return `<div class="card text-center" style="padding:40px 20px">
    <div style="font-size:64px;margin-bottom:16px">💩</div>
    <div style="font-size:24px;font-weight:800;margin-bottom:8px;color:var(--error)">游戏失败</div>
    <div style="font-size:14px;color:var(--g500);margin-bottom:8px">所有独角兽都变成了大便！</div>
    <div style="font-size:16px;color:var(--g500);margin-bottom:8px">进行了 ${GS.round} 轮</div>
    <div style="font-size:16px;color:var(--g500);margin-bottom:24px">
      🦄 ${GS.unicorns}　💩 ${GS.poops}
    </div>
    ${actions}
  </div>`;
}

// ---- Message Handlers ----
function onClientMsg(pid, data) {
  switch (data.type) {
    case 'join': {
      if (GS.players.length >= 9) { sendClient(pid, { type: 'error', message: '房间已满' }); return; }
      if (GS.phase !== 'lobby') { sendClient(pid, { type: 'error', message: '游戏已开始' }); return; }
      GS.players.push({ id: pid, name: data.name, number: null, peeked: false, isHost: false });
      sendClient(pid, { type: 'joined', playerId: pid, roomCode: GS.roomCode,
        players: GS.players.map(p => ({ name: p.name, isHost: p.isHost })) });
      broadcast({ type: 'player_list', players: GS.players.map(p => ({ name: p.name, isHost: p.isHost })) });
      updateWaitingRoom();
      break;
    }
    case 'peek_ack': {
      const p = GS.players.find(x => x.id === pid);
      if (p) p.peeked = true;
      broadcast({ type: 'peek_status', peeked: GS.players.map(x => ({ id: x.id, name: x.name, peeked: x.peeked })) });
      if (GS.players.every(x => x.peeked)) setTimeout(() => goPhase('answer'), 500);
      break;
    }
    case 'topic_submit': {
      if (GS.players[GS.captainIndex]?.id === pid) { GS.topic = data.topic; goPhase('peek'); }
      break;
    }
    case 'flip_request': {
      if (GS.players[GS.captainIndex]?.id === pid) {
        GS.phase = 'flip'; GS.flippedCards = []; GS.flipVersion++; renderGame();
        broadcast({ type: 'phase_change', phase: 'flip', extra: { captainIndex: GS.captainIndex, flippedCards: [], flipVersion: GS.flipVersion } });
        sendClient(pid, { type: 'all_numbers', players: GS.players.map(p => ({ id: p.id, name: p.name, number: p.number })) });
      }
      break;
    }
    case 'flip_card': {
      if (GS.phase === 'flip' && GS.players[GS.captainIndex]?.id === pid) {
        const flipData = data.flipData;
        if (data.flipVersion !== undefined && data.flipVersion !== GS.flipVersion) break;
        const exists = GS.flippedCards.find(f => f.id === flipData.id);
        if (exists) break;
        GS.flippedCards.push(flipData);
        if (!flipData.correct && GS.unicorns > 0) {
          GS.unicorns--;
          GS.poops++;
        }
        if (GS.unicorns === 0) {
          broadcast({ type: 'game_fail', round: GS.round, unicorns: 0, poops: GS.poops });
          GS.phase = 'gameFail';
          renderGame(); updateBar();
          break;
        }
        broadcast({ type: 'flip_card', flipData, flipVersion: GS.flipVersion, unicorns: GS.unicorns, poops: GS.poops });
        renderGame(); updateBar();
      }
      break;
    }
    case 'finish_flip': {
      if (GS.players[GS.captainIndex]?.id === pid) {
        GS.phase = 'reveal';
        GS.revealedCards = [...GS.flippedCards];
        broadcast({ type: 'phase_change', phase: 'reveal', extra: { flippedCards: GS.flippedCards, poops: GS.poops } });
        renderGame();
      }
      break;
    }
    case 'round_end_request': {
      if (GS.players[GS.captainIndex]?.id === pid || GS.isHost) {
        GS.phase = 'roundEnd';
        broadcast({ type: 'round_end', unicorns: GS.unicorns, poops: GS.poops });
        renderGame(); updateBar();
      }
      break;
    }
    case 'next_round': {
      const nextIdx = (GS.captainIndex + 1) % GS.players.length;
      if (GS.players[nextIdx]?.id === pid || pid === GS.myId) doNextRound();
      break;
    }
  }
}

function onHostMsg(data) {
  switch (data.type) {
    case 'error':
      document.getElementById('join-error').textContent = data.message;
      document.getElementById('join-error').classList.remove('hidden');
      hideConn(); break;
    case 'kicked':
      toast('你已被房主踢出房间');
      setTimeout(() => backToLobby(), 1500);
      break;
    case 'joined':
      GS.myId = data.playerId; GS.roomCode = data.roomCode;
      updateJoinedList(data.players);
      document.getElementById('joined-room-code').textContent = data.roomCode;
      hideConn();
      // 切换到 lobby 屏幕
      switchScreen('lobby');
      // 隐藏所有不需要的面板
      document.getElementById('create-form').classList.add('hidden');
      document.getElementById('join-form').classList.add('hidden');
      document.getElementById('waiting-room').classList.add('hidden');
      // 隐藏 lobby-header 和 lobby-actions（玩家不需要这些）
      const lobbyHeader = document.querySelector('.lobby-header');
      const lobbyActions = document.querySelector('.lobby-actions');
      if (lobbyHeader) lobbyHeader.style.display = 'none';
      if (lobbyActions) lobbyActions.style.display = 'none';
      // 只显示 joined-waiting
      document.getElementById('joined-waiting').classList.remove('hidden');
      break;
    case 'player_list':
      updateJoinedList(data.players); break;
    case 'game_start':
      GS.players = data.players; GS.round = data.round; GS.captainIndex = data.captainIndex;
      GS.unicorns = data.unicorns; GS.poops = data.poops; GS.totalUnicorns = data.totalUnicorns;
      GS.phase = data.phase; GS.topic = data.topic;
      enterGame(); break;
    case 'your_number':
      GS.myNumber = data.number;
      const me = GS.players.find(p => p.id === GS.myId);
      if (me) me.number = data.number;
      renderGame(); break;
    case 'all_numbers':
      data.players.forEach(p => {
        const player = GS.players.find(x => x.id === p.id);
        if (player && player.id !== GS.myId) player.number = p.number;
      });
      renderGame(); break;
    case 'state_update':
      Object.assign(GS, data.state);
      if (data.state.players) {
        const me2 = data.state.players.find(p => p.id === GS.myId);
        if (me2) GS.myNumber = me2.number;
      }
      renderGame(); updateBar(); break;
    case 'peek_status':
      updateClientPeek(data.peeked); break;
    case 'phase_change':
      GS.phase = data.phase;
      if (GS.phase === 'peek' && amCaptain()) {
        const me = myPlayer(); if (me) { me.number = null; me.peeked = true; }
        GS.myNumber = null;
      }
      if (GS.phase === 'flip') {
        GS.flippedCards = data.extra?.flippedCards ? [...data.extra.flippedCards] : [];
        if (data.extra?.flipVersion !== undefined) GS.flipVersion = data.extra.flipVersion;
      } else if (data.extra) {
        Object.assign(GS, data.extra);
      }
      if (GS.phase === 'reveal') {
        GS.revealedCards = data.extra?.flippedCards ? [...data.extra.flippedCards] : [];
        GS.poops = data.extra?.poops || GS.poops;
      }
      renderGame(); updateBar(); break;
    case 'captain_change':
      GS.captainIndex = data.captainIndex;
      renderGame(); updateBar(); break;
    case 'flip_card':
      if (data.flipVersion !== undefined && data.flipVersion !== GS.flipVersion) break;
      const exists = GS.flippedCards.find(f => f.id === data.flipData.id);
      if (!exists) {
        GS.flippedCards.push(data.flipData);
      }
      if (data.unicorns != null) GS.unicorns = data.unicorns;
      if (data.poops != null) GS.poops = data.poops;
      renderGame(); updateBar(); break;
    case 'round_end':
      GS.phase = 'roundEnd'; GS.unicorns = data.unicorns; GS.poops = data.poops;
      renderGame(); updateBar(); break;
    case 'game_over':
      GS.phase = 'gameOver'; GS.unicorns = data.unicorns; GS.poops = data.poops;
      renderGame(); updateBar(); break;
    case 'game_fail':
      GS.phase = 'gameFail'; GS.round = data.round || GS.round; GS.unicorns = 0; GS.poops = data.poops || GS.poops;
      renderGame(); updateBar(); break;
  }
}
