(function () {
  "use strict";
  // A link to the app leads to the App Store; an Android phone gets Google Play instead.
  if (/Android/i.test(navigator.userAgent)) {
    document.querySelectorAll("a[data-play]").forEach(function (link) {
      link.href = link.getAttribute("data-play");
    });
  }

  // Share a public page: the phone's share sheet, or the link copied on a computer.
  document.querySelectorAll("[data-share]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var url = button.getAttribute("data-share");
      try {
        if (navigator.share) {
          await navigator.share({ title: document.title, url: url });
          return;
        }
        await navigator.clipboard.writeText(url);
        button.querySelector("span").textContent = button.getAttribute("data-copied");
      } catch (e) {
        // Closing the share sheet rejects too; nothing to tell.
      }
    });
  });
})();
