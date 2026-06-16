import { useState, useEffect, useRef } from 'react';
import { Loader2, Video } from 'lucide-react';

// ─── YouTube Embed (With API Error Handling) ───────────────

interface YouTubeEmbedProps {
  url: string;
  startSeconds?: number;
  onError: (msg: string, code?: number) => void;
}

export function YouTubeEmbed({ url, startSeconds, onError }: YouTubeEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);

  // Store transient parameters in refs to prevent triggering full player reinitializations
  const onErrorRef = useRef(onError);
  const startSecondsRef = useRef(startSeconds);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    startSecondsRef.current = startSeconds;
  }, [startSeconds]);

  useEffect(() => {
    let mounted = true;

    const getPlayer = () => {
      let id = '';
      if (url.includes('v=')) id = url.split('v=')[1]?.split('&')[0];
      else if (url.includes('youtu.be/')) id = url.split('youtu.be/')[1]?.split('?')[0];

      if (!id) {
        onErrorRef.current("Invalid YouTube URL. Could not extract video ID.");
        setLoading(false);
        return;
      }

      if (!(window as any).YT || !(window as any).YT.Player) return;

      playerRef.current = new (window as any).YT.Player(containerRef.current, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: {
          start: Math.floor(startSecondsRef.current || 0),
          rel: 0,
          modestbranding: 1,
          origin: window.location.protocol === 'file:' ? 'https://www.youtube.com' : window.location.origin,
        },
        events: {
          onReady: () => { if (mounted) setLoading(false); },
          onError: (e: any) => {
            if (!mounted) return;
            setLoading(false);
            const code = e.data;
            let msg = "The video could not be played.";
            if (code === 2) msg = "Invalid video ID parameter.";
            if (code === 5) msg = "The requested content cannot be played in an HTML5 player.";
            if (code === 100) msg = "Video not found (removed or private).";
            if (code === 101 || code === 150) msg = "The owner of this video does not allow embedding.";
            onErrorRef.current(msg, code);
          }
        }
      });
    };

    if (!(window as any).YT) {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

      // Define global callback if not present
      (window as any).onYouTubeIframeAPIReady = () => {
        // This might fire multiple times if multiple instances exist, 
        // so we check if the global promise is resolved or similar.
      };
    }

    // Polling is often safer in React for this particular API
    const checkApi = setInterval(() => {
      if ((window as any).YT && (window as any).YT.Player && !playerRef.current) {
        clearInterval(checkApi);
        getPlayer();
      }
    }, 200);

    return () => {
      mounted = false;
      clearInterval(checkApi);
      if (playerRef.current?.destroy) playerRef.current.destroy();
    };
  }, [url]);

  return (
    <div className="w-full h-full relative bg-black rounded-lg overflow-hidden">
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-dim z-10">
          <div className="relative">
            <div className="w-12 h-12 border-4 border-primary/20 rounded-full" />
            <div className="absolute inset-0 w-12 h-12 border-4 border-transparent border-t-primary rounded-full animate-spin" />
          </div>
          <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-outline">Loading Cinema...</p>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

// ─── YouTube Webview Fallback (Clean View) ───────────────────

interface YouTubeWebviewFallbackProps {
  url: string;
  startSeconds?: number;
}

export function YouTubeWebviewFallback({ url, startSeconds }: YouTubeWebviewFallbackProps) {
  const webviewRef = useRef<any>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const inject = () => {
      // ── CSS: solid colors only, no alpha, no position:fixed, don't fight YouTube's JS sizer ──
      const css = `
        /* ── 1. Solid backgrounds, no alpha ── */
        html, body, ytd-app, #content, #page-manager {
            background: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
        }

        /* ── 2. Hide the masthead / nav bar ── */
        #masthead-container, ytd-masthead, #masthead { display: none !important; }

        /* ── 3. Hide EVERYTHING below the player:
              #below = the div that holds channel info, description, comments, related.
              This single rule fixes the subscribe/like/share/channel bar bleedthrough. ── */
        #below,
        #info, #above-the-fold,
        ytd-video-primary-info-renderer,
        ytd-video-secondary-info-renderer,
        ytd-watch-metadata,
        ytd-structured-description-content-renderer,
        ytd-comments,
        #comments,
        #related,
        #secondary,
        #footer,
        tp-yt-app-drawer, #guide,
        ytd-merch-shelf-renderer,
        ytd-engagement-panel-section-list-renderer,
        #chat, #ticket-shelf,
        ytd-popup-container, tp-yt-iron-overlay-backdrop,
        ytd-mealbar-promo-renderer { display: none !important; }

        /* ── 4. Full-height chain: make every ancestor fill 100vh so the
              player can stretch without needing position:fixed ── */
        html, body, ytd-app, #content, #page-manager,
        ytd-watch-flexy, #full-bleed-container {
            height: 100vh !important;
            max-height: 100vh !important;
        }

        /* ── 5. Expand primary column to fill all available space ── */
        #columns, #primary, #primary-inner {
            padding: 0 !important;
            margin: 0 !important;
            width: 100vw !important;
            max-width: 100vw !important;
            height: 100vh !important;
            max-height: 100vh !important;
        }

        /* ── 6. Player wrappers fill their parent — let YouTube's ResizeObserver
              do the internal math naturally from there ── */
        #player-container-outer, #player-container-inner,
        #ytd-player, #player-container, #player,
        ytd-player, .ytd-player {
            width: 100% !important;
            height: 100% !important;
            max-width: 100% !important;
            max-height: 100% !important;
            background: #000000 !important;
        }

        /* ── 7. The real player target — fill 100% of the chain above ── */
        #movie_player {
            width: 100% !important;
            height: 100% !important;
            background: #000000 !important;
        }

        /* ── 8. Video element — solid black, no alpha ── */
        .html5-video-player { background: #000000 !important; }
        video.html5-main-video, video {
            background: #000000 !important;
            object-fit: contain !important;
        }

        /* ── 9. Hide in-player branding, keep ALL controls intact ── */
        .ytp-watermark,
        .ytp-youtube-button,
        .ytp-title-link,
        .ytp-title-text a,
        .ytp-ce-element,
        .ytp-show-cards-title { display: none !important; }

        /* ── 10. Ad overlays only — NOT the ad video track itself ──
              Hiding the video track causes YouTube to loop blank forever. ── */
        .ytp-ad-overlay-container,
        .ytp-ad-text-overlay,
        .ytp-ad-image-overlay { display: none !important; }
      `;
      webview.insertCSS(css);

      // ── JS: guard with a unique flag so re-injection on navigation is safe ──
      webview.executeJavaScript(`
        (function() {
          if (window._sicWatchInjected) return;
          window._sicWatchInjected = true;

          const skipAds = () => {
            const skipBtn = document.querySelector(
              '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button'
            );
            if (skipBtn) { skipBtn.click(); return; }

            // Unskippable ad: mute + seek to end so it transitions faster
            const adBadge = document.querySelector('.ytp-ad-simple-ad-badge, .ytp-ad-duration-remaining');
            if (adBadge) {
              const v = document.querySelector('video');
              if (v && !v.ended) {
                v.muted = true;
                if (isFinite(v.duration) && v.duration > 0) v.currentTime = v.duration - 0.1;
              }
            }

            document.querySelectorAll(
              'tp-yt-iron-overlay-backdrop, ytd-popup-container, .ytp-ad-overlay-container'
            ).forEach(el => el.style.display = 'none');
          };

          const ensurePlay = () => {
            const v = document.querySelector('video');
            if (v && v.paused && !v.ended) v.play().catch(() => {});
          };

          skipAds(); ensurePlay();

          // Click theater mode to expand the player height to fill available space.
          // We retry a few times since YouTube renders the button asynchronously.
          let theaterAttempts = 0;
          const tryTheater = () => {
            if (theaterAttempts++ > 10) return;
            const flexy = document.querySelector('ytd-watch-flexy');
            // Only click if NOT already in theater mode
            if (flexy && !flexy.hasAttribute('theater')) {
              const btn = document.querySelector('.ytp-size-button');
              if (btn) { btn.click(); return; }
            }
            setTimeout(tryTheater, 500);
          };
          setTimeout(tryTheater, 800);

          const obs = new MutationObserver(() => { skipAds(); ensurePlay(); });
          obs.observe(document.documentElement, { childList: true, subtree: true });
          setInterval(() => { skipAds(); ensurePlay(); }, 800);
        })();
      `);
    };

    // dom-ready = early inject (before page scripts finish)
    const onDomReady = () => inject();

    // did-finish-load = full page loaded; re-inject and reveal player after 2.5s
    const onFinishLoad = () => {
      inject();
      setTimeout(() => setIsReady(true), 2500);
    };

    webview.addEventListener('dom-ready', onDomReady);
    webview.addEventListener('did-finish-load', onFinishLoad);
    return () => {
      webview.removeEventListener('dom-ready', onDomReady);
      webview.removeEventListener('did-finish-load', onFinishLoad);
    };
  }, []);

  let watchId = '';
  try {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|v\/)([^?&]+)/);
    if (match) watchId = match[1];
  } catch (e) { }

  let watchUrl = watchId ? `https://www.youtube.com/watch?v=${watchId}` : url;
  if (watchId && startSeconds) watchUrl += `&t=${Math.floor(startSeconds)}s`;

  return (
    <div className="w-full h-full bg-black relative">
      <webview
        ref={webviewRef}
        src={watchUrl}
        className={`w-full h-full transition-opacity duration-700 ${isReady ? 'opacity-100' : 'opacity-0'}`}
        partition="persist:youtube_player"
        // @ts-ignore
        allowpopups="true"
        webpreferences="autoplayPolicy=no-user-gesture-required, backgroundThrottling=false"
        useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      />

      {!isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-[50] space-y-4">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 w-16 h-16 border-4 border-primary/20 rounded-full" />
            <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-primary rounded-full animate-spin" />
          </div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-primary/60">Rescue Player</p>
          <p className="text-[9px] text-white/20 tracking-widest">Loading watch page…</p>
        </div>
      )}

      <div className="absolute top-4 left-4 z-[1000000] pointer-events-none transition-opacity duration-1000" style={{ opacity: isReady ? 0.3 : 0 }}>
        <span className="bg-black/80 text-[7px] text-white px-2 py-1 rounded font-black uppercase tracking-[0.2em] border border-white/10 backdrop-blur-md">
          Immersive Mode
        </span>
      </div>
    </div>
  );
}
