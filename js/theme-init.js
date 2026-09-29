// Aplica o tema salvo antes de desenhar a página (evita piscar).
try { const t = localStorage.getItem('hub.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* sem armazenamento */ }
