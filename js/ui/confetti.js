export function launchConfetti() {
  const container = document.getElementById('confetti-container');
  container.innerHTML = '';
  const colors = ['#6ee7b7', '#fbbf24', '#a78bfa', '#60a5fa', '#fb923c', '#f87171'];

  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const x     = Math.random() * 100;
    const dx    = (Math.random() - 0.5) * 120;
    const rot   = Math.random() * 720 - 360;
    const dur   = 0.9 + Math.random() * 0.8;
    const delay = Math.random() * 0.4;
    piece.style.cssText = `
      left: ${x}%;
      top: -10px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      --dx: ${dx}px;
      --rot: ${rot}deg;
      --dur: ${dur}s;
      --delay: ${delay}s;
      width: ${6 + Math.random() * 6}px;
      height: ${6 + Math.random() * 6}px;
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
    `;
    container.appendChild(piece);
  }

  setTimeout(() => { container.innerHTML = ''; }, 2500);
}
