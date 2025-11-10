// ================= 可配置常量 =================
export const N_RB = 200;
export const N_II = 200;

export const USE_FIXATION = true;
export const FIX_MS = 500;

export const USE_PREBLANK = true;
export const PREBLANK_MS = 200;

export const RESP_LIMIT_MS = 3500;
export const FEEDBACK_MS = 700;
export const ITI_MS = 0; // ← 延迟占位

export const ORI_MIN = -15;
export const ORI_MAX = 15;
export const SF_LINES = [3, 4, 5, 6]; // 可见条纹总数（黑+白）
export const CANVAS_VIEW_RATIO = 0.82; // 画布占短边比例

// —— RB 判定（仅方向）——
export const RB_ABS_ORI_THRESHOLD = 7; // |ori|<=7° → A，否则 B

// —— II 判别函数（线性，可改）——
export const W_SF = 0.6;
export const W_ORI = 0.8;
export const II_BIAS = 0.9;

// —— II 的“ori 分桶≈1:1”保险丝 ——
export const ENFORCE_ORI_BUCKET_BALANCE = true;
export const ORI_BINS = [[-15, -9], [-9, -3], [-3, 3], [3, 9], [9, 15]]; // 5 桶
// =================================================

const startBtn = document.getElementById('start-btn');
const participantInput = document.getElementById('participant');
const startScreen = document.getElementById('start-screen');
const experimentScreen = document.getElementById('experiment-screen');
const messageEl = document.getElementById('message');
const instructionOverlay = document.getElementById('instruction-overlay');
const instructionContinueBtn = document.getElementById('instruction-continue');
const touchControls = document.getElementById('touch-controls');
const touchButtons = Array.from(touchControls.querySelectorAll('button'));
const canvas = document.getElementById('stimulus');
const ctx = canvas.getContext('2d');

let canvasLogicalWidth = 0;
let canvasLogicalHeight = 0;
let currentScale = window.devicePixelRatio || 1;

let experimentAborted = false;
let currentParticipant = '';

const CSV_HEADER = ['participant', 'blockName', 'trialIndex', 'sf', 'ori', 'label', 'correctKey', 'resp', 'corr', 'rt', 'timeout', 'trialStartUTC'];
const dataRows = [CSV_HEADER];

class InputRouter {
  constructor() {
    this.listener = null;
    this.trialAbortHandler = null;
    this.globalAbortHandler = null;
    this.active = false;
    this.prevButtonStates = new Map();

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handlePointer = this.handlePointer.bind(this);
    this.gamepadLoop = this.gamepadLoop.bind(this);

    window.addEventListener('keydown', this.handleKeyDown, { passive: false });
    touchButtons.forEach(btn => {
      if (window.PointerEvent) {
        btn.addEventListener('pointerdown', this.handlePointer, { passive: false });
      } else {
        btn.addEventListener('touchstart', this.handlePointer, { passive: false });
        btn.addEventListener('click', this.handlePointer, { passive: false });
      }
    });
    window.addEventListener('gamepadconnected', () => {
      this.prevButtonStates.clear();
    });
    window.addEventListener('gamepaddisconnected', (event) => {
      this.prevButtonStates.delete(event.gamepad.index);
    });
    requestAnimationFrame(this.gamepadLoop);
  }

  setResponseListener(listener) {
    this.listener = listener;
    this.active = typeof listener === 'function';
  }

  clearResponseListener() {
    this.listener = null;
    this.active = false;
  }

  setTrialAbortHandler(handler) {
    this.trialAbortHandler = handler;
  }

  clearTrialAbortHandler() {
    this.trialAbortHandler = null;
  }

  setGlobalAbortHandler(handler) {
    this.globalAbortHandler = handler;
  }

  emitResponse(key) {
    if (!this.active || typeof this.listener !== 'function') return;
    this.listener(key);
  }

  handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.handleAbort();
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'a' || key === 'b') {
      if (this.active) {
        event.preventDefault();
      }
      this.emitResponse(key);
    }
  }

  handlePointer(event) {
    if (!event.currentTarget) return;
    const key = event.currentTarget.dataset.key;
    if (key === 'a' || key === 'b') {
      event.preventDefault();
      this.emitResponse(key);
    }
  }

  handleAbort() {
    let handled = false;
    if (typeof this.trialAbortHandler === 'function') {
      handled = this.trialAbortHandler() === true;
    }
    if (!handled && typeof this.globalAbortHandler === 'function') {
      this.globalAbortHandler();
    }
  }

  gamepadLoop() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (pads) {
      for (const pad of pads) {
        if (!pad) continue;
        const prev = this.prevButtonStates.get(pad.index) || [];
        const next = [];
        const buttons = pad.buttons || [];
        const emitOnce = (idxArray, action) => {
          for (const idx of idxArray) {
            const pressed = !!(buttons[idx] && buttons[idx].pressed);
            next[idx] = pressed;
            const wasPressed = prev[idx];
            if (pressed && !wasPressed) {
              action();
              return true;
            }
          }
          return false;
        };
        const abortButtons = [8, 9, 12]; // Start/Back/D-pad Up as兜底
        if (emitOnce(abortButtons, () => this.handleAbort())) {
          this.prevButtonStates.set(pad.index, next);
          continue;
        }
        const respondedA = emitOnce([0, 2], () => this.emitResponse('a'));
        const respondedB = emitOnce([1, 3], () => this.emitResponse('b'));
        if (!respondedA && !respondedB) {
          for (let i = 0; i < buttons.length; i++) {
            if (next[i] === undefined) {
              next[i] = !!(buttons[i] && buttons[i].pressed);
            }
          }
        }
        this.prevButtonStates.set(pad.index, next);
      }
    }
    requestAnimationFrame(this.gamepadLoop);
  }
}

