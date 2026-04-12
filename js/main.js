/**
 * STACK & SIGNAL — Main Interactions
 * Nav scroll, magnetic buttons, text reveal, stack toggle,
 * counter animation, custom cursor, smooth scroll.
 */

import { initThreeBg } from './three-bg.js';

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initThreeBg();
  initNavScroll();
  initMobileNav();
  initMagneticButtons();
  initTextReveal();
  initStackToggle();
  initCounterAnimation();
  initSmoothScroll();
  initCustomCursor();
  initScrollRevealCards();
});

// ── 1. Nav Scroll Blur ───────────────────────────────────────
function initNavScroll() {
  const nav = document.getElementById('site-nav');
  if (!nav) return;

  const onScroll = () => {
    if (window.scrollY > 50) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // run once on load
}

// ── 2. Mobile Nav ────────────────────────────────────────────
function initMobileNav() {
  const hamburger   = document.getElementById('hamburger');
  const mobileMenu  = document.getElementById('mobile-menu');
  const mobileClose = document.getElementById('mobile-close');
  const mobileLinks = document.querySelectorAll('.mobile-menu a');

  if (!hamburger || !mobileMenu) return;

  const open  = () => { mobileMenu.classList.add('open'); hamburger.classList.add('open'); document.body.style.overflow = 'hidden'; };
  const close = () => { mobileMenu.classList.remove('open'); hamburger.classList.remove('open'); document.body.style.overflow = ''; };

  hamburger.addEventListener('click', open);
  mobileClose?.addEventListener('click', close);
  mobileLinks.forEach(a => a.addEventListener('click', close));
}

// ── 3. Magnetic Buttons ──────────────────────────────────────
function initMagneticButtons() {
  const wraps = document.querySelectorAll('.magnetic-wrap');

  wraps.forEach(wrap => {
    const btn = wrap.querySelector('button, a, .signal-btn');
    if (!btn) return;

    const STRENGTH = 0.32;
    const EXPAND   = 60; // px outside button that still attracts

    wrap.addEventListener('mousemove', e => {
      const rect    = wrap.getBoundingClientRect();
      const centerX = rect.left + rect.width  / 2;
      const centerY = rect.top  + rect.height / 2;
      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;

      btn.style.transform = `translate(${dx * STRENGTH}px, ${dy * STRENGTH}px)`;
    });

    wrap.addEventListener('mouseleave', () => {
      btn.style.transform = 'translate(0, 0)';
    });

    // Expand the hover zone beyond the button's box
    wrap.style.padding = `${EXPAND}px`;
    wrap.style.margin  = `-${EXPAND}px`;
  });
}

// ── 4. Text Reveal (IntersectionObserver) ────────────────────
function initTextReveal() {
  const elements = document.querySelectorAll('.reveal-text');

  elements.forEach(el => {
    // Only wrap plain text nodes — skip child elements (spans, brs, etc.)
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    textNodes.forEach(textNode => {
      const words = textNode.textContent.split(/(\s+)/);
      const frag  = document.createDocumentFragment();
      words.forEach(part => {
        if (part.trim()) {
          const outer = document.createElement('span');
          const inner = document.createElement('span');
          outer.className = 'word-outer';
          inner.className = 'word-inner';
          inner.textContent = part;
          outer.appendChild(inner);
          frag.appendChild(outer);
        } else if (part) {
          frag.appendChild(document.createTextNode(part));
        }
      });
      textNode.parentNode.replaceChild(frag, textNode);
    });
  });

  // Stagger word delays
  elements.forEach(el => {
    el.querySelectorAll('.word-inner').forEach((w, i) => {
      w.style.transitionDelay = `${i * 50}ms`;
    });
  });

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -20px 0px' }
  );

  elements.forEach(el => {
    // If already in viewport on page load, reveal immediately (no delay needed for hero)
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      // Small delay so fonts/layout have settled
      setTimeout(() => el.classList.add('revealed'), 200);
    } else {
      observer.observe(el);
    }
  });
}

// ── 5. Build the Stack Toggle ────────────────────────────────
function initStackToggle() {
  const tabs   = document.querySelectorAll('.stack-tab');
  const panels = document.querySelectorAll('.stack-panel');

  if (!tabs.length) return;

  function activate(tabId) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.stackTab === tabId));

    panels.forEach(p => {
      if (p.dataset.stackPanel === tabId) {
        p.style.display = 'grid';
        requestAnimationFrame(() => {
          p.classList.add('active');
        });
      } else {
        p.classList.remove('active');
        // Hide after transition
        const hide = () => {
          if (!p.classList.contains('active')) p.style.display = 'none';
          p.removeEventListener('transitionend', hide);
        };
        p.addEventListener('transitionend', hide, { once: true });
        // Fallback
        setTimeout(() => {
          if (!p.classList.contains('active')) p.style.display = 'none';
        }, 400);
      }
    });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => activate(tab.dataset.stackTab));
  });

  // Activate first tab
  const firstTab = tabs[0];
  if (firstTab) activate(firstTab.dataset.stackTab);
}

