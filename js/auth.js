import { CONFIG } from './config.js';

let pinBuffer        = '';
let _onAuthenticated = null;

export async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isConfigValid() {
  return (
    CONFIG.SUPABASE_URL &&
    CONFIG.SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL' &&
    CONFIG.SUPABASE_ANON_KEY &&
    CONFIG.SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY'
  );
}

// onAuthenticated is called once the correct PIN is entered.
// Passing it as a callback avoids a circular dependency with main.js.
export async function initPin(onAuthenticated) {
  _onAuthenticated = onAuthenticated;
  const screen = document.getElementById('pin-screen');
  screen.classList.remove('hidden');

  document.querySelectorAll('.pin-key[data-key]').forEach(btn => {
    btn.addEventListener('click', () => handlePinKey(btn.dataset.key));
  });

  document.getElementById('pin-back').addEventListener('click', () => {
    if (pinBuffer.length > 0) {
      pinBuffer = pinBuffer.slice(0, -1);
      updatePinDots();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (screen.classList.contains('hidden')) return;
    if (e.key >= '0' && e.key <= '9') handlePinKey(e.key);
    else if (e.key === 'Backspace') {
      pinBuffer = pinBuffer.slice(0, -1);
      updatePinDots();
    }
  });
}

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('dot-' + i);
    if (dot) dot.classList.toggle('filled', i < pinBuffer.length);
  }
}

async function handlePinKey(digit) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += digit;
  updatePinDots();

  if (pinBuffer.length === 4) {
    const hash = await hashPin(pinBuffer);
    if (hash === CONFIG.PIN_HASH) {
      sessionStorage.setItem('auth', '1');
      document.getElementById('pin-screen').classList.add('hidden');
      if (_onAuthenticated) _onAuthenticated();
    } else {
      const keypad = document.getElementById('pin-keypad');
      keypad.classList.add('shake');
      keypad.addEventListener('animationend', () => keypad.classList.remove('shake'), { once: true });
      pinBuffer = '';
      setTimeout(updatePinDots, 50);
    }
  }
}