const inputRouter = new InputRouter();

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const shorter = Math.min(window.innerWidth, window.innerHeight);
  const target = Math.max(200, Math.round(shorter * CANVAS_VIEW_RATIO));
  currentScale = dpr;
  canvas.style.width = `${target}px`;
  canvas.style.height = `${target}px`;
  canvas.width = Math.max(1, Math.round(target * dpr));
  canvas.height = Math.max(1, Math.round(target * dpr));
  canvasLogicalWidth = canvas.width / dpr;
  canvasLogicalHeight = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  clearCanvas();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function seededRngFromString(str) {
  const seed = cyrb128(str);
  return sfc32(seed[0], seed[1], seed[2], seed[3]);
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function labelRB(oriDeg) {
  return Math.abs(oriDeg) <= RB_ABS_ORI_THRESHOLD ? 'A' : 'B';
}

function labelII(sfLines, oriDeg) {
  const x = (sfLines - 4.5) / 1.5;
  const y = oriDeg / 15;
  const score = W_SF * x + W_ORI * y - II_BIAS;
  return score > 0 ? 'A' : 'B';
}

function jitterValue(base, range, rng, min = ORI_MIN, max = ORI_MAX) {
  const value = base + (rng() - 0.5) * range;
  return Math.max(min, Math.min(max, value));
}

function makeTrialsRB(participant) {
  const rng = seededRngFromString(participant + '_RB');
  const baseOris = [-15, -9, -3, 3, 9, 15];
  const maxTrialsPerLabel = N_RB / 2;
  const trialsA = [];
  const trialsB = [];
  let iteration = 0;
  while ((trialsA.length < maxTrialsPerLabel || trialsB.length < maxTrialsPerLabel) && iteration < 200) {
    iteration++;
    for (const sfLines of SF_LINES) {
      for (const baseOri of baseOris) {
        const ori = jitterValue(baseOri, 2.4, rng);
        const label = labelRB(ori);
        const container = label === 'A' ? trialsA : trialsB;
        if (container.length < maxTrialsPerLabel) {
          container.push({ blockName: 'RB', sfLines, ori, label });
        }
      }
    }
  }
  const combined = trialsA.slice(0, maxTrialsPerLabel).concat(trialsB.slice(0, maxTrialsPerLabel));
  shuffleInPlace(combined, rng);
  return combined;
}

function getBinIndex(ori) {
  for (let i = 0; i < ORI_BINS.length; i++) {
    const [min, max] = ORI_BINS[i];
    if (ori >= min && ori <= max) {
      return i;
    }
  }
  return Math.max(0, Math.min(ORI_BINS.length - 1, Math.floor(((ori - ORI_MIN) / (ORI_MAX - ORI_MIN + 0.0001)) * ORI_BINS.length)));
}

function makeTrialsII(participant) {
  const rng = seededRngFromString(participant + '_II');
  const bucketCount = ORI_BINS.length;
  const requiredPerLabel = N_II / 2;
  const requiredPerLabelPerBin = Math.floor(requiredPerLabel / bucketCount);
  const remainderLabel = requiredPerLabel - requiredPerLabelPerBin * bucketCount;
  const buckets = ORI_BINS.map(() => ({ A: [], B: [] }));
  const baseOris = ORI_BINS.map(([min, max]) => (min + max) / 2);
  let iteration = 0;
  const targetPerBucket = requiredPerLabelPerBin + 4;
  while (iteration < 400) {
    iteration++;
    for (let bi = 0; bi < baseOris.length; bi++) {
      const [binMin, binMax] = ORI_BINS[bi];
      const span = binMax - binMin;
      for (const sfLines of SF_LINES) {
        const ori = jitterValue(baseOris[bi], span * 0.6, rng, binMin + 0.1, binMax - 0.1);
        const label = labelII(sfLines, ori);
        const bucket = buckets[getBinIndex(ori)];
        bucket[label].push({ blockName: 'II', sfLines, ori, label, binIndex: bi });
      }
    }
    if (!ENFORCE_ORI_BUCKET_BALANCE) break;
    const satisfied = buckets.every(bucket => bucket.A.length >= targetPerBucket && bucket.B.length >= targetPerBucket);
    if (satisfied) break;
  }
  const selected = [];
  const leftovers = { A: [], B: [] };
  for (let bi = 0; bi < bucketCount; bi++) {
    const bucket = buckets[bi];
    const desiredA = requiredPerLabelPerBin + (bi < remainderLabel ? 1 : 0);
    const desiredB = desiredA;
    const take = (list, needed) => {
      const picked = [];
      shuffleInPlace(list, rng);
      while (list.length && picked.length < needed) {
        picked.push(list.pop());
      }
      return picked;
    };
    const pickedA = take(bucket.A, desiredA);
    const pickedB = take(bucket.B, desiredB);
    selected.push(...pickedA, ...pickedB);
    leftovers.A.push(...bucket.A);
    leftovers.B.push(...bucket.B);
    const shortageA = desiredA - pickedA.length;
    const shortageB = desiredB - pickedB.length;
    if (shortageA > 0) {
      leftovers.A.sort(() => rng() - 0.5);
      selected.push(...leftovers.A.splice(0, shortageA));
    }
    if (shortageB > 0) {
      leftovers.B.sort(() => rng() - 0.5);
      selected.push(...leftovers.B.splice(0, shortageB));
    }
  }
  const finalA = selected.filter(t => t.label === 'A');
  const finalB = selected.filter(t => t.label === 'B');
  const needA = requiredPerLabel - finalA.length;
  const needB = requiredPerLabel - finalB.length;
  if (needA > 0) {
    shuffleInPlace(leftovers.A, rng);
    finalA.push(...leftovers.A.splice(0, needA));
  }
  if (needB > 0) {
    shuffleInPlace(leftovers.B, rng);
    finalB.push(...leftovers.B.splice(0, needB));
  }
  let combined = finalA.slice(0, requiredPerLabel).concat(finalB.slice(0, requiredPerLabel));
  if (combined.length < N_II) {
    const pool = leftovers.A.concat(leftovers.B);
    shuffleInPlace(pool, rng);
    while (combined.length < N_II && pool.length) {
      const item = pool.pop();
      const countA = combined.filter(t => t.label === 'A').length;
      const countB = combined.length - countA;
      if (item.label === 'A' && countA < requiredPerLabel) {
        combined.push(item);
      } else if (item.label === 'B' && countB < requiredPerLabel) {
        combined.push(item);
      }
    }
  }
  if (combined.length < N_II && combined.length > 0) {
    const template = combined.slice();
    let idx = 0;
    while (combined.length < N_II) {
      const base = template[idx % template.length];
      combined.push({ ...base });
      idx++;
    }
  }
  combined = combined.slice(0, N_II);
  shuffleInPlace(combined, rng);
  return combined;
}

function clearCanvas() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  ctx.setTransform(currentScale, 0, 0, currentScale, 0, 0);
  ctx.fillStyle = '#7a7a7a';
  ctx.fillRect(0, 0, canvasLogicalWidth, canvasLogicalHeight);
}

function drawFixation() {
  clearCanvas();
  const cx = canvasLogicalWidth / 2;
  const cy = canvasLogicalHeight / 2;
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(2, Math.min(canvasLogicalWidth, canvasLogicalHeight) * 0.004);
  const size = Math.min(canvasLogicalWidth, canvasLogicalHeight) * 0.02;
  ctx.beginPath();
  ctx.moveTo(cx - size, cy);
  ctx.lineTo(cx + size, cy);
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx, cy + size);
  ctx.stroke();
  ctx.restore();
}

