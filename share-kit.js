// ---------- Share Kit modal (per-platform sized image + caption) ----------
// Shared by every "Get Shareable Content" button on admin.html and
// hub.html — previously two verbatim copies of this exact file, which
// meant any fix or tweak (platform dimensions, the caption format, a bug
// in cropToCanvas's aspect-ratio math) had to be applied identically in
// both places to avoid the two Share Kit experiences silently drifting
// apart. Now there's one copy, loaded by both via <script src="share-kit.js">.
//
// Crops the hook's flyer to each platform's ideal aspect ratio
// client-side (a plain <canvas> centre-crop, same idea as CSS
// object-fit:cover) so nothing new needs to be uploaded or stored — the
// crop and the caption are just a presentation of the one image + caption
// already saved on the hook (admin's default, or an affiliate's own,
// whichever page this script is loaded from).
//
// Depends on the page it's loaded from already defining a global
// showToast(message) function, and rendering the Share Kit modal markup
// with these exact element ids: shareKitModalOverlay, shareKitTabs,
// shareKitCanvasWrap, shareKitDims, shareKitCaption, shareKitCopyBtn,
// shareKitDownloadBtn, shareKitCloseBtn, shareKitTitle.
(function(){
  var PLATFORMS = [
    { id: 'facebook', label: 'Facebook', w: 1200, h: 630 },
    { id: 'instagram', label: 'Instagram', w: 1080, h: 1080 },
    { id: 'whatsapp', label: 'WhatsApp', w: 1080, h: 1920 },
    { id: 'linkedin', label: 'LinkedIn', w: 1200, h: 627 }
  ];
  var DISPLAY_W = 220; // px shown in the modal — canvases stay full-res for download

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

  function cropToCanvas(img, w, h){
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    if(img){
      // Fit the whole flyer inside the platform frame (like CSS
      // object-fit:contain) rather than center-cropping it to fill the
      // frame — our source images are flyers with price/detail text right
      // up to the edges, and a hard crop was cutting that text off instead
      // of just resizing it in. Any leftover strip (the source and target
      // aspect ratios rarely match exactly) is filled with white behind it.
      var sw = img.naturalWidth, sh = img.naturalHeight;
      var scale = Math.min(w / sw, h / sh);
      var dw = sw * scale, dh = sh * scale;
      var dx = (w - dw) / 2, dy = (h - dh) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, sw, sh, dx, dy, dw, dh);
    }else{
      ctx.fillStyle = '#f4fbfa';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#808080';
      ctx.font = '600 ' + Math.round(w * 0.045) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No image uploaded yet', w / 2, h / 2);
    }
    return canvas;
  }

  function renderPlatform(platform){
    currentPlatform = platform;
    var canvas = cropToCanvas(currentImg, platform.w, platform.h);
    currentCanvas = canvas;
    var displayW = platform.w >= platform.h ? DISPLAY_W : Math.round(DISPLAY_W * platform.w / platform.h);
    canvas.style.width = displayW + 'px';
    canvas.style.height = 'auto';
    canvasWrap.innerHTML = '';
    canvasWrap.appendChild(canvas);
    dimsEl.textContent = platform.w + ' × ' + platform.h + 'px — ' + platform.label;

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
      img.onload = function(){ currentImg = img; renderPlatform(currentPlatform); };
      img.onerror = function(){ currentImg = null; renderPlatform(currentPlatform); };
      img.src = opts.imageUrl;
    }
  };
})();