// ── 6. Counter Animation ─────────────────────────────────────
function initCounterAnimation() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;

  let animated = false;

  const runCounters = () => {
    if (animated) return;
    counters.forEach(el => {
      const target   = parseFloat(el.dataset.count);
      const suffix   = el.dataset.suffix || '';
      const prefix   = el.dataset.prefix || '';
      const duration = 1800;
      const start    = performance.now();
      const isFloat  = el.dataset.float === 'true';

      const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = eased * target;
        el.textContent = prefix + (isFloat ? value.toFixed(1) : Math.round(value)) + suffix;
        if (progress < 1) requestAnimationFrame(step);
      };

      requestAnimationFrame(step);
    });
    animated = true;
  };

  const observer = new IntersectionObserver(
    entries => {
      if (entries.some(e => e.isIntersecting)) runCounters();
    },
    { threshold: 0.3 }
  );

  const statsSection = document.getElementById('stats');
  if (statsSection) observer.observe(statsSection);
}

// ── 7. Smooth Scroll ─────────────────────────────────────────
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', e => {
      const id = anchor.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const navH = document.getElementById('site-nav')?.offsetHeight || 80;
      const y    = target.getBoundingClientRect().top + window.scrollY - navH;
      window.scrollTo({ top: y, behavior: 'smooth' });
    });
  });
}

// ── 8. Custom Cursor ─────────────────────────────────────────
function initCustomCursor() {
  // Only on devices that have a real pointer
  if (!window.matchMedia('(pointer: fine)').matches) return;

  const dot  = document.createElement('div');
  const ring = document.createElement('div');
  dot.className  = 'cursor-dot';
  ring.className = 'cursor-ring';
  document.body.appendChild(dot);
  document.body.appendChild(ring);

  let ringX = 0, ringY = 0;
  let curX  = 0, curY  = 0;

  document.addEventListener('mousemove', e => {
    curX = e.clientX;
    curY = e.clientY;
    dot.style.left = curX + 'px';
    dot.style.top  = curY + 'px';
  });

  // Ring lags behind cursor for smooth follow
  const animRing = () => {
    ringX += (curX - ringX) * 0.12;
    ringY += (curY - ringY) * 0.12;
    ring.style.left = ringX + 'px';
    ring.style.top  = ringY + 'px';
    requestAnimationFrame(animRing);
  };
  animRing();

  // Expand ring over interactive elements
  const interactives = 'a, button, .signal-btn, .bento-card, .service-card, .stack-tab, .pricing-card';
  document.addEventListener('mouseover', e => {
    if (e.target.closest(interactives)) {
      ring.style.width  = '60px';
      ring.style.height = '60px';
      ring.style.borderColor = 'rgba(0, 194, 255, 0.6)';
    }
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest(interactives)) {
      ring.style.width  = '36px';
      ring.style.height = '36px';
      ring.style.borderColor = 'rgba(0, 194, 255, 0.4)';
    }
  });
}

// ── 9. Scroll Reveal Cards ───────────────────────────────────
function initScrollRevealCards() {
  const cards = document.querySelectorAll(
    '.service-card, .bento-card, .pricing-card, .process-step, .tech-item'
  );

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el    = entry.target;
          const delay = parseFloat(el.dataset.revealDelay || '0');
          setTimeout(() => {
            el.style.opacity   = '1';
            el.style.transform = 'translateY(0)';
          }, delay);
          observer.unobserve(el);
        }
      });
    },
    { threshold: 0.06, rootMargin: '0px 0px -20px 0px' }
  );

  cards.forEach((card, i) => {
    // Don't hide cards already in the initial viewport
    const rect = card.getBoundingClientRect();
    if (rect.top < window.innerHeight) {
      // Already visible — skip animation
      return;
    }
    card.style.opacity    = '0';
    card.style.transform  = 'translateY(28px)';
    card.style.transition = 'opacity 0.55s ease, transform 0.55s cubic-bezier(0.16, 1, 0.3, 1)';
    card.dataset.revealDelay = (i % 4) * 75; // 75ms stagger per row position
    observer.observe(card);
  });
}
