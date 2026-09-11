// Shared by admin.html (Default Hooks) and hub.html (Affiliate Marketing) —
// the pure, stateless pieces of the "Upload PDF instead of a Landing page
// link" feature: what the URL looks like, how to parse one back out, and
// what counts as a PDF file. Kept as one shared definition specifically
// because these two pages already had independently-written copies of
// this logic drift apart once — admin.html's parseHookPdfUrl correctly
// required the parsed aff to match its own ADMIN_AFF, while hub.html's
// version (written in the same original commit) had no equivalent
// ownership check at all, opening a real cross-affiliate delete
// vulnerability that a later fix had to close by hand. A single shared
// definition means a fix to one of these functions is a fix to both pages
// at once, not something that can silently apply to only one.
//
// Deliberately NOT shared: the surrounding upload/delete functions
// themselves (uploadHookPdf/deleteHookPdf and their admin equivalents) —
// those differ enough in real ways (how affId is derived, DOM id prefixes,
// "Save hook" vs "Save default" wording, sibling-hook scanning) that each
// page still owns its own version, built on top of these shared pieces.
window.PdfLinkTool = (function(){
  var PDF_MAX_BYTES = 10 * 1024 * 1024; // 10MB

  // The exact URL a hook's Landing page link points to once a PDF has
  // been uploaded for it.
  function hookPdfUrl(aff, hook){
    return window.location.origin + '/api/hook-pdf?aff=' + encodeURIComponent(aff) + '&hook=' + encodeURIComponent(hook);
  }

  // If url is one of our own hook-pdf links, returns the exact {aff, hook}
  // it points at (parsed from its own query string, never assumed from
  // surrounding context) — otherwise null. Callers MUST check the
  // returned aff against whichever identity they trust (their own affId,
  // or ADMIN_AFF) before treating it as permission to do anything —
  // this function only parses, it never authorizes. A hook-pdf link is
  // inherently public (it's the exact URL meant to be shared with
  // customers as the hook's own Landing page link), so a parsed result
  // belonging to someone else must never be trusted as consent from them.
  function parseHookPdfUrl(url){
    try{
      var u = new URL(url, window.location.href);
      if(u.origin !== window.location.origin || u.pathname !== '/api/hook-pdf') return null;
      var aff = u.searchParams.get('aff');
      var hook = u.searchParams.get('hook');
      if(!aff || !hook) return null;
      return { aff: aff, hook: hook };
    }catch(e){
      return null;
    }
  }

  // file.type comes from the browser/OS and isn't always reliable — some
  // mobile share-sheet/scanner flows and file managers hand over a real
  // PDF with an empty or generic type (e.g. application/octet-stream).
  // Accept either a correctly-reported type or a .pdf filename; the
  // server's own magic-byte check (hook-pdf.js) is the real,
  // authoritative gate either way.
  function isPdfFile(file){
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  }

  return {
    PDF_MAX_BYTES: PDF_MAX_BYTES,
    hookPdfUrl: hookPdfUrl,
    parseHookPdfUrl: parseHookPdfUrl,
    isPdfFile: isPdfFile
  };
})();
