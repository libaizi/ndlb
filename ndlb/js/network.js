// ============================================================
// 脑洞量表 Top Ten Online — Network Layer
// ============================================================

function makePeerConfig(relayOnly) {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:numb.viagenie.ca:3478' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayprojectsecret' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayprojectsecret' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayprojectsecret' },
    { urls: 'turn:staticauth.openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayprojectsecret' },
    { urls: 'turn:staticauth.openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayprojectsecret' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];
  const config = { iceServers };
  if (relayOnly) config.iceTransportPolicy = 'relay';
  return { config, debug: 0 };
}

const CONN_TIMEOUT_PEERJS = 20000;
const CONN_TIMEOUT_HOST = 30000;
const HEARTBEAT_INTERVAL = 8000;
const HEARTBEAT_TIMEOUT = 15000;

let peer = null;
const conns = {};
let heartbeatTimer = null;
let heartbeatTimeout = null;
let iceDiagLog = [];

function hostPeerId(code) { return 'bht-' + code; }

function logICE(msg) {
  const ts = new Date().toLocaleTimeString();
  iceDiagLog.push(`[${ts}] ${msg}`);
  if (iceDiagLog.length > 50) iceDiagLog.shift();
  console.log(`[ICE] ${msg}`);
  const diagEl = document.getElementById('ice-diag-log');
  if (diagEl) diagEl.textContent = iceDiagLog.slice(-12).join('\n');
  const liveEl = document.getElementById('ice-diag-live');
  if (liveEl) liveEl.textContent = iceDiagLog.slice(-5).map(l => l.replace(/^\[[^\]]+\]\s*/, '')).join(' · ');
}

function monitorICEConnection(conn, label) {
  if (!conn || !conn.peerConnection) return;
  const pc = conn.peerConnection;
  pc.oniceconnectionstatechange = () => { logICE(`${label} ICE: ${pc.iceConnectionState}`); };
  pc.onicegatheringstatechange = () => { logICE(`${label} gathering: ${pc.iceGatheringState}`); };
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      const c = e.candidate;
      logICE(`${label} candidate: ${c.type||'?'}/${c.protocol||'?'} ${c.address||'hidden'}`);
    } else { logICE(`${label} gathering complete`); }
  };
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (GS.isHost) {
      Object.values(conns).forEach(c => { if (c.open) c.send({ type: 'ping' }); });
    } else {
      const c = conns.host;
      if (c?.open) c.send({ type: 'ping' });
    }
    clearTimeout(heartbeatTimeout);
    heartbeatTimeout = setTimeout(() => {
      console.warn('[Heartbeat] No pong');
      document.getElementById('conn-dot')?.classList.add('off');
    }, HEARTBEAT_TIMEOUT);
  }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer); heartbeatTimer = null;
  clearTimeout(heartbeatTimeout); heartbeatTimeout = null;
}

function handlePong() {
  clearTimeout(heartbeatTimeout);
  document.getElementById('conn-dot')?.classList.remove('off');
}

function updateConnProgress(step) {
  const el = document.getElementById('connecting-text');
  if (!el) return;
  const labels = { step1: '正在连接信令服务器…', step2: '正在连接房主…', step3: '正在建立P2P通道…' };
  el.textContent = labels[step] || '正在连接...';
  const stepMap = { step1: 'conn-step1', step2: 'conn-step2', step3: 'conn-step3' };
  const order = ['step1', 'step2', 'step3'];
  const idx = order.indexOf(step);
  order.forEach((s, i) => {
    const stepEl = document.getElementById(stepMap[s]);
    if (!stepEl) return;
    const icon = stepEl.querySelector('.step-icon');
    if (i < idx) { stepEl.className = 'step done'; icon.textContent = '✅'; }
    else if (i === idx) { stepEl.className = 'step active'; icon.textContent = '🔄'; }
    else { stepEl.className = 'step'; icon.textContent = '⏳'; }
  });
}

