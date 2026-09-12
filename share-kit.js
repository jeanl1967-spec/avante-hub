// ---------- Share Kit modal (shared square image + per-platform caption) ----------
// Shared by every "Get Shareable Content" button on admin.html and
// hub.html — previously two verbatim copies of this exact file, which
// meant any fix or tweak (platform dimensions, the caption format, a bug
// in the crop math) had to be applied identically in both places to
// avoid the two Share Kit experiences silently drifting apart. Now
// there's one copy, loaded by both via <script src="share-kit.js">.
//
// We used to crop the hook's flyer to each platform's own "ideal" frame
// (1200x630 for Facebook, 1080x1920 for WhatsApp, etc.) client-side. That
// actively backfired: Facebook, Instagram, WhatsApp and LinkedIn all
// re-fit/re-crop whatever image you upload to their own feed/story
// display shape anyway, so our pre-crop and their crop fought each
// other — most visibly on Facebook/LinkedIn's wide 1.9:1 frame, where a
// tall flyer became a thin sliver surrounded by white bars, which
// Facebook's own crop would then chew into unpredictably. The fix isn't
// a smarter crop, it's not cropping at all: hooks are now uploaded as a
// standard 1080x1080 square (see the "Upload image" hint on each hook
// card), and every platform tab here just shows that same square,
// untouched — sizing it for its own feed is each platform's job, not
// ours. Only the caption + hashtags still vary per platform.
//
// Depends on the page it's loaded from already defining a global
// showToast(message) function, and rendering the Share Kit modal markup
// with these exact element ids: shareKitModalOverlay, shareKitTabs,
// shareKitCanvasWrap, shareKitDims, shareKitCaption, shareKitCopyBtn,
// shareKitDownloadBtn, shareKitCloseBtn, shareKitTitle.
(function(){
  var PLATFORMS = [
    { id: 'facebook', label: 'Facebook' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'linkedin', label: 'LinkedIn' }
  ];
  var EXPORT_SIZE = 1080; // matches the standard square upload size — see hint text on "Upload image"
  var DISPLAY_W = 220; // px shown in the modal — canvas stays full-res for download

  var overlay = document.getElementById('shareKitModalOverlay');
  if(!overlay) return;
  var tabsEl = document.getElementById('shareKitTabs');
  var canvasWrap = document.getElementById('shareKitCanvasWrap');
  var dimsEl = document.getElementById('shareKitDims');
  var captionEl = document.getElementById('shareKitCaption');
  var copyBtn = document.getElementById('shareKitCopyBtn');
  var downloadBtn = document.getElementById('shareKitDownloadBtn');
  var closeBtn = document.getElementById('shareKitCloseBtn');
  var titleEl = document.getElementById('shareKitTitle');

  var currentImg = null;
  var currentPlatform = PLATFORMS[0];
  var currentCanvas = null;
  var currentCaption = '';
  var currentLink = '';
  var currentLinkLabel = '';
  var currentHashtags = null; // { facebook: [...], instagram: [...], whatsapp: [], linkedin: [...] } | null

  function drawToCanvas(img){
    var size = EXPORT_SIZE;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    if(img){
      // Hooks are uploaded as a 1080x1080 square, so this is normally a
      // straight draw at native size. Older hooks uploaded before that
      // standard still get a graceful "contain" fit into the square
      // (never cropped) rather than distorted or clipped.
      var sw = img.naturalWidth, sh = img.naturalHeight;
      var scale = Math.min(size / sw, size / sh);
      var dw = sw * scale, dh = sh * scale;
      var dx = (size - dw) / 2, dy = (size - dh) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, sw, sh, dx, dy, dw, dh);
    }else{
      ctx.fillStyle = '#f4fbfa';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#808080';
      ctx.font = '600 ' + Math.round(size * 0.045) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No image uploaded yet', size / 2, size / 2);
    }
    return canvas;
  }

  function renderPlatform(platform){
    currentPlatform = platform;
    // The image itself no longer varies by platform — only the caption
    // does — so redraw only when there isn't already a canvas for the
    // current image.
    if(!currentCanvas){
      currentCanvas = drawToCanvas(currentImg);
    }
    var canvas = currentCanvas;
    canvas.style.width = DISPLAY_W + 'px';
    canvas.style.height = 'auto';
    canvasWrap.innerHTML = '';
    canvasWrap.appendChild(canvas);
    dimsEl.textContent = EXPORT_SIZE + ' × ' + EXPORT_SIZE + 'px — same image for every platform; ' + platform.label + ' fits it to its own feed once posted.';

    var btns = tabsEl.querySelectorAll('.sharekit-tab');
    for(var i = 0; i < btns.length; i++){
      btns[i].classList.toggle('active', btns[i].getAttribute('data-platform') === platform.id);
    }

    // Caption is rebuilt per platform: same base caption + link, but
    // each platform gets its own AI-suggested hashtag set (WhatsApp
    // intentionally gets none — hashtags aren't a WhatsApp convention).
    var tags = (currentHashtags && currentHashtags[platform.id]) || [];
    captionEl.value = buildCaptionText(currentCaption, tags, currentLink, currentLinkLabel);
  }

  function buildCaptionText(caption, hashtags, link, linkLabel){
    var lines = [];
    lines.push(caption || '(No caption written yet — add one above and reopen this.)');
    if(hashtags && hashtags.length){
      lines.push('');
      lines.push(hashtags.map(function(t){ return '#' + t; }).join(' '));
    }
    if(link){
      lines.push('');
      lines.push((linkLabel || 'Link') + ': ' + link);
    }
    return lines.join('\n');
  }

  tabsEl.addEventListener('click', function(e){
    var id = e.target.getAttribute('data-platform');
    if(!id) return;
    for(var i = 0; i < PLATFORMS.length; i++){
      if(PLATFORMS[i].id === id){ renderPlatform(PLATFORMS[i]); break; }
    }
  });

  copyBtn.addEventListener('click', function(){
    var text = captionEl.value;
    function fallback(){
      captionEl.focus();
      captionEl.select();
      var ok = false;
      try{ ok = document.execCommand('copy'); }catch(e){ ok = false; }
      showToast(ok ? 'Caption copied to your clipboard' : 'Caption selected — press Ctrl/Cmd+C to copy');
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){
        showToast('Caption copied to your clipboard');
      }).catch(fallback);
    }else{
      fallback();
    }
  });

  downloadBtn.addEventListener('click', function(){
    if(!currentCanvas) return;
    currentCanvas.toBlob(function(blob){
      if(!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'avante-' + currentPlatform.id + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
    }, 'image/png');
  });

  closeBtn.addEventListener('click', function(){ overlay.classList.remove('show'); });
  overlay.addEventListener('click', function(e){ if(e.target === overlay) overlay.classList.remove('show'); });

  // opts: { title, imageUrl, caption, hashtags, link, linkLabel }
  window.openShareKit = function(opts){
    opts = opts || {};
    titleEl.textContent = opts.title || 'Shareable Content';
    currentCaption = opts.caption || '';
    currentLink = opts.link || '';
    currentLinkLabel = opts.linkLabel || '';
    currentHashtags = opts.hashtags || null;
    currentImg = null;
    currentCanvas = null;
    currentPlatform = PLATFORMS[0];
    overlay.classList.add('show');

    var tabsHtml = '';
    PLATFORMS.forEach(function(p){
      tabsHtml += '<button type="button" class="sharekit-tab" data-platform="' + p.id + '">' + p.label + '</button>';
    });
    tabsEl.innerHTML = tabsHtml;
    renderPlatform(currentPlatform);

    if(opts.imageUrl){
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function(){ currentImg = img; currentCanvas = null; renderPlatform(currentPlatform); };
      img.onerror = function(){ currentImg = null; currentCanvas = null; renderPlatform(currentPlatform); };
      img.src = opts.imageUrl;
    }
  };
})();
