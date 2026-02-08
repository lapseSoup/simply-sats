const params = new URLSearchParams(window.location.search);
const src = params.get('src');
const img = document.getElementById('img');
const container = document.getElementById('container');
const zoomLabel = document.getElementById('zoom-level');

let scale = 1;
let panX = 0, panY = 0;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let panStart = { x: 0, y: 0 };

function updateTransform() {
  img.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  zoomLabel.textContent = Math.round(scale * 100) + '%';
}

function zoomIn() { scale = Math.min(scale * 1.25, 20); updateTransform(); }
function zoomOut() { scale = Math.max(scale / 1.25, 0.1); updateTransform(); }
function zoomReset() { scale = 1; panX = 0; panY = 0; updateTransform(); }

document.getElementById('zoom-in').addEventListener('click', zoomIn);
document.getElementById('zoom-out').addEventListener('click', zoomOut);
document.getElementById('zoom-reset').addEventListener('click', zoomReset);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === '=' || e.key === '+') zoomIn();
  else if (e.key === '-') zoomOut();
  else if (e.key === '0') zoomReset();
});

// Mouse wheel zoom
container.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.deltaY < 0) zoomIn();
  else zoomOut();
}, { passive: false });

// Pan with drag
container.addEventListener('mousedown', (e) => {
  if (scale <= 1) return;
  isDragging = true;
  container.classList.add('dragging');
  dragStart = { x: e.clientX, y: e.clientY };
  panStart = { x: panX, y: panY };
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  panX = panStart.x + (e.clientX - dragStart.x);
  panY = panStart.y + (e.clientY - dragStart.y);
  updateTransform();
});

document.addEventListener('mouseup', () => {
  isDragging = false;
  container.classList.remove('dragging');
});

if (src) {
  img.src = src;
}