function classifyError(source, err, wasRelay) {
  const errType = err?.type || '';
  const errMsg = typeof err === 'string' ? err : (err?.message || String(err));
  const errors = {
    peerjs_timeout: {
      title: '❌ 信令服务器连接失败',
      reason: '无法连接到 PeerJS 云服务（20秒超时）',
      solutions: [
        '检查网络是否正常，能否访问外网',
        '公司/校园网可能被防火墙屏蔽了 WebSocket，尝试手机热点',
        '稍后再试（PeerJS 免费云服务偶尔不稳定）',
        '使用 Chrome/Edge 浏览器（兼容性最好）',
      ]
    },
    host_timeout: {
      title: wasRelay ? '❌ 中继模式连接也失败了' : '❌ 房间连接超时',
      reason: wasRelay
        ? errMsg + ' — TURN 中继服务器也可能被屏蔽'
        : errMsg + ' — 可能是 NAT 穿透失败',
      solutions: wasRelay ? [
        '你的网络可能屏蔽了所有 TURN 中继服务器',
        '尝试切换到手机热点（4G/5G 网络NAT更友好）',
        '确认浏览器没有禁止 WebRTC（某些隐私插件会禁用）',
        '检查是否开启了 VPN/代理，尝试关闭后重试',
        '公司/校园网可能封锁了非标准端口，只能用手机热点',
      ] : [
        '确认房间码是否正确',
        '房主可能已关闭页面或掉线',
        '系统将自动尝试"中继模式"（通过TURN服务器转发）',
        '如果反复失败，双方都尝试切换网络（如手机热点）',
        '同一局域网请确保没有 AP 隔离',
      ]
    },
    'peer-unavailable': {
      title: '❌ 房间不存在',
      reason: '房间码对应的房主不在线',
      solutions: [
        '检查房间码是否输入正确',
        '房主可能已关闭页面',
        '让房主确认页面是否还开着',
        '让房主重新创建房间并分享新房码',
      ]
    },
    'network': {
      title: '❌ 网络错误',
      reason: errMsg,
      solutions: ['检查网络连接', '关闭VPN/代理重试', '公司/校园网可能屏蔽WebRTC', '尝试手机热点']
    },
    'browser-incompatible': {
      title: '❌ 浏览器不兼容',
      reason: '当前浏览器不支持 WebRTC',
      solutions: ['请使用 Chrome/Edge/Firefox 最新版', 'Safari对WebRTC支持有限，建议换Chrome']
    },
    'unavailable-id': {
      title: '❌ 房间码冲突',
      reason: '该房间码已被使用',
      solutions: ['返回重新创建，系统会自动分配新房码']
    },
    conn_error: {
      title: '❌ P2P连接失败',
      reason: errMsg,
      solutions: ['房主网络可能不允许入站连接', '双方都需能访问外网', '房主刷新页面重建房间', '尝试手机热点']
    },
    peer_error: {
      title: '❌ 连接失败',
      reason: `[${errType}] ${errMsg}`,
      solutions: ['检查网络连接', '刷新页面重试', '持续失败请切换网络（手机热点）', '确认浏览器未禁用WebRTC']
    },
  };
  let key = source;
  if (errType && errors[errType]) key = errType;
  if (!errors[key]) key = 'peer_error';
  return { source: key, ...errors[key], rawError: errMsg };
}

