// Title-screen embers. Kept external so the CSP can forbid inline scripts.
(function () {
  const box = document.getElementById('tembers');
  if (!box) return;
  for (let i = 0; i < 18; i++) {
    const ember = document.createElement('i');
    const size = 2 + Math.random() * 4;
    ember.style.left = (Math.random() * 100) + '%';
    ember.style.width = ember.style.height = size + 'px';
    ember.style.animationDuration = (5 + Math.random() * 8) + 's';
    ember.style.animationDelay = (Math.random() * -12) + 's';
    box.appendChild(ember);
  }
})();
