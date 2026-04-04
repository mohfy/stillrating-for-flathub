(function bootstrapStillRatingContentScript() {
  if (window.__stillRatingForFlathubLoaded) {
    return;
  }

  window.__stillRatingForFlathubLoaded = true;

  const api = browser;

  const BADGE_ID = "stillrating-for-flathub-badge";
  const MODAL_ID = "stillrating-for-flathub-modal";
  const INFO_SECTION_SELECTOR = "section[aria-label='App information']";
  const URL_POLL_INTERVAL_MS = 300;
  const RATING_STYLES = {
    0: { label: "Unknown", color: "#888888" },
    1: { label: "Warning", color: "#cc0000" },
    2: { label: "Bronze", color: "#cd7f32" },
    3: { label: "Silver", color: "#c0c0c0" },
    4: { label: "Gold", color: "#daa520" },
    5: { label: "Gold+", color: "#ffd700" },
    6: { label: "SWAI", color: "#7b2fbe" }
  };

  let currentObserver = null;
  let injectionInFlight = false;
  let requestToken = 0;
  let scheduledAttempt = 0;
  let lastHandledUrl = window.location.href;
  let pageObservationStartedAt = Date.now();
  let urlWatcherIntervalId = 0;
  let modalKeydownHandler = null;
  let lockedDocumentOverflow = "";
  let lockedBodyOverflow = "";

  function extractAppIdFromUrl(urlString = window.location.href) {
    try {
      const url = new URL(urlString);
      const pathSegments = url.pathname.split("/").filter(Boolean);
      const appsSegmentIndex = pathSegments.findIndex(
        (segment) => segment.toLowerCase() === "apps"
      );

      if (appsSegmentIndex === -1) {
        return null;
      }

      const afterApps = pathSegments.slice(appsSegmentIndex + 1);

      if (afterApps.length === 0) {
        return null;
      }

      if (afterApps[0]?.toLowerCase() === "details" && afterApps[1]) {
        return decodeURIComponent(afterApps[1]);
      }

      return decodeURIComponent(afterApps[0]);
    } catch (error) {
      console.warn("StillRating: failed to parse the current URL", error);
      return null;
    }
  }

  function isPotentialAppUrl(urlString) {
    return /\/apps(?:\/details)?\//i.test(urlString);
  }

  function disconnectObserver() {
    if (currentObserver) {
      currentObserver.disconnect();
      currentObserver = null;
    }
  }

  function removeInjectedBadge() {
    document.getElementById(BADGE_ID)?.remove();
  }

  function getStillRatingNotesText(appData) {
    if (typeof appData?.still_rating_notes === "string") {
      const trimmedNotes = appData.still_rating_notes.trim();

      if (trimmedNotes) {
        return trimmedNotes;
      }
    }

    if (!appData) {
      return "No StillRating entry was found for this app in the repository database.";
    }

    return "No repository notes are available for this rating.";
  }

  function isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getBoundingClientRect().width > 0 &&
      element.getBoundingClientRect().height > 0
    );
  }

  function findAppInformationSection() {
    const section = document.querySelector(INFO_SECTION_SELECTOR);

    return section instanceof HTMLElement && isVisibleElement(section)
      ? section
      : null;
  }

  function normalizeTextContent(text) {
    return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function getMeaningfulChildren(element) {
    return Array.from(element.children).filter(
      (child) => child instanceof HTMLElement && isVisibleElement(child)
    );
  }

  function findAppInfoInsertionReference(section) {
    const visibleChildren = getMeaningfulChildren(section);

    if (visibleChildren.length === 0) {
      return null;
    }

    const downloadsTile = visibleChildren.find((child) =>
      /downloads\s*\/\s*month/i.test(normalizeTextContent(child.textContent))
    );

    return downloadsTile ?? visibleChildren[visibleChildren.length - 1];
  }

  function resolveBadgePresentation(appData) {
    if (!appData) {
      return {
        label: "Not rated",
        color: "#888888",
        tooltip: "No StillRating entry was found for this app."
      };
    }

    const numericRating = Number(appData.still_rating);
    const rating =
      Number.isInteger(numericRating) && numericRating in RATING_STYLES
        ? numericRating
        : 0;
    const style = RATING_STYLES[rating];
    const tooltip =
      typeof appData.still_rating_notes === "string"
        ? appData.still_rating_notes.trim()
        : "";

    return {
      label: style.label,
      color: style.color,
      tooltip
    };
  }

  function closeStillRatingModal() {
    document.getElementById(MODAL_ID)?.remove();

    if (modalKeydownHandler) {
      document.removeEventListener("keydown", modalKeydownHandler, true);
      modalKeydownHandler = null;
    }

    document.documentElement.style.overflow = lockedDocumentOverflow;
    document.body.style.overflow = lockedBodyOverflow;
  }

  function createModalPill(text, color, className) {
    const pill = document.createElement("span");
    pill.className = className;
    pill.textContent = text;

    if (color) {
      pill.style.setProperty("--stillrating-value-color", color);
    }

    return pill;
  }

  function createModalListItem({ pillText, pillColor, title, body, pillClassName }) {
    const item = document.createElement("li");
    item.className = "stillrating-modal__item";

    const pillWrap = document.createElement("div");
    pillWrap.className = "stillrating-modal__item-pill-wrap";

    const pill = createModalPill(
      pillText,
      pillColor,
      pillClassName || "stillrating-modal__item-pill"
    );
    pillWrap.append(pill);

    const textWrap = document.createElement("div");
    textWrap.className = "stillrating-modal__item-text";

    const titleElement = document.createElement("div");
    titleElement.className = "stillrating-modal__item-title";
    titleElement.textContent = title;

    const bodyElement = document.createElement("div");
    bodyElement.className = "stillrating-modal__item-body";
    bodyElement.textContent = body;

    textWrap.append(titleElement, bodyElement);
    item.append(pillWrap, textWrap);

    return item;
  }

  function openStillRatingModal(appId, presentation, appData) {
    closeStillRatingModal();

    if (!document.body) {
      return;
    }

    const notesText = getStillRatingNotesText(appData);
    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.className = "stillrating-modal";
    overlay.setAttribute("role", "presentation");

    const shell = document.createElement("div");
    shell.className = "stillrating-modal__shell";

    const panel = document.createElement("div");
    panel.className = "stillrating-modal__panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", `${MODAL_ID}-title`);

    const closeWrap = document.createElement("div");
    closeWrap.className = "stillrating-modal__close-wrap";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "stillrating-modal__close-button";
    closeButton.setAttribute("aria-label", "Close StillRating notes");
    closeButton.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"></path></svg>';
    closeButton.addEventListener("click", closeStillRatingModal);
    closeWrap.append(closeButton);

    const hero = document.createElement("div");
    hero.className = "stillrating-modal__hero";
    hero.append(
      createModalPill(
        presentation.label,
        presentation.color,
        "stillrating-modal__hero-pill"
      )
    );

    const title = document.createElement("h3");
    title.id = `${MODAL_ID}-title`;
    title.className = "stillrating-modal__title";
    title.textContent = "StillRating Notes";

    const list = document.createElement("ul");
    list.className = "stillrating-modal__list";
    list.append(
      createModalListItem({
        pillText: presentation.label,
        pillColor: presentation.color,
        title: "StillRating",
        body: `Current repository rating for ${appId}`
      }),
      createModalListItem({
        pillText: "Notes",
        pillColor: "",
        pillClassName:
          "stillrating-modal__item-pill stillrating-modal__item-pill--neutral",
        title: "Repository Notes",
        body: notesText
      })
    );

    panel.append(closeWrap, hero, title, list);
    shell.append(panel);
    overlay.append(shell);

    const closeOnBackdropClick = (event) => {
      if (event.target === overlay || event.target === shell) {
        closeStillRatingModal();
      }
    };

    overlay.addEventListener("click", closeOnBackdropClick);
    shell.addEventListener("click", closeOnBackdropClick);

    lockedDocumentOverflow = document.documentElement.style.overflow;
    lockedBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    modalKeydownHandler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeStillRatingModal();
      }
    };

    document.addEventListener("keydown", modalKeydownHandler, true);
    document.body.append(overlay);

    requestAnimationFrame(() => {
      closeButton.focus();
    });
  }

  function attachModalTriggerBehavior(element, appId, presentation, appData) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    if (element.tagName !== "BUTTON") {
      element.setAttribute("role", "button");
      element.tabIndex = 0;
    }

    element.setAttribute("aria-haspopup", "dialog");
    element.setAttribute("aria-controls", MODAL_ID);

    const openModal = (event) => {
      if ("button" in event && event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openStillRatingModal(appId, presentation, appData);
    };

    element.addEventListener("click", openModal);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        openModal(event);
      }
    });
  }

  function buildInfoCardElement(appId, presentation) {
    const card = document.createElement("div");
    card.id = BADGE_ID;
    card.className = "stillrating-info-card";
    card.dataset.appId = appId;
    card.dataset.placement = "app-info";
    card.style.setProperty("--stillrating-value-color", presentation.color);
    card.setAttribute("role", "note");
    card.setAttribute("aria-label", `stillRating ${presentation.label}`);

    if (presentation.tooltip) {
      card.title = presentation.tooltip;
      card.tabIndex = 0;
    }

    const pill = document.createElement("span");
    pill.className = "stillrating-info-card__pill";
    pill.textContent = presentation.label;

    const label = document.createElement("span");
    label.className = "stillrating-info-card__label";
    label.textContent = "stillRating";

    card.append(pill, label);

    requestAnimationFrame(() => {
      card.classList.add("is-visible");
    });

    return card;
  }

  function injectStillRatingIntoInfoSection(appData, appId, section) {
    const referenceNode = findAppInfoInsertionReference(section);
    const presentation = resolveBadgePresentation(appData);
    const card = buildInfoCardElement(appId, presentation);
    attachModalTriggerBehavior(card, appId, presentation, appData);

    if (referenceNode) {
      referenceNode.insertAdjacentElement("afterend", card);
    } else {
      section.append(card);
    }

    return true;
  }

  function injectStillRatingBadge(appData) {
    const appId = extractAppIdFromUrl();

    if (!appId) {
      return false;
    }

    const existingBadge = document.getElementById(BADGE_ID);
    const infoSection = findAppInformationSection();

    if (!infoSection) {
      return false;
    }

    if (
      existingBadge?.dataset.appId === appId &&
      existingBadge.dataset.placement === "app-info"
    ) {
      return true;
    }

    existingBadge?.remove();
    return injectStillRatingIntoInfoSection(appData, appId, infoSection);
  }

  async function requestAppData(appId) {
    try {
      return await api.runtime.sendMessage({
        type: "stillrating:get-app-data",
        appId
      });
    } catch (error) {
      console.warn("StillRating: failed to request app data", error);
      return null;
    }
  }

  async function runInjectionAttempt() {
    if (injectionInFlight) {
      return;
    }

    const appId = extractAppIdFromUrl();

    if (!appId) {
      removeInjectedBadge();
      closeStillRatingModal();
      disconnectObserver();
      return;
    }

    injectionInFlight = true;
    const activeRequestToken = ++requestToken;

    try {
      const appData = await requestAppData(appId);

      if (
        activeRequestToken !== requestToken ||
        extractAppIdFromUrl() !== appId
      ) {
        return;
      }

      if (injectStillRatingBadge(appData)) {
        disconnectObserver();
      } else if (currentObserver) {
        // Some Flathub renders finish quietly after the first pass, so keep
        // retrying briefly even if no new DOM mutation fires.
        scheduleInjectionAttempt(250);
      }
    } finally {
      injectionInFlight = false;
    }
  }

  function scheduleInjectionAttempt(delayMs = 0) {
    window.clearTimeout(scheduledAttempt);
    scheduledAttempt = window.setTimeout(() => {
      void runInjectionAttempt();
    }, delayMs);
  }

  function startObserverForCurrentPage() {
    disconnectObserver();
    pageObservationStartedAt = Date.now();

    if (!extractAppIdFromUrl()) {
      removeInjectedBadge();
      return;
    }

    if (!document.body) {
      return;
    }

    currentObserver = new MutationObserver(() => {
      scheduleInjectionAttempt(50);
    });

    currentObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    scheduleInjectionAttempt(0);
  }

  function handlePotentialNavigation() {
    const nextUrl = window.location.href;

    if (nextUrl === lastHandledUrl) {
      return;
    }

    lastHandledUrl = nextUrl;
    requestToken += 1;
    closeStillRatingModal();
    removeInjectedBadge();
    startObserverForCurrentPage();
  }

  function queueNavigationRescan() {
    window.setTimeout(handlePotentialNavigation, 0);
    window.setTimeout(handlePotentialNavigation, 120);
    window.setTimeout(handlePotentialNavigation, 350);
    window.setTimeout(handlePotentialNavigation, 800);
  }

  function startUrlWatcher() {
    if (urlWatcherIntervalId) {
      return;
    }

    urlWatcherIntervalId = window.setInterval(() => {
      if (window.location.href !== lastHandledUrl) {
        handlePotentialNavigation();
      }
    }, URL_POLL_INTERVAL_MS);
  }

  function patchHistoryMethod(methodName) {
    const original = window.history[methodName];

    if (typeof original !== "function") {
      return;
    }

    window.history[methodName] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);

      // Let the app finish its route update before we start watching for the title.
      window.setTimeout(handlePotentialNavigation, 0);

      return result;
    };
  }

  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");

  window.addEventListener("popstate", () => {
    window.setTimeout(handlePotentialNavigation, 0);
  });

  window.addEventListener("hashchange", () => {
    window.setTimeout(handlePotentialNavigation, 0);
  });

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const link = target.closest("a[href]");

      if (!(link instanceof HTMLAnchorElement)) {
        return;
      }

      const rawHref = link.getAttribute("href");

      if (!rawHref || rawHref.startsWith("#")) {
        return;
      }

      try {
        const resolvedUrl = new URL(rawHref, window.location.href);

        if (
          resolvedUrl.origin === window.location.origin &&
          isPotentialAppUrl(resolvedUrl.pathname)
        ) {
          queueNavigationRescan();
        }
      } catch (error) {
        console.warn("StillRating: unable to inspect clicked Flathub link", error);
      }
    },
    true
  );

  startUrlWatcher();

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        startObserverForCurrentPage();
      },
      { once: true }
    );
  } else {
    startObserverForCurrentPage();
  }
})();