function drawGabor(targetCtx, cx, cy, diameterPx, oriDeg, sfLines) {
  const off = document.createElement('canvas');
  off.width = diameterPx;
  off.height = diameterPx;
  const offCtx = off.getContext('2d');
  const radius = diameterPx / 2;
  const imageData = offCtx.createImageData(diameterPx, diameterPx);
  const data = imageData.data;
  const theta = (oriDeg * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const cycles = sfLines / 2; // 直径上期望的黑白条数量 → cycles = sfLines / 2
  const frequency = cycles / diameterPx; // 将可见条纹数量换算为每像素周期
  for (let y = 0; y < diameterPx; y++) {
    for (let x = 0; x < diameterPx; x++) {
      const dx = x - radius + 0.5;
      const dy = y - radius + 0.5;
      const distSq = dx * dx + dy * dy;
      const idx = (y * diameterPx + x) * 4;
      if (distSq <= radius * radius) {
        const xr = dx * cosT + dy * sinT;
        const phase = 2 * Math.PI * frequency * xr;
        const contrast = Math.sin(phase);
        const intensity = Math.max(0, Math.min(255, 127.5 + 127.5 * contrast));
        data[idx] = intensity;
        data[idx + 1] = intensity;
        data[idx + 2] = intensity;
        data[idx + 3] = 255;
      } else {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      }
    }
  }
  offCtx.putImageData(imageData, 0, 0);
  targetCtx.save();
  targetCtx.drawImage(off, cx - radius, cy - radius);
  targetCtx.strokeStyle = '#000000';
  targetCtx.lineWidth = Math.max(2, diameterPx * 0.025);
  targetCtx.beginPath();
  targetCtx.arc(cx, cy, radius - targetCtx.lineWidth / 2, 0, Math.PI * 2);
  targetCtx.stroke();
  targetCtx.restore();
}

function renderStimulus(ori, sfLines) {
  clearCanvas();
  const cx = canvasLogicalWidth / 2;
  const cy = canvasLogicalHeight / 2;
  const diameter = Math.max(32, Math.round(Math.min(canvasLogicalWidth, canvasLogicalHeight) * 0.36));
  drawGabor(ctx, cx, cy, diameter, ori, sfLines);
}

function setMessage(text, color = '#f0f0f0') {
  messageEl.textContent = text;
  messageEl.style.color = color;
  messageEl.style.opacity = text ? '1' : '0';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTimeSeconds(ms) {
  return (ms / 1000).toFixed(3);
}

function rowsToCsv(rows) {
  return rows.map(r => r.map(value => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }).join(',')).join('\n');
}

function downloadCSV(filename, rows) {
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function finalizeAndDownload(participant, isAbort = false) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `gabor_${participant || 'unknown'}_${timestamp}.csv`;
  downloadCSV(filename, dataRows);
  setMessage(isAbort ? '实验已终止，数据已下载。' : '实验完成，数据已下载。', isAbort ? '#ff6b6b' : '#5bd35b');
}

function handleAbortRequest() {
  if (experimentAborted) return;
  experimentAborted = true;
  finalizeAndDownload(currentParticipant, true);
}

inputRouter.setGlobalAbortHandler(handleAbortRequest);

function resetState() {
  experimentAborted = false;
  dataRows.length = 0;
  dataRows.push(CSV_HEADER);
  setMessage('');
  clearCanvas();
}

async function runTrial(blockName, trial, trialIndex, participant) {
  const correctKey = trial.label === 'A' ? 'a' : 'b';
  const trialStartUTC = new Date().toISOString();
  if (USE_FIXATION) {
    setMessage('');
    drawFixation();
    await sleep(FIX_MS);
  }
  if (USE_PREBLANK) {
    setMessage('');
    clearCanvas();
    await sleep(PREBLANK_MS);
  }
  setMessage('');
  renderStimulus(trial.ori, trial.sfLines);

  let response = 'NA';
  let rtValue = '';
  let timeout = 0;
  let corrFlag = 0;

  const startTime = performance.now();
  let abortRequested = false;

  const result = await new Promise(resolve => {
    let resolved = false;
    let timeoutHandle;
    const cleanup = () => {
      inputRouter.clearResponseListener();
      inputRouter.clearTrialAbortHandler();
    };

    const finish = (payload) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(payload);
    };

    const onResponse = (key) => {
      if (key !== 'a' && key !== 'b') return;
      const rtMs = performance.now() - startTime;
      response = key;
      rtValue = formatTimeSeconds(rtMs);
      timeout = 0;
      corrFlag = response === correctKey ? 1 : 0;
      clearTimeout(timeoutHandle);
      clearCanvas();
      setMessage(corrFlag ? 'Correct' : 'Wrong', corrFlag ? '#5bd35b' : '#ff6b6b');
      finish({ type: 'response' });
    };

    timeoutHandle = setTimeout(() => {
      response = 'NA';
      rtValue = '';
      timeout = 1;
      corrFlag = 0;
      clearCanvas();
      setMessage('Wrong', '#ff6b6b');
      finish({ type: 'timeout' });
    }, RESP_LIMIT_MS);

    const trialAbortHandler = () => {
      response = 'NA';
      rtValue = '';
      timeout = 1;
      corrFlag = 0;
      clearTimeout(timeoutHandle);
      abortRequested = true;
      clearCanvas();
      setMessage('实验终止中...', '#ffb84d');
      finish({ type: 'abort' });
      return true;
    };

    inputRouter.setResponseListener(onResponse);
    inputRouter.setTrialAbortHandler(() => {
      clearTimeout(timeoutHandle);
      return trialAbortHandler();
    });
  });

  const row = [
    participant,
    blockName,
    trialIndex,
    trial.sfLines,
    trial.ori.toFixed(3),
    trial.label,
    correctKey,
    response,
    corrFlag,
    rtValue,
    timeout,
    trialStartUTC
  ];
  dataRows.push(row);

  if (abortRequested && !experimentAborted) {
    handleAbortRequest();
  }

  await sleep(FEEDBACK_MS);
  if (experimentAborted || result.type === 'abort') {
    return false;
  }
  setMessage('');
  clearCanvas();
  if (ITI_MS > 0) {
    await sleep(ITI_MS);
  }
  return true;
}

