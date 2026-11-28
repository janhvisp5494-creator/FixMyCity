/* Whole-site translation: language dropdown + Google Website Translator (loaded lazily).
   Built-in curated strings (app.js I18N) are used for hi and gu; every other language
   keeps built-in "en" and relies on the widget. */
(function () {
  "use strict";
  var LANGS = [
    ["en", "English", "English"],
    // Indian languages
    ["hi", "हिन्दी", "Hindi"], ["gu", "ગુજરાતી", "Gujarati"], ["mr", "मराठी", "Marathi"], ["bn", "বাংলা", "Bengali"],
    ["ta", "தமிழ்", "Tamil"], ["te", "తెలుగు", "Telugu"], ["kn", "ಕನ್ನಡ", "Kannada"], ["ml", "മലയാളം", "Malayalam"],
    ["pa", "ਪੰਜਾਬੀ", "Punjabi"], ["or", "ଓଡ଼ିଆ", "Odia"], ["ur", "اردو", "Urdu"], ["as", "অসমীয়া", "Assamese"],
    ["ne", "नेपाली", "Nepali"], ["sd", "سنڌي", "Sindhi"], ["kok", "कोंकणी", "Konkani"], ["mai", "मैथिली", "Maithili"],
    ["doi", "डोगरी", "Dogri"], ["si", "සිංහල", "Sinhala"],
    // World languages
    ["es", "Español", "Spanish"], ["fr", "Français", "French"], ["de", "Deutsch", "German"], ["pt", "Português", "Portuguese"],
    ["it", "Italiano", "Italian"], ["ru", "Русский", "Russian"], ["zh-CN", "中文(简体)", "Chinese Simplified"], ["zh-TW", "中文(繁體)", "Chinese Traditional"],
    ["ja", "日本語", "Japanese"], ["ko", "한국어", "Korean"], ["ar", "العربية", "Arabic"], ["tr", "Türkçe", "Turkish"],
    ["id", "Bahasa Indonesia", "Indonesian"], ["vi", "Tiếng Việt", "Vietnamese"], ["th", "ไทย", "Thai"], ["nl", "Nederlands", "Dutch"],
    ["pl", "Polski", "Polish"], ["sv", "Svenska", "Swedish"], ["el", "Ελληνικά", "Greek"], ["iw", "עברית", "Hebrew"],
    ["tl", "Filipino", "Filipino"], ["sw", "Kiswahili", "Swahili"], ["ms", "Bahasa Melayu", "Malay"], ["uk", "Українська", "Ukrainian"],
    ["ro", "Română", "Romanian"], ["cs", "Čeština", "Czech"], ["hu", "Magyar", "Hungarian"], ["fa", "فارسی", "Persian"],
    ["da", "Dansk", "Danish"], ["fi", "Suomi", "Finnish"], ["no", "Norsk", "Norwegian"], ["bg", "Български", "Bulgarian"],
    ["hr", "Hrvatski", "Croatian"], ["sk", "Slovenčina", "Slovak"], ["sl", "Slovenščina", "Slovenian"], ["sr", "Српски", "Serbian"],
    ["lt", "Lietuvių", "Lithuanian"], ["lv", "Latviešu", "Latvian"], ["et", "Eesti", "Estonian"], ["af", "Afrikaans", "Afrikaans"],
    ["ca", "Català", "Catalan"], ["my", "မြန်မာ", "Burmese"], ["km", "ខ្មែរ", "Khmer"], ["am", "አማርኛ", "Amharic"],
    ["zu", "isiZulu", "Zulu"], ["ha", "Hausa", "Hausa"], ["yo", "Yorùbá", "Yoruba"], ["ps", "پښتو", "Pashto"]
  ];
  var RTL = { ar: 1, iw: 1, he: 1, ur: 1, fa: 1, sd: 1, ps: 1 };
  var BUILTIN = { hi: 1, gu: 1 };
  var CONTAINER = "fmc_gt_element";
  var known = {};
  LANGS.forEach(function (l) { known[l[0]] = 1; });

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  var saved = lsGet("fmc_lang");
  var current = known[saved] ? saved : "en";
  var widgetLoaded = false, loading = false;

  function builtinOf(code) { return BUILTIN[code] ? code : "en"; }
  function applyDoc(code) {
    var el = document.documentElement;
    el.lang = code === "iw" ? "he" : code;
    el.dir = RTL[code] ? "rtl" : "ltr";
  }
  function cookieVariants(clear, value) {
    var host = location.hostname, exp = clear ? "; expires=Thu, 01 Jan 1970 00:00:00 GMT" : "";
    var v = clear ? "" : value;
    var base = "googtrans=" + v + exp + "; path=/";
    var list = [base];
    if (host.indexOf(".") > 0 && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) { list.push(base + "; domain=" + host); list.push(base + "; domain=." + host); }
    list.forEach(function (c) { try { document.cookie = c; } catch (e) { /* ignore */ } });
  }
  function setCookie(code) { cookieVariants(false, "/en/" + code); }
  function clearCookie() { cookieVariants(true); }

  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg; t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 4500);
  }

  function ensureContainer() {
    var c = document.getElementById(CONTAINER);
    if (!c) {
      c = document.createElement("div");
      c.id = CONTAINER; c.className = "notranslate"; c.setAttribute("translate", "no"); c.setAttribute("aria-hidden", "true");
      document.body.appendChild(c);
    }
    return c;
  }

  function loadWidget(done) {
    if (widgetLoaded) { done && done(true); return; }
    if (loading) { return; }
    loading = true;
    ensureContainer();
    window.fmcTranslateInit = function () {
      try {
        new window.google.translate.TranslateElement({ pageLanguage: "en", autoDisplay: false }, CONTAINER);
        widgetLoaded = true;
      } catch (e) { console.warn("Translate init failed", e); }
      loading = false;
      done && done(widgetLoaded);
    };
    var s = document.createElement("script");
    s.src = "https://translate.google.com/translate_a/element.js?cb=fmcTranslateInit";
    s.async = true;
    s.onerror = function () {
      loading = false;
      toast("Could not load the translator. Check your connection or ad blocker and try again.");
      done && done(false);
    };
    document.head.appendChild(s);
  }

  // Ask the widget to switch language (retry until its hidden combo exists).
  function applyCombo(code, tries) {
    var combo = document.querySelector("select.goog-te-combo");
    if (combo) {
      combo.value = code;
      if (combo.value !== code) { // not offered by the widget
        toast("This language is not available for automatic translation.");
        return;
      }
      combo.dispatchEvent(new Event("change"));
      return;
    }
    if ((tries || 0) > 40) { toast("Translation did not start. Please check your connection and try again."); return; }
    setTimeout(function () { applyCombo(code, (tries || 0) + 1); }, 250);
  }

  // Mark things that must never be translated (map, charts, codes, inputs).
  var NO_SEL = ".leaflet-container, .map, #map, canvas, code, pre, input, textarea, [data-notranslate], a[href^='mailto:'], .brand span, #langSel";
  function markNo(root) {
    var list;
    try { list = (root.querySelectorAll ? root : document).querySelectorAll(NO_SEL); } catch (e) { return; }
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.getAttribute("translate") !== "no") { n.setAttribute("translate", "no"); n.classList.add("notranslate"); }
    }
  }
  function watchDom() {
    markNo(document);
    if (!window.MutationObserver) return;
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 1) {
            if (n.matches && n.matches(NO_SEL) && n.getAttribute("translate") !== "no") { n.setAttribute("translate", "no"); n.classList.add("notranslate"); }
            markNo(n);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  function selectHtml() {
    return '<select class="lang notranslate" translate="no" id="langSel" aria-label="Language" title="Language">' +
      LANGS.map(function (l) {
        return '<option value="' + l[0] + '"' + (l[0] === current ? " selected" : "") + ">" + l[1] + (l[0] === "en" ? "" : " · " + l[2]) + "</option>";
      }).join("") + "</select>";
  }
  // Call after the nav markup is in the DOM.
  function bindSelect() {
    var sel = document.getElementById("langSel");
    if (sel) sel.onchange = function () { choose(sel.value); };
  }

  function choose(code) {
    if (!known[code]) code = "en";
    var prev = current;
    if (code === prev) return;
    current = code;
    lsSet("fmc_lang", code);
    applyDoc(code);
    if (code === "en") { clearCookie(); location.reload(); return; }
    setCookie(code);
    if (builtinOf(code) !== builtinOf(prev) || prev === "en" && BUILTIN[code]) { location.reload(); return; }
    if (widgetLoaded) applyCombo(code, 0);
    else loadWidget(function (ok) { if (ok) applyCombo(code, 0); });
  }

  // Page load.
  applyDoc(current);
  if (current !== "en") setCookie(current);
  function boot() {
    watchDom();
    if (current !== "en") loadWidget();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  window.FMC_LANG = { current: current, builtin: builtinOf(current), selectHtml: selectHtml, bindSelect: bindSelect, choose: choose, languages: LANGS };
})();
