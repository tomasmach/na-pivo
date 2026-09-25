// The store matching the visitor's phone gets the single amber surface; desktop defaults to iPhone.
(function () {
  const android = /Android/i.test(navigator.userAgent);
  document.querySelectorAll('.stores').forEach((group) => {
    const ios = group.querySelector('[data-store="ios"]');
    const play = group.querySelector('[data-store="android"]');
    if (!ios || !play) return;
    const primary = android ? play : ios;
    primary.classList.add('is-primary');
    group.prepend(primary);
  });
})();
