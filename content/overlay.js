/**
 * content/overlay.js
 *
 * Shadow-DOM numbered badges overlay (Slice 3.1, Architecture §7.5).
 * Renders badges using a shadow root on document.documentElement so page CSS
 * cannot break or distort badge appearance.
 */

(function () {
  const HOST_ID = "sahayak-overlay-host";
  let overlayHost = null;
  let shadowRoot = null;
  let badgesContainer = null;
  let isVisible = false;
  let repositionListener = null;

  /**
   * Initialize or retrieve the shadow root overlay host.
   */
  function ensureOverlayHost() {
    if (overlayHost && shadowRoot && document.contains(overlayHost)) {
      return shadowRoot;
    }

    // Clean up old host if any
    const existing = document.getElementById(HOST_ID);
    if (existing) {
      existing.remove();
    }

    overlayHost = document.createElement("div");
    overlayHost.id = HOST_ID;
    overlayHost.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483646;
      overflow: visible;
    `;

    shadowRoot = overlayHost.attachShadow({ mode: "open" });

    const styleEl = document.createElement("style");
    styleEl.textContent = `
      :host {
        display: block;
        pointer-events: none;
      }
      .badges-wrap {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      .sahayak-badge {
        position: absolute;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: -0.02em;
        color: #ffffff;
        background: #0d6b63;
        border: 1.5px solid #ffffff;
        border-radius: 4px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
        pointer-events: none;
        user-select: none;
        z-index: 2147483647;
        transition: transform 0.1s ease;
      }
      .sahayak-badge--consequential {
        background: #d97706;
        border-color: #fef3c7;
      }
      .sahayak-badge--sensitive {
        background: #dc2626;
        border-color: #fee2e2;
      }
      .sahayak-badge--highlight {
        transform: scale(1.4) !important;
        box-shadow: 0 0 16px rgba(13, 107, 99, 0.95), 0 2px 8px rgba(0, 0, 0, 0.5) !important;
        background: #0d6b63 !important;
        border-color: #a7f3d0 !important;
        z-index: 2147483647 !important;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
    `;

    badgesContainer = document.createElement("div");
    badgesContainer.className = "badges-wrap";

    shadowRoot.appendChild(styleEl);
    shadowRoot.appendChild(badgesContainer);

    document.documentElement.appendChild(overlayHost);

    return shadowRoot;
  }

  /**
   * Reposition badges based on current DOM element bounding boxes.
   */
  function updateBadgePositions() {
    if (!isVisible || !badgesContainer || !window.__sahayakElementsMap) {
      return;
    }

    const badgeEls = badgesContainer.querySelectorAll(".sahayak-badge");
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    badgeEls.forEach((badgeEl) => {
      const n = parseInt(badgeEl.getAttribute("data-n"), 10);
      const entry = window.__sahayakElementsMap.get(n);
      if (!entry || !entry.element || !document.contains(entry.element)) {
        badgeEl.style.display = "none";
        return;
      }

      const rect = entry.element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        badgeEl.style.display = "none";
        return;
      }

      badgeEl.style.display = "inline-flex";

      // Position badge at top-left corner of the element, slightly offset
      let top = rect.top + scrollY - 9;
      let left = rect.left + scrollX - 6;

      // Keep within page boundaries
      if (top < 0) top = rect.top + scrollY;
      if (left < 0) left = rect.left + scrollX;

      badgeEl.style.top = `${Math.round(top)}px`;
      badgeEl.style.left = `${Math.round(left)}px`;
    });
  }

  /**
   * Render badges for all scanned elements.
   *
   * @param {ActionElement[]} [elements]
   */
  function renderOverlayBadges(elements) {
    ensureOverlayHost();
    badgesContainer.innerHTML = "";

    const list = elements || window.__sahayakScannedElements || [];
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    list.forEach((item) => {
      const entry = window.__sahayakElementsMap ? window.__sahayakElementsMap.get(item.n) : null;
      if (!entry || !entry.element) return;

      const rect = entry.element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const badge = document.createElement("div");
      badge.className = "sahayak-badge";
      badge.setAttribute("data-n", String(item.n));
      badge.textContent = String(item.n);

      if (item.consequential) {
        badge.classList.add("sahayak-badge--consequential");
        badge.title = `[${item.n}] Consequential action`;
      } else if (item.sensitive) {
        badge.classList.add("sahayak-badge--sensitive");
        badge.title = `[${item.n}] Sensitive field`;
      }

      let top = rect.top + scrollY - 9;
      let left = rect.left + scrollX - 6;
      if (top < 0) top = rect.top + scrollY;
      if (left < 0) left = rect.left + scrollX;

      badge.style.top = `${Math.round(top)}px`;
      badge.style.left = `${Math.round(left)}px`;

      badgesContainer.appendChild(badge);
    });

    isVisible = true;

    // Attach scroll and resize listeners for smooth positioning tracking
    if (!repositionListener) {
      repositionListener = () => {
        if (isVisible) {
          requestAnimationFrame(updateBadgePositions);
        }
      };
      window.addEventListener("scroll", repositionListener, { passive: true });
      window.addEventListener("resize", repositionListener, { passive: true });
    }
  }

  /**
   * Clear all rendered badges from the overlay.
   */
  function clearOverlayBadges() {
    if (badgesContainer) {
      badgesContainer.innerHTML = "";
    }
    isVisible = false;
  }

  /**
   * Toggle overlay visibility on and off.
   *
   * @param {boolean} [forceState]
   * @returns {boolean} New visibility state
   */
  function toggleOverlayBadges(forceState) {
    const nextState = typeof forceState === "boolean" ? forceState : !isVisible;
    if (nextState) {
      renderOverlayBadges();
    } else {
      clearOverlayBadges();
    }
    return isVisible;
  }

  /**
   * Check if badges are currently rendered and visible.
   */
  function isOverlayVisible() {
    return isVisible;
  }

  /**
   * Visually enlarge and pulse a specific badge [n].
   *
   * @param {number} n
   */
  function pulseBadge(n) {
    if (!badgesContainer) return;
    const badge = badgesContainer.querySelector(`.sahayak-badge[data-n="${n}"]`);
    if (badge) {
      badge.classList.add("sahayak-badge--highlight");
      setTimeout(() => {
        badge.classList.remove("sahayak-badge--highlight");
      }, 2500);
    }
  }

  // Export functions to window
  window.renderOverlayBadges = renderOverlayBadges;
  window.clearOverlayBadges = clearOverlayBadges;
  window.toggleOverlayBadges = toggleOverlayBadges;
  window.isOverlayVisible = isOverlayVisible;
  window.updateBadgePositions = updateBadgePositions;
  window.pulseBadge = pulseBadge;
})();
