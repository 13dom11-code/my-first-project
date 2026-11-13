(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     ПРОГРАММА для ATtiny13A — каждая строка = 1 такт
  ═══════════════════════════════════════════════════════════ */
  const PROGRAM = [
    { cmd: 'LDI R16, 0x01',  desc: 'R16 ← 0x01' },
    { cmd: 'OUT DDRB, R16',  desc: 'DDRB ← 0x01 (PB0 — выход)' },
    { cmd: 'LDI R16, 0x01',  desc: 'R16 ← 0x01' },              // цель цикла
    { cmd: 'OUT PORTB, R16', desc: 'PORTB ← 0x01 → LED ВКЛ 🔴' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'LDI R16, 0x00',  desc: 'R16 ← 0x00' },
    { cmd: 'OUT PORTB, R16', desc: 'PORTB ← 0x00 → LED ВЫКЛ ⚫' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'NOP', desc: 'пауза' },
    { cmd: 'RJMP 0x0002', desc: 'переход к 0x0002 (цикл)' }
  ];

  const LOOP_TARGET = 2;
  const N_PROG = PROGRAM.length;

  const FREQ_PRESETS = [
    { label: '125 кГц', delay: 220 },
    { label: '250 кГц', delay: 110 },
    { label: '1 МГц',   delay: 45  },
    { label: '4 МГц',   delay: 18  },
    { label: '8 МГц',   delay: 9   }
  ];

  const state = {
    pc: 0, lastExecuted: -1, tick: 0,
    r16: 0, ddrb: 0, portb: 0, tcnt0: 0, ocr0a: 0,
    ledOn: false, running: false, paused: false,
    freqIndex: 2, intervalId: null,
    flashUsed: 42, sramUsed: 6, eepromUsed: 0
  };

  const $ = id => document.getElementById(id);
  const freqSlider = $('freqSlider'), freqDisplay = $('freqDisplay');
  const startBtn = $('startBtn'), stepBtn = $('stepBtn');
  const pauseBtn = $('pauseBtn'), resetBtn = $('resetBtn');
  const led = $('led'), ledState = $('ledState'), eventLog = $('eventLog');
  const tickInfo = $('tickInfo');
  const fetchCode = $('fetchCode'), decodeCode = $('decodeCode'), executeCode = $('executeCode');
  const pipeExecute = $('pipeExecute');
  const ddrbVal = $('ddrbVal'), ddrbBin = $('ddrbBin');
  const portbVal = $('portbVal'), portbBin = $('portbBin');
  const tcnt0Val = $('tcnt0Val'), tcnt0Bin = $('tcnt0Bin');
  const ocr0aVal = $('ocr0aVal'), ocr0aBin = $('ocr0aBin');
  const r16Val = $('r16Val');
  const regDDRB = $('regDDRB'), regPORTB = $('regPORTB');
  const flashFill = $('flashFill'), flashCount = $('flashCount');
  const sramFill = $('sramFill'), sramCount = $('sramCount');
  const eepromFill = $('eepromFill'), eepromCount = $('eepromCount');

  const toHex = v => '0x' + v.toString(16).toUpperCase().padStart(2, '0');
  const toHex4 = v => '0x' + v.toString(16).toUpperCase().padStart(4, '0');
  const toBin8 = v => v.toString(2).padStart(8, '0').replace(/(.{4})(.{4})/, '$1 $2');

  function logMessage(html) {
    const p = document.createElement('p');
    p.innerHTML = html;
    eventLog.appendChild(p);
    eventLog.scrollTop = eventLog.scrollHeight;
    while (eventLog.children.length > 40) eventLog.removeChild(eventLog.firstChild);
  }

  function executeInstruction(idx) {
    const instr = PROGRAM[idx];
    const parts = instr.cmd.split(' ');
    const op = parts[0];
    let jumped = false;
    regDDRB.classList.remove('highlight');
    regPORTB.classList.remove('highlight');

    switch (op) {
      case 'LDI':
        state.r16 = parseInt(parts[2].trim(), 16);
        break;
      case 'OUT': {
        const reg = parts[1].replace(',', '');
        if (reg === 'DDRB') { state.ddrb = state.r16; regDDRB.classList.add('highlight'); }
        else if (reg === 'PORTB') {
          state.portb = state.r16;
          state.ledOn = (state.portb & 0x01) === 1;
          regPORTB.classList.add('highlight');
        }
        break;
      }
      case 'RJMP':
        state.pc = LOOP_TARGET; jumped = true; break;
    }

    state.tcnt0 = (state.tcnt0 + 1) & 0xFF;
    if (state.tcnt0 > 15) state.tcnt0 = 0;
    state.ocr0a = 8;
    state.sramUsed = 6 + (state.tick % 5);
    if (state.tick % 25 === 0 && state.flashUsed < 60) state.flashUsed++;

    return { jumped, instr };
  }

  function doStep() {
    const idx = state.pc;
    const { jumped, instr } = executeInstruction(idx);
    state.lastExecuted = idx;
    state.tick++;
    if (!jumped) state.pc = (state.pc + 1) % N_PROG;
    updateUI();
    logInstruction(idx, instr);
    pipeExecute.classList.remove('executed-flash');
    void pipeExecute.offsetWidth;
    pipeExecute.classList.add('executed-flash');
  }

  function logInstruction(idx, instr) {
    const n = state.tick, cmd = instr.cmd;
    if (cmd.startsWith('NOP')) return;
    if (cmd.startsWith('LDI')) {
      logMessage(`<span class="log-step">Такт ${n}:</span> ${cmd} → R16 = ${toHex(state.r16)}`);
    } else if (cmd.includes('DDRB')) {
      logMessage(`<span class="log-step">Такт ${n}:</span> ${cmd} → DDRB = ${toHex(state.ddrb)} (PB0 — выход)`);
    } else if (cmd.includes('PORTB')) {
      if (state.ledOn) logMessage(`<span class="log-step">Такт ${n}:</span> ${cmd} → <span class="log-led-on">LED ВКЛ 🔴</span> (PB0 = 1)`);
      else            logMessage(`<span class="log-step">Такт ${n}:</span> ${cmd} → <span class="log-led-off">LED ВЫКЛ ⚫</span> (PB0 = 0)`);
    } else if (cmd.startsWith('RJMP')) {
      logMessage(`<span class="log-step">Такт ${n}:</span> ${cmd} → <span class="log-info">цикл начинается заново</span>`);
    }
  }

  function updateUI() {
    tickInfo.textContent = `Такт ${state.tick} · PC=${toHex4(state.pc)}`;
    fetchCode.textContent   = PROGRAM[(state.pc + 1) % N_PROG].cmd;
    decodeCode.textContent  = PROGRAM[state.pc].cmd;
    executeCode.textContent = state.lastExecuted >= 0 ? PROGRAM[state.lastExecuted].cmd : '—';

    ddrbVal.textContent = toHex(state.ddrb);
    ddrbBin.textContent = toBin8(state.ddrb);
    portbVal.textContent = toHex(state.portb);
    portbBin.textContent = toBin8(state.portb);
    tcnt0Val.textContent = state.tcnt0;
    tcnt0Bin.textContent = toBin8(state.tcnt0);
    ocr0aVal.textContent = state.ocr0a;
    ocr0aBin.textContent = toBin8(state.ocr0a);
    r16Val.textContent = toHex(state.r16);

    flashFill.style.width  = Math.min(100, (state.flashUsed / 1024) * 100) + '%';
    flashCount.textContent = state.flashUsed + ' / 1024';
    sramFill.style.width   = Math.min(100, (state.sramUsed / 64) * 100) + '%';
    sramCount.textContent  = state.sramUsed + ' / 64';
    eepromFill.style.width = Math.min(100, (state.eepromUsed / 64) * 100) + '%';
    eepromCount.textContent = state.eepromUsed + ' / 64';

    led.classList.toggle('on', state.ledOn);
    ledState.textContent = state.ledOn ? 'ВКЛ 🔴' : 'ВЫКЛ ⚫';
  }

  function stopAuto() {
    if (state.intervalId) { clearInterval(state.intervalId); state.intervalId = null; }
    state.running = false;
    state.paused = false;
  }

  function startAuto() {
    if (state.running) return;
    state.running = true;
    state.paused = false;
    const delay = FREQ_PRESETS[state.freqIndex].delay;
    state.intervalId = setInterval(doStep, delay);
    logMessage(`<span class="log-info">▶ Авто-режим · частота ${FREQ_PRESETS[state.freqIndex].label}</span>`);
  }

  /* ═══════ КНОПКА «ТАКТ» ═══════ */
  function onStepClick() {
    const wasRunning = state.running;
    if (wasRunning) stopAuto();
    doStep();

    stepBtn.classList.remove('flash');
    void stepBtn.offsetWidth;
    stepBtn.classList.add('flash');
    setTimeout(() => stepBtn.classList.remove('flash'), 260);

    if (wasRunning) {
      logMessage('<span class="log-info">⏸ Генератор остановлен — ручной режим (1 такт за клик)</span>');
    }
  }

  function onPauseClick() {
    if (!state.running) return;
    state.paused = !state.paused;
    if (state.paused) {
      clearInterval(state.intervalId); state.intervalId = null;
      logMessage('<span class="log-info">⏸ Пауза</span>');
    } else {
      state.intervalId = setInterval(doStep, FREQ_PRESETS[state.freqIndex].delay);
      logMessage('<span class="log-info">▶ Продолжение</span>');
    }
  }

  function onResetClick() {
    stopAuto();
    Object.assign(state, {
      pc: 0, lastExecuted: -1, tick: 0, r16: 0, ddrb: 0, portb: 0,
      tcnt0: 0, ocr0a: 0, ledOn: false,
      flashUsed: 42, sramUsed: 6, eepromUsed: 0
    });
    regDDRB.classList.remove('highlight');
    regPORTB.classList.remove('highlight');
    updateUI();
    logMessage('<span class="log-info">⟲ Сброс. Система готова. PC=0x0000</span>');
  }

  function onFreqChange() {
    state.freqIndex = parseInt(freqSlider.value, 10);
    freqDisplay.textContent = FREQ_PRESETS[state.freqIndex].label;
    if (state.running && !state.paused) {
      clearInterval(state.intervalId);
      state.intervalId = setInterval(doStep, FREQ_PRESETS[state.freqIndex].delay);
      logMessage(`<span class="log-info">⏱️ Частота: ${FREQ_PRESETS[state.freqIndex].label}</span>`);
    }
  }

  stepBtn.addEventListener('click', onStepClick);
  startBtn.addEventListener('click', startAuto);
  pauseBtn.addEventListener('click', onPauseClick);
  resetBtn.addEventListener('click', onResetClick);
  freqSlider.addEventListener('input', onFreqChange);

  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); onStepClick(); }
  });

  updateUI();
  onFreqChange();
})();