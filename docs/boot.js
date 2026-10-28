/* تشغيل البرنامج بعد تحميل الصفحة */
window.addEventListener('DOMContentLoaded', function () {
  window.EV.boot().catch(function (e) {
    console.error(e);
    var box = document.createElement('div'); box.className = 'setup';
    box.innerHTML = '<div class="setup-card"><h1>تعذر تشغيل البرنامج</h1><p></p></div>';
    box.querySelector('p').textContent = (e && e.message) || String(e);
    var app = document.getElementById('app'); app.innerHTML = ''; app.appendChild(box);
  });
});