function showErrorModal(errorInfo) {
  const old = document.getElementById('error-modal-overlay');
  if (old) old.remove();
  const diagText = iceDiagLog.length > 0
    ? `<div style="margin-top:16px;border-top:1px solid var(--g200);padding-top:12px">
         <p style="font-weight:600;margin-bottom:8px">📋 连接诊断日志：</p>
         <pre id="ice-diag-log" style="font-size:11px;color:var(--g500);background:var(--g100);padding:8px;border-radius:var(--rs);max-height:150px;overflow-y:auto;white-space:pre-wrap">${iceDiagLog.join('\n')}</pre>
       </div>` : '';
  const overlay = document.createElement('div');
  overlay.id = 'error-modal-overlay';
  overlay.className = 'error-modal-overlay';
  overlay.innerHTML = `
    <div class="error-modal">
      <div class="error-modal-title">${errorInfo.title}</div>
      <div class="error-modal-body">
        <div class="error-reason">${errorInfo.reason}</div>
        <p style="margin-top:12px;font-weight:600">可能的解决方案：</p>
        <ul>${errorInfo.solutions.map(s => `<li>${s}</li>`).join('')}</ul>
        ${diagText}
      </div>
      <div class="error-modal-actions">
        <button class="btn btn-sm btn-secondary" onclick="this.closest('.error-modal-overlay').remove()">关闭</button>
        <button class="btn btn-sm btn-primary" onclick="retryJoin(this)">重试连接</button>
        <button class="btn btn-sm btn-warn" onclick="retryWithRelay(this)">🔄 中继重试</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function initHost(code, relayOnly) {
  return new Promise((resolve, reject) => {
    const pid = hostPeerId(code);
    const config = makePeerConfig(relayOnly);
    peer = new Peer(pid, config);
    if (relayOnly) logICE('Host: RELAY-ONLY mode');
    const peerOpenTimeout = setTimeout(() => {
      reject(classifyError('peerjs_timeout', '无法连接到 PeerJS 信令服务器（20秒超时）'));
    }, CONN_TIMEOUT_PEERJS);
    peer.on('open', () => {
      clearTimeout(peerOpenTimeout);
      logICE('Host: PeerJS cloud connected');
      startHeartbeat();
      resolve();
    });
    peer.on('connection', conn => {
      conn.on('open', () => {
        conns[conn.peer] = conn;
        bindHostConn(conn);
        monitorICEConnection(conn, 'Host←Client');
      });
      if (conn.open) { conns[conn.peer] = conn; bindHostConn(conn); monitorICEConnection(conn, 'Host←Client'); }
    });
    peer.on('error', e => {
      clearTimeout(peerOpenTimeout);
      logICE('Host error: ' + (e.type||'') + ' ' + (e.message||''));
      if (e.type === 'unavailable-id') {
        reject(classifyError('peer_error', { type: 'unavailable-id', message: '房间码已被使用' }));
      } else {
        reject(classifyError('peer_error', e));
      }
    });
    peer.on('disconnected', () => {
      if (peer && !peer.destroyed) { logICE('Host: disconnected, reconnecting...'); peer.reconnect(); }
    });
  });
}

function bindHostConn(conn) {
  conn.on('data', data => {
    if (data.type === 'ping') { conn.send({ type: 'pong' }); return; }
    if (data.type === 'pong') { handlePong(); return; }
    onClientMsg(conn.peer, data);
  });
  conn.on('close', () => {
    const p = GS.players.find(x => x.id === conn.peer);
    if (p) {
      toast(p.name + ' 离开了房间');
      if (GS.phase === 'lobby') {
        GS.players = GS.players.filter(x => x.id !== conn.peer);
        broadcast({ type: 'player_list', players: GS.players.map(p => ({ name: p.name, isHost: p.isHost })) });
        updateWaitingRoom();
      }
    }
    delete conns[conn.peer];
  });
}

function initClient(code, relayOnly) {
  return new Promise((resolve, reject) => {
    const config = makePeerConfig(relayOnly);
    peer = new Peer(undefined, config);
    if (relayOnly) logICE('Client: RELAY-ONLY mode');
    updateConnProgress('step1');
    const peerOpenTimeout = setTimeout(() => {
      reject(classifyError('peerjs_timeout', '无法连接到 PeerJS 信令服务器（20秒超时）'));
    }, CONN_TIMEOUT_PEERJS);
    peer.on('open', myId => {
      clearTimeout(peerOpenTimeout);
      GS.myId = myId;
      logICE('Client: PeerJS cloud connected');
      updateConnProgress('step2');
      const hid = hostPeerId(code);
      const conn = peer.connect(hid, { reliable: true });
      logICE('Client: connecting to ' + hid);
      const connTimeout = setTimeout(() => {
        if (!conn.open) {
          conn.close();
          logICE('Client: TIMEOUT');
          reject(classifyError('host_timeout', `连接房间 ${code} 超时（30秒）`, relayOnly));
        }
      }, CONN_TIMEOUT_HOST);
      conn.on('open', () => {
        clearTimeout(connTimeout);
        updateConnProgress('step3');
        logICE('Client: P2P OPEN!');
        conns.host = conn;
        monitorICEConnection(conn, 'Client→Host');
        conn.on('data', data => {
          if (data.type === 'ping') { conn.send({ type: 'pong' }); return; }
          if (data.type === 'pong') { handlePong(); return; }
          onHostMsg(data);
        });
        conn.on('close', () => {
          toast('与房主断开连接');
          document.getElementById('conn-dot')?.classList.add('off');
          stopHeartbeat();
        });
        startHeartbeat();
        resolve();
      });
      conn.on('error', err => {
        clearTimeout(connTimeout);
        logICE('Client conn error: ' + (err.message||String(err)));
        reject(classifyError('conn_error', err));
      });
    });
    peer.on('error', err => {
      clearTimeout(peerOpenTimeout);
      logICE('Client error: ' + (err.type||'') + ' ' + (err.message||''));
      if (err.type === 'peer-unavailable') reject(classifyError('peer-unavailable', err));
      else reject(classifyError('peer_error', err));
    });
    peer.on('disconnected', () => {
      if (peer && !peer.destroyed) { logICE('Client: disconnected, reconnecting...'); peer.reconnect(); }
    });
  });
}

function broadcast(data) {
  if (!GS.isHost) return;
  Object.values(conns).forEach(c => { if (c.open) c.send(data); });
}

function sendHost(data) {
  if (GS.isHost) return;
  const c = conns.host; if (c?.open) c.send(data);
}

function sendClient(pid, data) {
  const c = conns[pid]; if (c?.open) c.send(data);
}

async function retryJoin(btnEl, attemptCount, relayOnly) {
  const overlay = btnEl?.closest('.error-modal-overlay');
  if (overlay) overlay.remove();
  const code = document.getElementById('join-code')?.dataset.lastCode || document.getElementById('join-code')?.value.trim().toUpperCase();
  const name = document.getElementById('join-name')?.dataset.lastName || document.getElementById('join-name')?.value.trim();
  if (!code || !name) return;
  attemptCount = attemptCount || 1;
  relayOnly = relayOnly || false;
  if (attemptCount >= 3 && !relayOnly) relayOnly = true;
  GS.isHost = false; GS.myName = name;
  const modeLabel = relayOnly ? ' [中继模式]' : '';
  showConn(`正在重新连接... (第${attemptCount}次)${modeLabel}`);
  iceDiagLog = [];
  try {
    await initClient(code, relayOnly);
    sendHost({ type: 'join', name });
  } catch (e) {
    hideConn();
    if (peer) { try { peer.destroy(); } catch(_){} peer = null; }
    stopHeartbeat();
    const errInfo = e?.title ? e : classifyError('peer_error', e, relayOnly);
    if (attemptCount < 5) {
      const delay = attemptCount * 2000;
      const nextRelay = attemptCount >= 2;
      showConn(`${errInfo.title}，${delay/1000}秒后重试${nextRelay&&!relayOnly?'(中继)':''}...`);
      setTimeout(() => { hideConn(); retryJoin(null, attemptCount+1, nextRelay); }, delay);
    } else { showErrorModal(errInfo); }
  }
}

async function retryWithRelay(btnEl) {
  const overlay = btnEl?.closest('.error-modal-overlay');
  if (overlay) overlay.remove();
  const code = document.getElementById('join-code')?.dataset.lastCode || document.getElementById('join-code')?.value.trim().toUpperCase();
  const name = document.getElementById('join-name')?.dataset.lastName || document.getElementById('join-name')?.value.trim();
  if (!code || !name) return;
  GS.isHost = false; GS.myName = name;
  showConn('正在通过中继服务器连接...');
  iceDiagLog = [];
  try {
    await initClient(code, true);
    sendHost({ type: 'join', name });
  } catch (e) {
    hideConn();
    if (peer) { try { peer.destroy(); } catch(_){} peer = null; }
    stopHeartbeat();
    showErrorModal(e?.title ? e : classifyError('host_timeout', e, true));
  }
}

function kickPlayer(pid) {
  if (!GS.isHost) return;
  const p = GS.players.find(x => x.id === pid);
  if (!p || p.isHost) return;
  const conn = conns[pid];
  if (conn) { conn.send({ type: 'kicked' }); conn.close(); delete conns[pid]; }
  GS.players = GS.players.filter(x => x.id !== pid);
  broadcast({ type: 'player_list', players: GS.players.map(p => ({ name: p.name, isHost: p.isHost })) });
  updateWaitingRoom();
  toast(p.name + ' 已被踢出');
}
