// Sito pubblico: menu mobile e immagini di riserva
(function () {
  var btn = document.querySelector('.menu-toggle');
  var nav = document.getElementById('main-nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) { if (e.target.tagName === 'A') { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  }
  // Se un'immagine non si carica mostra uno sfondo elegante al suo posto
  function fail(el) {
    if (el.classList.contains('img-fallback')) return;
    el.classList.add('img-fallback');
    if (el.parentElement) el.parentElement.classList.add('img-fallback-box');
  }
  document.addEventListener('error', function (e) { if (e.target && e.target.tagName === 'IMG') fail(e.target); }, true);
  // immagini già fallite prima del caricamento di questo script
  Array.prototype.forEach.call(document.images, function (img) { if (img.complete && !img.naturalWidth) fail(img); });
})();
