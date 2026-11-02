// ==========================================
// Hush for Gmail - Content Script (v1.2)
// Ultra-Resilient Interceptor & DOM Shield
// ==========================================

// Immediately inject CSS to hide any Hush tracking pixels in sender's view
try {
  const style = document.createElement('style');
  style.textContent = `
    img[src*="/p/"],
    img[src*="hush"],
    img[src*="googleusercontent.com"][src*="/p/"] {
      display: none !important;
      visibility: hidden !important;
      width: 0 !important;
      height: 0 !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
} catch {}

const GMAIL_SELECTORS = {
  composeWindow: [
    'div[role="dialog"]',
    'div.M9',
    'div.AD',
    'div.inboxsdk__compose',
    'div[aria-label*="Compose" i]',
    'div.dw'
  ].join(','),

  sendButton: [
    'div[role="button"][data-tooltip*="Send" i]',
    'div[role="button"][aria-label*="Send" i]',
    'div.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3',
    'div[role="button"][id*=":send"]'
  ].join(','),

  messageBody: [
    'div[role="textbox"][aria-label*="Body" i]',
    'div[role="textbox"][aria-label*="Message" i]',
    'div[role="textbox"][contenteditable="true"]',
    'div.Am.Al.editable',
    'div[contenteditable="true"]'
  ].join(','),

  actionToolbar: 'tr.btC, td.gU.Up, div[aria-label*="Formatting options" i], div.btC, td.HE'
};

const untrackedComposes = new WeakSet();
const activeSends = new WeakSet();
const reportedSelfViews = new Set();

function isHushImage(img) {
  if (!img || !img.getAttribute) return false;
  const src = img.getAttribute('src') || img.src || '';
  return src.includes('/p/') && (src.includes('hush') || src.includes('.workers.dev') || src.includes('googleusercontent.com'));
}

function neutralizePixel(img) {
  const src = img.getAttribute('src') || img.src || '';
  const match = src.match(/\/p\/([a-zA-Z0-9_-]+)(?:\.gif)?/);
  if (match) {
    const emailId = match[1];
    if (!reportedSelfViews.has(emailId)) {
      reportedSelfViews.add(emailId);
      try {
        chrome.runtime.sendMessage({ action: 'SELF_VIEW', id: emailId });
      } catch {}
      setTimeout(() => reportedSelfViews.delete(emailId), 60000);
    }
  }

  img.removeAttribute('srcset');
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  img.style.display = 'none';
  if (img.parentNode) {
    img.parentNode.removeChild(img);
  }
}

// Fast DOM shield running at document_start
const domShield = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType === 1) {
        if (node.tagName === 'IMG' && isHushImage(node)) {
          neutralizePixel(node);
        } else if (node.querySelectorAll) {
          node.querySelectorAll('img').forEach((img) => {
            if (isHushImage(img)) neutralizePixel(img);
          });
        }
      }
    }
  }
});
domShield.observe(document.documentElement, { childList: true, subtree: true });

function findComposeContainer(element) {
  let curr = element;
  while (curr && curr !== document.body) {
    if (curr.matches) {
      if (curr.matches(GMAIL_SELECTORS.composeWindow)) {
        return curr;
      }
      if (
        curr.querySelector &&
        (curr.querySelector('div[contenteditable="true"]') || curr.querySelector(GMAIL_SELECTORS.messageBody)) &&
        (curr.querySelector('div[role="button"]') || curr.querySelector(GMAIL_SELECTORS.sendButton))
      ) {
        return curr;
      }
    }
    curr = curr.parentElement;
  }
  return null;
}

function findSendButton(composeEl) {
  const btn = composeEl.querySelector(GMAIL_SELECTORS.sendButton);
  if (btn) return btn;

  const allBtns = composeEl.querySelectorAll('div[role="button"]');
  for (const b of allBtns) {
    const text = (b.textContent || '').trim().toLowerCase();
    const tooltip = (b.getAttribute('data-tooltip') || b.getAttribute('aria-label') || '').toLowerCase();
    if (text === 'send' || tooltip.includes('send')) {
      return b;
    }
  }
  return null;
}

function findMessageBody(composeEl) {
  const body = composeEl.querySelector(GMAIL_SELECTORS.messageBody);
  if (body) return body;
  return composeEl.querySelector('div[contenteditable="true"]');
}

function extractRecipients(composeEl) {
  const recipients = new Set();

  // 1. Elements with email or hovercard
  const emailEls = composeEl.querySelectorAll(
    'span[email], div[email], [data-hovercard-id*="@"], [data-name*="@"], [aria-label*="@"]'
  );
  emailEls.forEach((el) => {
    const email = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || el.textContent.trim();
    if (email && email.includes('@')) {
      const cleaned = email.replace(/.*<([^>]+)>.*/, '$1').trim();
      recipients.add(cleaned);
    }
  });

  // 2. Input elements
  const inputs = composeEl.querySelectorAll(
    'input[name="to"], input[name="to_new"], input[aria-label*="To" i], input[aria-label*="Recipients" i]'
  );
  inputs.forEach((input) => {
    const val = (input.value || '').trim();
    if (val && val.includes('@')) {
      val.split(/[,;]/).forEach((e) => {
        const cleaned = e.replace(/.*<([^>]+)>.*/, '$1').trim();
        if (cleaned.includes('@')) recipients.add(cleaned);
      });
    }
  });

  // 3. Fallback regex on header table area
  if (recipients.size === 0) {
    const toSection = composeEl.querySelector('tr[role="row"], td.aoD, div.aoD');
    if (toSection) {
      const text = toSection.innerText || toSection.textContent || '';
      const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      if (emailMatches) {
        emailMatches.forEach((e) => recipients.add(e));
      }
    }
  }

  const list = Array.from(recipients);
  if (list.length === 0) return 'recipient@unknown.com';
  if (list.length === 1) return list[0];
  return `${list[0]} and ${list.length - 1} more`;
}

function injectTrackingToggle(composeEl) {
  if (composeEl.querySelector('.hush-toggle-container')) return;

  const sendBtn = findSendButton(composeEl);
  if (!sendBtn) return;

  let targetContainer = composeEl.querySelector(GMAIL_SELECTORS.actionToolbar);
  if (!targetContainer && sendBtn.parentElement) {
    targetContainer = sendBtn.parentElement.parentElement || sendBtn.parentElement;
  }
  if (!targetContainer) return;

  const container = document.createElement('div');
  container.className = 'hush-toggle-container';
  container.style.cssText =
    'display:inline-flex;align-items:center;margin:0 10px;font-size:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;user-select:none;vertical-align:middle;';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'hush-track-' + Math.random().toString(36).slice(2, 7);
  checkbox.checked = true;
  checkbox.style.cssText =
    'margin-right:5px;cursor:pointer;accent-color:#3d4fd6;width:14px;height:14px;vertical-align:middle;';

  const label = document.createElement('label');
  label.htmlFor = checkbox.id;
  label.textContent = 'Track with Hush';
  label.style.cssText =
    'cursor:pointer;color:#3c4043;font-weight:500;font-size:12px;vertical-align:middle;';
  label.title = 'Hush email open tracker (uncheck to disable)';

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      untrackedComposes.delete(composeEl);
      label.style.color = '#3c4043';
    } else {
      untrackedComposes.add(composeEl);
      label.style.color = '#80868b';
    }
  });

  container.appendChild(checkbox);
  container.appendChild(label);

  if (targetContainer.tagName === 'TR') {
    const td = document.createElement('td');
    td.appendChild(container);
    targetContainer.appendChild(td);
  } else {
    targetContainer.appendChild(container);
  }
}

function scanComposes() {
  const composes = document.querySelectorAll(GMAIL_SELECTORS.composeWindow);
  composes.forEach(injectTrackingToggle);

  const sendBtns = document.querySelectorAll(GMAIL_SELECTORS.sendButton);
  sendBtns.forEach((btn) => {
    const compose = findComposeContainer(btn);
    if (compose) injectTrackingToggle(compose);
  });
}

const composeObserver = new MutationObserver(scanComposes);
composeObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
setInterval(scanComposes, 1000);

async function handleSend(e, triggerElement, isKeydown) {
  const composeEl = findComposeContainer(triggerElement);
  if (!composeEl) return;

  if (activeSends.has(composeEl)) return;
  if (untrackedComposes.has(composeEl)) return;

  console.log('[Hush] Intercepted Send action in compose window.');

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  const to = extractRecipients(composeEl);
  const subjectInput = composeEl.querySelector('input[name="subjectbox"], input[name="subject"]');
  const subject = subjectInput ? subjectInput.value.trim() : '';

  console.log('[Hush] Extracted metadata:', { to, subject });

  let trackerResult = null;
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout (3000ms)')), 3000)
    );

    const callPromise = chrome.runtime.sendMessage({
      action: 'CREATE_EMAIL_TRACKER',
      to,
      subject
    });

    trackerResult = await Promise.race([callPromise, timeoutPromise]);
    console.log('[Hush] Worker response:', trackerResult);
  } catch (err) {
    console.warn('[Hush] Could not attach tracker (proceeding with normal send):', err.message);
  }

  if (trackerResult && trackerResult.id && trackerResult.workerUrl) {
    const bodyEl = findMessageBody(composeEl);
    if (bodyEl) {
      const pixelUrl = `${trackerResult.workerUrl}/p/${trackerResult.id}.gif`;
      const img = document.createElement('img');
      img.src = pixelUrl;
      img.width = 1;
      img.height = 1;
      img.alt = '';
      img.style.cssText = 'display:block;border:0;width:1px;height:1px;';
      bodyEl.appendChild(img);
      console.log('[Hush] Pixel successfully appended to body:', pixelUrl);
    }
  }

  activeSends.add(composeEl);

  const sendBtn = findSendButton(composeEl);
  if (sendBtn) {
    console.log('[Hush] Re-triggering send via Send button click.');
    sendBtn.click();
  } else if (isKeydown) {
    console.log('[Hush] Re-triggering send via keyboard Enter event.');
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    composeEl.dispatchEvent(enterEvent);
  }

  setTimeout(() => {
    activeSends.delete(composeEl);
  }, 4000);
}

// 1. Intercept clicks in capture phase on send buttons
document.addEventListener(
  'click',
  (e) => {
    const target = e.target;
    // Check if clicked element or any parent matches send button or has text "Send"
    let curr = target;
    let foundSend = false;
    while (curr && curr !== document.body) {
      if (
        curr.matches &&
        (curr.matches(GMAIL_SELECTORS.sendButton) ||
          ((curr.getAttribute('role') === 'button' || curr.tagName === 'DIV') &&
            ((curr.textContent || '').trim().toLowerCase() === 'send' ||
              (curr.getAttribute('data-tooltip') || '').toLowerCase().includes('send') ||
              (curr.getAttribute('aria-label') || '').toLowerCase().includes('send'))))
      ) {
        foundSend = curr;
        break;
      }
      curr = curr.parentElement;
    }

    if (foundSend) {
      handleSend(e, foundSend, false);
    }
  },
  true
);

// 2. Intercept keyboard shortcuts (Ctrl+Enter or Cmd+Enter)
document.addEventListener(
  'keydown',
  (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const composeEl = findComposeContainer(e.target);
      if (composeEl) {
        handleSend(e, e.target, true);
      }
    }
  },
  true
);
