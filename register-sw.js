(function () {
  var h = location.hostname;
  var ok = location.protocol === 'https:' || h === 'localhost' || h === '127.0.0.1';
  if (!('serviceWorker' in navigator) || !ok) return;
  window.addEventListener('load', function () {
    // Relative path so it also works when the site is deployed under a sub-path.
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  });
})();
