(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var checkbox = document.getElementById('lang-checkbox');
    var flagIndicator = document.getElementById('flag-indicator');
    var ptLabel = document.querySelector('.lang-pt');
    var enLabel = document.querySelector('.lang-en');

    if (!checkbox) return;

    var currentLang = localStorage.getItem('blog-language') || 'pt';
    var isEnglish = currentLang === 'en';

    checkbox.checked = isEnglish;
    if (flagIndicator) flagIndicator.textContent = isEnglish ? '🇺🇸' : '🇧🇷';
    if (ptLabel) ptLabel.classList.toggle('active', !isEnglish);
    if (enLabel) enLabel.classList.toggle('active', isEnglish);

    checkbox.addEventListener('change', function() {
      var showEnglish = this.checked;
      var targetLang = showEnglish ? 'en' : 'pt';

      if (flagIndicator) flagIndicator.textContent = showEnglish ? '🇺🇸' : '🇧🇷';
      if (ptLabel) ptLabel.classList.toggle('active', !showEnglish);
      if (enLabel) enLabel.classList.toggle('active', showEnglish);

      localStorage.setItem('blog-language', targetLang);

      var isPostPage = document.body.getAttribute('data-layout') === 'post';
      var postLang = document.body.getAttribute('data-lang');

      if (isPostPage && postLang && postLang !== targetLang) {
        window.location.href = '/';
        return;
      }

      var posts = document.querySelectorAll('.post-item');
      posts.forEach(function(post) {
        var lang = post.getAttribute('data-lang');
        if (lang === targetLang) {
          post.classList.remove('post-hidden');
        } else {
          post.classList.add('post-hidden');
        }
      });
    });

    if (document.querySelectorAll('.post-item').length > 0) {
      checkbox.dispatchEvent(new Event('change'));
    }
  });
})();