async function runBlock(blockName, trials, participant) {
  for (let i = 0; i < trials.length; i++) {
    if (experimentAborted) return false;
    const cont = await runTrial(blockName, trials[i], i + 1, participant);
    if (!cont || experimentAborted) {
      return false;
    }
  }
  return true;
}

function enableStartButton() {
  startBtn.disabled = !participantInput.value.trim();
}
participantInput.addEventListener('input', enableStartButton);
enableStartButton();

function showInstructions() {
  return new Promise(resolve => {
    instructionOverlay.classList.add('active');
    instructionContinueBtn.focus({ preventScroll: true });

    const cleanup = () => {
      instructionContinueBtn.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKeyDown, true);
      inputRouter.clearResponseListener();
    };

    const proceed = () => {
      cleanup();
      instructionOverlay.classList.remove('active');
      resolve();
    };

    const onClick = () => {
      proceed();
    };

    const onKeyDown = (event) => {
      if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter') {
        event.preventDefault();
        proceed();
      }
    };

    instructionContinueBtn.addEventListener('click', onClick);
    window.addEventListener('keydown', onKeyDown, true);
    inputRouter.setResponseListener((key) => {
      if (key === 'a' || key === 'b') {
        proceed();
      }
    });
  });
}

async function beginExperiment(participant) {
  resetState();
  const rbTrials = makeTrialsRB(participant);
  const contRB = await runBlock('RB', rbTrials, participant);
  if (!contRB || experimentAborted) return;
  const iiTrials = makeTrialsII(participant);
  const contII = await runBlock('II', iiTrials, participant);
  if (!contII || experimentAborted) return;
  finalizeAndDownload(participant, false);
}

async function handleStart() {
  const participant = participantInput.value.trim();
  if (!participant) {
    participantInput.focus();
    return;
  }
  currentParticipant = participant;
  startBtn.disabled = true;
  try {
    if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen().catch(() => {});
    }
  } catch (err) {
    console.warn(err);
  }
  startScreen.style.display = 'none';
  experimentScreen.classList.add('active');
  resizeCanvas();
  setMessage('');
  clearCanvas();
  await showInstructions();
  beginExperiment(participant);
}

startBtn.addEventListener('click', () => {
  handleStart();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && document.activeElement === participantInput && !startBtn.disabled) {
    event.preventDefault();
    handleStart();
  }
});

setMessage('');
